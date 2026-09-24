import process from "node:process";
import { setTimeout } from "node:timers";
import { container } from "@sapphire/framework";
import { type ApplicationCommandDataResolvable } from "discord.js";
import { clientOptions, discordTokens, isMultiBot, isProd } from "../../config/index.js";
import { Rawon } from "../../structures/Rawon.js";
import { buildApplicationCommandData } from "../functions/buildApplicationCommandData.js";
import { createScopedLogger, type Logger } from "./createLogger.js";
import { MultiBotManager } from "./MultiBotManager.js";

const log = createScopedLogger("MultiBot", isProd);

export class MultiBotLauncher {
    private readonly clients: Rawon[] = [];
    private readonly multiBotManager = MultiBotManager.getInstance();
    private slashCommandData: ApplicationCommandDataResolvable[] | null = null;

    private static readonly SAVE_QUEUE_TIMEOUT_MS = 5000;

    private async registerSlashCommands(client: Rawon, botLog: Logger): Promise<void> {
        if (!client.config.enableSlashCommand) {
            botLog.info("[MultiBot] Slash command registration disabled by configuration");
            return;
        }

        try {
            this.slashCommandData ??= buildApplicationCommandData(client);
            const commands = this.slashCommandData;
            if (commands.length === 0) {
                botLog.info("[MultiBot] No application commands to register");
                return;
            }

            if (client.config.isDev) {
                for (const id of client.config.mainServer) {
                    try {
                        const guild = await client.guilds.fetch(id).catch(() => null);
                        if (!guild) {
                            botLog.error(`[MultiBot] Unable to fetch dev guild ${id}`);
                            continue;
                        }
                        await guild.commands.set(commands);
                        botLog.info(
                            `[MultiBot] Registered ${commands.length} commands to dev guild ${guild.name} [${guild.id}]`,
                        );
                    } catch (error: unknown) {
                        botLog.error(
                            { err: error, guildId: id, phase: "guild-commands-set" },
                            "[MultiBot] SLASH_CMD_REGISTER_ERR for dev guild",
                        );
                    }
                }
                return;
            }

            if (!client.application) {
                botLog.warn(
                    "[MultiBot] client.application unavailable, skipping slash command registration",
                );
                return;
            }

            await client.application.commands.set(commands);
            botLog.info(`[MultiBot] Registered ${commands.length} application commands globally`);
        } catch (error: unknown) {
            botLog.error(
                { err: error, phase: "application-commands-set" },
                "[MultiBot] SLASH_CMD_REGISTER_ERR",
            );
        }
    }

    private async saveAllQueueStates(): Promise<void> {
        const savePromises: Promise<void>[] = [];
        for (const client of this.clients) {
            for (const [guildId, guild] of client.guilds.cache) {
                if (guild.queue) {
                    const timeout = new Promise<void>((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Save timeout for guild ${guildId}`)),
                            MultiBotLauncher.SAVE_QUEUE_TIMEOUT_MS,
                        ),
                    );
                    savePromises.push(
                        Promise.race([guild.queue.saveQueueState(), timeout]).catch((err) => {
                            log.warn(
                                `[Shutdown] Queue save timeout/skip for guild ${guildId}:`,
                                err,
                            );
                        }),
                    );
                }
            }
        }
        await Promise.all(savePromises);
    }

    private async gracefulShutdown(signal: string): Promise<void> {
        log.info(`Received ${signal}, shutting down gracefully...`);
        const shutdownStart = Date.now();

        const saveStart = Date.now();
        await this.saveAllQueueStates();
        log.info(`[Shutdown] Queue states saved in ${Date.now() - saveStart}ms`);

        const cookiesStart = Date.now();
        const firstClient = this.clients[0];
        if (firstClient?.cookies) {
            await firstClient.cookies.shutdown().catch(() => {});
        }
        log.info(`[Shutdown] Browser closed in ${Date.now() - cookiesStart}ms`);

        for (const client of this.clients) {
            client.destroy();
        }
        log.info(`[Shutdown] Complete in ${Date.now() - shutdownStart}ms`);

        process.exit(0);
    }

    private setupProcessHandlers(): void {
        process.on("SIGINT", () => void this.gracefulShutdown("SIGINT"));
        process.on("SIGTERM", () => void this.gracefulShutdown("SIGTERM"));

        process
            .on("exit", (code) => log.info(`NodeJS process exited with code ${code}`))
            .on("unhandledRejection", (reason) => {
                const message = (reason as Error).stack ?? String(reason);
                log.error(`UNHANDLED_REJECTION: ${message}`);
            })
            .on("warning", (warning) => log.warn(`NODE_WARNING: ${warning}`))
            .on("uncaughtException", (err) => {
                log.error(`UNCAUGHT_EXCEPTION: ${err.stack ?? err}`);
                log.warn(
                    "Uncaught Exception detected, attempting to save queue states before exit...",
                );
                void this.saveAllQueueStates()
                    .then(() => {
                        log.info("[Crash] Queue states saved before exit");
                    })
                    .catch((saveErr) => {
                        log.warn("[Crash] Failed to save queue states:", saveErr);
                    })
                    .finally(() => {
                        process.exit(1);
                    });
            });
    }

    private async createBotInstance(
        token: string,
        tokenIndex: number,
        options: typeof clientOptions,
    ): Promise<Rawon> {
        const client = new Rawon(options);
        client.on("clientReady", () => {
            const botLog = log.child({
                bot: `#${tokenIndex} ${client.user?.tag ?? "unknown"}`,
            });
            botLog.info(`[MultiBot] Bot is ready! (${client.guilds.cache.size} guilds)`);
            void this.registerSlashCommands(client, botLog);

            botLog.info(
                `[MultiBot] Diagnostics: interactionCreate listeners=${client.listenerCount("interactionCreate")}, ` +
                    `messageCreate listeners=${client.listenerCount("messageCreate")}, ` +
                    `voiceStateUpdate listeners=${client.listenerCount("voiceStateUpdate")}, ` +
                    `isContainerClient=${container.client === client}`,
            );

            for (const guild of client.guilds.cache.values()) {
                const member = guild.members.cache.get(client.user!.id);
                botLog.debug(
                    `[MultiBot] In guild ${guild.name} (${guild.id}), member cached: ${member !== undefined}`,
                );
            }
        });

        client.on("error", (error) => {
            log.error(
                { err: error, bot: `#${tokenIndex}`, tag: client.user?.tag ?? "not-ready" },
                "[MultiBot] Client error",
            );
        });

        client.on("warn", (warning) => {
            log.warn(
                { bot: `#${tokenIndex}`, tag: client.user?.tag ?? "not-ready" },
                `[MultiBot] Client warning: ${warning}`,
            );
        });
        await client.build(token);
        if (client.user) {
            this.multiBotManager.registerBot(client, tokenIndex, client.user.id);
            log.info(
                `[MultiBot] Registered bot instance ${client.user.tag} (${client.user.id}) at index ${tokenIndex}`,
            );
        }

        return client;
    }

    public async start(): Promise<void> {
        this.setupProcessHandlers();

        if (!isMultiBot || discordTokens.length <= 1) {
            const token = discordTokens[0] ?? process.env.DISCORD_TOKEN;
            if (!token) {
                log.error("[FATAL] DISCORD_TOKEN is not set!");
                process.exit(1);
            }

            const client = await this.createBotInstance(token, 0, clientOptions);
            this.clients.push(client);
            log.info("[MultiBot] Single bot mode - Started 1 bot instance.");
            return;
        }
        log.info(`[MultiBot] Starting ${discordTokens.length} bot instances...`);

        for (let i = 0; i < discordTokens.length; i++) {
            const token = discordTokens[i];

            if (!token) {
                log.warn(`[MultiBot] Token #${i} is empty, skipping...`);
                continue;
            }

            try {
                const client = await this.createBotInstance(token, i, clientOptions);
                this.clients.push(client);
            } catch (error: unknown) {
                log.error(`[MultiBot] Error starting bot #${i}: ${error}`);
                throw error;
            }
        }

        log.info(`[MultiBot] Successfully started ${this.clients.length} bot instances!`);
    }

    public getClients(): Rawon[] {
        return this.clients;
    }

    public async shutdown(): Promise<void> {
        log.info("[MultiBot] Shutting down all bot instances...");
        await this.saveAllQueueStates();

        const destroyPromises = this.clients.map(async (client) => {
            try {
                return await client.destroy();
            } catch (error) {
                log.error(`[MultiBot] Error destroying client: ${error}`);
            }
        });

        await Promise.all(destroyPromises);
        log.info("[MultiBot] All bot instances shut down.");
    }
}

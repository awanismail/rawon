import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import {
    ChannelType,
    type GuildMember,
    type Message,
    PermissionFlagsBits,
    PermissionsBitField,
    type SlashCommandBuilder,
    type StageChannel,
    type TextChannel,
    type VoiceChannel,
} from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { type ChatPlayOptions } from "../../utils/structures/RequestChannelManager.js";

const CHATPLAY_SLOWMODE_SECONDS = 5;

@ApplyOptions<Command.Options>({
    name: "chatplay",
    aliases: ["requestchannel", "rc", "reqchannel", "musicchannel"],
    description: i18n.__("commands.music.chatplay.description"),
    detailedDescription: { usage: i18n.__("commands.music.chatplay.usage") },
    requiredClientPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ],
    chatInputCommand(
        builder: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[0],
        opts: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[1],
    ): SlashCommandBuilder {
        return builder
            .setName(opts.name ?? "chatplay")
            .setDescription(opts.description ?? i18n.__("commands.music.chatplay.description"))
            .addSubcommand((sub) =>
                sub
                    .setName("set")
                    .setDescription(i18n.__("commands.music.chatplay.slashSetDescription"))
                    .addChannelOption((opt) =>
                        opt
                            .setName("channel")
                            .setDescription(
                                i18n.__("commands.music.chatplay.slashChannelDescription"),
                            )
                            .addChannelTypes(
                                ChannelType.GuildText,
                                ChannelType.GuildVoice,
                                ChannelType.GuildStageVoice,
                            )
                            .setRequired(true),
                    )
                    .addStringOption((opt) =>
                        opt
                            .setName("mode")
                            .setDescription(i18n.__("commands.music.chatplay.slashModeDescription"))
                            .addChoices(
                                { name: i18n.__("requestChannel.modeChat"), value: "chat" },
                                { name: i18n.__("requestChannel.modeCommand"), value: "command" },
                            ),
                    )
                    .addBooleanOption((opt) =>
                        opt
                            .setName("smartfilter")
                            .setDescription(
                                i18n.__("commands.music.chatplay.slashSmartFilterDescription"),
                            ),
                    )
                    .addBooleanOption((opt) =>
                        opt
                            .setName("autodelete")
                            .setDescription(
                                i18n.__("commands.music.chatplay.slashAutoDeleteDescription"),
                            ),
                    )
                    .addBooleanOption((opt) =>
                        opt
                            .setName("slowmode")
                            .setDescription(
                                i18n.__("commands.music.chatplay.slashSlowmodeDescription"),
                            ),
                    )
                    .addBooleanOption((opt) =>
                        opt
                            .setName("pin")
                            .setDescription(i18n.__("commands.music.chatplay.slashPinDescription")),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("remove")
                    .setDescription(i18n.__("commands.music.chatplay.slashRemoveDescription")),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("status")
                    .setDescription(i18n.__("commands.music.chatplay.slashStatusDescription")),
            ) as SlashCommandBuilder;
    },
})
export class ChatPlayCommand extends ContextCommand {
    private isSupportedRequestChannel(
        channel:
            | LocalCommandContext["channel"]
            | ReturnType<NonNullable<LocalCommandContext["options"]>["getChannel"]>
            | undefined,
    ): channel is TextChannel | VoiceChannel | StageChannel {
        return (
            channel !== null &&
            channel !== undefined &&
            [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(
                channel.type,
            )
        );
    }

    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    private parseBooleanArg(value: string | undefined): boolean | undefined {
        if (value === undefined) {
            return undefined;
        }
        const normalized = value.toLowerCase();
        if (["yes", "true", "on", "enable", "1"].includes(normalized)) {
            return true;
        }
        if (["no", "false", "off", "disable", "0"].includes(normalized)) {
            return false;
        }
        return undefined;
    }

    public async contextRun(ctx: CommandContext): Promise<Message | undefined> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const __ = i18n__(client, localCtx.guild);
        const __mf = i18n__mf(client, localCtx.guild);

        const member = localCtx.member as GuildMember | null;
        const hasPermission =
            member?.permissions instanceof PermissionsBitField
                ? member.permissions.has(PermissionsBitField.Flags.ManageGuild)
                : false;
        if (!hasPermission || !localCtx.guild) {
            return localCtx.reply({
                embeds: [
                    createEmbed("error", __("commands.music.requestChannel.noPermission"), true),
                ],
            });
        }

        const subcommand = localCtx.options?.getSubcommand() ?? localCtx.args[0]?.toLowerCase();

        if (subcommand === "set") {
            const channel =
                localCtx.options?.getChannel("channel") ??
                (localCtx.args[1]
                    ? localCtx.guild.channels.cache.get(localCtx.args[1].replaceAll(/[<#>]/gu, ""))
                    : undefined);

            if (!this.isSupportedRequestChannel(channel)) {
                return localCtx.reply({
                    embeds: [
                        createEmbed("warn", __("commands.music.requestChannel.invalidChannel")),
                    ],
                });
            }

            const options: Partial<ChatPlayOptions> = {};
            const slashMode = localCtx.options?.getString("mode");
            if (slashMode === "chat" || slashMode === "command") {
                options.mode = slashMode;
            } else {
                const argMode = localCtx.args[2]?.toLowerCase();
                if (argMode === "chat" || argMode === "command") {
                    options.mode = argMode;
                }
            }
            const booleanArgs: [keyof ChatPlayOptions, boolean | null | undefined, number][] = [
                ["smartFilter", localCtx.options?.getBoolean("smartfilter"), 3],
                ["autoDelete", localCtx.options?.getBoolean("autodelete"), 4],
                ["slowmode", localCtx.options?.getBoolean("slowmode"), 5],
                ["pinPlayer", localCtx.options?.getBoolean("pin"), 6],
            ];
            for (const [key, slashValue, argIndex] of booleanArgs) {
                const parsed = slashValue ?? this.parseBooleanArg(localCtx.args[argIndex]);
                if (parsed !== undefined && parsed !== null) {
                    options[key] = parsed as never;
                }
            }

            const currentChannel = client.requestChannelManager.getRequestChannel(localCtx.guild);
            if (currentChannel && currentChannel.id !== channel.id) {
                return localCtx.reply({
                    embeds: [
                        createEmbed(
                            "error",
                            __mf("commands.music.requestChannel.alreadyHasChannel", {
                                channel: `<#${currentChannel.id}>`,
                            }),
                            true,
                        ),
                    ],
                });
            }

            const isChannelUsedByAnyBot = client.requestChannelManager.isRequestChannel(
                localCtx.guild,
                channel.id,
            );

            if (isChannelUsedByAnyBot && currentChannel?.id !== channel.id) {
                return localCtx.reply({
                    embeds: [
                        createEmbed(
                            "error",
                            __("commands.music.requestChannel.channelAlreadyInUse"),
                            true,
                        ),
                    ],
                });
            }

            let botMember = localCtx.guild.members.cache.get(client.user!.id);
            if (!botMember) {
                try {
                    botMember = await localCtx.guild.members.fetch(client.user!.id);
                } catch {
                    const fallbackPermission = "**`View Channel`**";
                    return localCtx.reply({
                        embeds: [
                            createEmbed(
                                "error",
                                `<#${channel.id}>\n${__mf(
                                    "commands.music.requestChannel.missingBotPermissions",
                                    {
                                        permissions: fallbackPermission,
                                    },
                                )}`,
                                true,
                            ),
                        ],
                    });
                }
            }

            const botPermissions = channel.permissionsFor(botMember);

            const requiredPermissions = [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.ManageMessages,
            ];

            const missingPermissions = requiredPermissions.filter(
                (perm) => !botPermissions.has(perm),
            );

            if (missingPermissions.length > 0) {
                const permissionNames = missingPermissions.map((perm) => {
                    const flagName = Object.entries(PermissionsBitField.Flags).find(
                        ([, value]) => value === perm,
                    )?.[0];
                    const spacedName = (flagName ?? "Unknown").replace(/([a-z])([A-Z])/g, "$1 $2");
                    return `**\`${spacedName}\`**`;
                });
                return localCtx.reply({
                    embeds: [
                        createEmbed(
                            "error",
                            `<#${channel.id}>\n${__mf(
                                "commands.music.requestChannel.missingBotPermissions",
                                {
                                    permissions: permissionNames.join(", "),
                                },
                            )}`,
                            true,
                        ),
                    ],
                });
            }

            await client.requestChannelManager.setRequestChannel(localCtx.guild, channel.id);
            await client.requestChannelManager.setChatPlayOptions(localCtx.guild, options);

            const slowmodeEnabled = client.requestChannelManager.getRequestChannelOptions(
                localCtx.guild,
            ).slowmode;
            if ("rateLimitPerUser" in channel) {
                await channel
                    .setRateLimitPerUser(
                        slowmodeEnabled ? CHATPLAY_SLOWMODE_SECONDS : 0,
                        "ChatPlay setup",
                    )
                    .catch(() => null);
            }

            const playerMessage = await client.requestChannelManager.createOrUpdatePlayerMessage(
                localCtx.guild,
                true,
            );

            if (!playerMessage) {
                await client.requestChannelManager.setRequestChannel(localCtx.guild, null);
                return localCtx.reply({
                    embeds: [
                        createEmbed(
                            "error",
                            __("commands.music.requestChannel.failedToSetup"),
                            true,
                        ),
                    ],
                });
            }

            return localCtx.reply({
                embeds: [
                    createEmbed(
                        "success",
                        __mf("requestChannel.setChannel", { channel: `<#${channel.id}>` }),
                        true,
                    ),
                ],
            });
        }

        if (subcommand === "remove") {
            const existingChannel = client.requestChannelManager.getRequestChannel(localCtx.guild);
            if (!existingChannel) {
                return localCtx.reply({
                    embeds: [
                        createEmbed("warn", __("commands.music.requestChannel.noChannelToRemove")),
                    ],
                });
            }

            if (
                "rateLimitPerUser" in existingChannel &&
                (existingChannel.rateLimitPerUser ?? 0) > 0
            ) {
                await existingChannel.setRateLimitPerUser(0, "ChatPlay removal").catch(() => null);
            }

            await client.requestChannelManager.setRequestChannel(localCtx.guild, null);

            return localCtx.reply({
                embeds: [createEmbed("success", __("requestChannel.removeChannel"), true)],
            });
        }

        const currentChannel = client.requestChannelManager.getRequestChannel(localCtx.guild);

        if (currentChannel) {
            const chatPlayOptions = client.requestChannelManager.getRequestChannelOptions(
                localCtx.guild,
            );
            const optionLines = [
                `🎛️ ${__("requestChannel.modeLabel")}: **\`${
                    chatPlayOptions.mode === "command"
                        ? __("requestChannel.modeCommand")
                        : __("requestChannel.modeChat")
                }\`**`,
                `🧠 ${__("requestChannel.smartFilter")}: **\`${chatPlayOptions.smartFilter ? "ON" : "OFF"}\`**`,
                `🧹 ${__("requestChannel.autoDelete")}: **\`${chatPlayOptions.autoDelete ? "ON" : "OFF"}\`**`,
                `🐌 ${__("requestChannel.slowmode")}: **\`${chatPlayOptions.slowmode ? "ON" : "OFF"}\`**`,
                `📌 ${__("requestChannel.pinPlayer")}: **\`${chatPlayOptions.pinPlayer ? "ON" : "OFF"}\`**`,
            ].join("\n");

            return localCtx.reply({
                embeds: [
                    createEmbed(
                        "info",
                        `${__mf("requestChannel.currentChannel", {
                            channel: `<#${currentChannel.id}>`,
                        })}\n${optionLines}`,
                    ),
                ],
            });
        }

        return localCtx.reply({
            embeds: [createEmbed("warn", __("requestChannel.noChannel"))],
        });
    }
}

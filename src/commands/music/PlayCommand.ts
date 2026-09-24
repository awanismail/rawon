import { setTimeout } from "node:timers";
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import {
    type AutocompleteInteraction,
    type GuildMember,
    type Message,
    PermissionFlagsBits,
    type SlashCommandBuilder,
    type VoiceBasedChannel,
} from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Song } from "../../typings/index.js";
import { inVC, sameVC, useRequestChannel, validVC } from "../../utils/decorators/MusicUtil.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { formatBoldPrefixedCommand } from "../../utils/functions/formatCodeSpan.js";
import { getEffectivePrefix } from "../../utils/functions/getEffectivePrefix.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { ResolveRateLimitError } from "../../utils/functions/resolveLimiter.js";
import { isMemberDeafened } from "../../utils/functions/voiceStateGuards.js";
import { checkQuery, handleVideos, searchTrack } from "../../utils/handlers/GeneralUtil.js";
import {
    PluginSourceUnsupportedError,
    YouTubeNotSupportedInModeError,
} from "../../utils/handlers/general/searchTrack.js";

const TRACK_CHOICE_PREFIX = "nadatrack:";
const TRACK_CHOICE_TTL_MS = 5 * 60_000;
const AUTOCOMPLETE_TIMEOUT_MS = 2_500;

type TrackChoiceCache = { songs: Song[]; expiresAt: number };
const trackChoiceCache = new Map<string, TrackChoiceCache>();

function rememberTrackChoices(userId: string, songs: Song[]): void {
    trackChoiceCache.set(userId, { songs, expiresAt: Date.now() + TRACK_CHOICE_TTL_MS });
    if (trackChoiceCache.size > 500) {
        const now = Date.now();
        for (const [key, cache] of trackChoiceCache) {
            if (cache.expiresAt < now) {
                trackChoiceCache.delete(key);
            }
        }
    }
}

function takeTrackChoice(userId: string, rawQuery: string): Song | null {
    const match = /^nadatrack:(\d+)$/u.exec(rawQuery.trim());
    if (!match) {
        return null;
    }
    const cache = trackChoiceCache.get(userId);
    if (!cache || cache.expiresAt < Date.now()) {
        return null;
    }
    return cache.songs[Number(match[1])] ?? null;
}

@ApplyOptions<Command.Options>({
    name: "play",
    aliases: ["p", "add"],
    description: i18n.__("commands.music.play.description"),
    detailedDescription: { usage: i18n.__("commands.music.play.usage") },
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
            .setName(opts.name ?? "play")
            .setDescription(opts.description ?? i18n.__("commands.music.play.description"))
            .addStringOption((opt) =>
                opt
                    .setName("query")
                    .setDescription(i18n.__("commands.music.play.slashQueryDescription"))
                    .setRequired(true)
                    .setAutocomplete(true),
            ) as SlashCommandBuilder;
    },
})
export class PlayCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    public override async autocompleteRun(interaction: AutocompleteInteraction): Promise<void> {
        const client = interaction.client as Rawon;
        const focused = interaction.options.getFocused().trim();

        if (focused.length < 2) {
            await interaction.respond([]).catch(() => null);
            return;
        }

        const search = searchTrack(client, focused, "youtube", {
            guildId: interaction.guildId ?? undefined,
            userId: interaction.user.id,
        }).catch(() => null);

        const timeout = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), AUTOCOMPLETE_TIMEOUT_MS);
        });

        const result = await Promise.race([search, timeout]);
        if (!result || result.items.length === 0) {
            await interaction.respond([]).catch(() => null);
            return;
        }

        const songs = result.items.slice(0, 25);
        rememberTrackChoices(interaction.user.id, songs);

        await interaction
            .respond(
                songs.map((song, index) => ({
                    name: `${song.title}${song.author ? ` — ${song.author}` : ""}`.slice(0, 100),
                    value: `${TRACK_CHOICE_PREFIX}${index}`,
                })),
            )
            .catch(() => null);
    }

    private formatSearchError(error: unknown): string {
        return error instanceof Error && error.message
            ? error.message
            : i18n.__("commands.music.play.noSongData");
    }

    @useRequestChannel
    @inVC
    @validVC
    @sameVC
    public async contextRun(ctx: CommandContext): Promise<Message | undefined> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const member = localCtx.member as GuildMember | null;
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);

        if (isMemberDeafened(member)) {
            return ctx.reply({
                embeds: [createEmbed("warn", __("requestChannel.deafened"))],
            });
        }

        if (ctx.isCommandInteraction() && !localCtx.deferred) {
            await localCtx.deferReply();
        }

        const voiceChannel = member?.voice.channel as VoiceBasedChannel;
        if (localCtx.additionalArgs.get("fromSearch") !== undefined) {
            const tracks = localCtx.additionalArgs.get("values") as string[];
            const searchResults = await Promise.all(
                tracks.map(async (track) => searchTrack(client, track).catch(() => null)),
            );
            const toQueue = searchResults
                .filter((result): result is NonNullable<typeof result> => result !== null)
                .map((result) => result.items[0]);

            return handleVideos(client, localCtx, toQueue, voiceChannel);
        }

        const audioAttachment = localCtx.isMessage()
            ? localCtx.context.attachments.find((a) => a.contentType?.startsWith("audio/"))
            : undefined;
        const query =
            (localCtx.args.join(" ") ||
                localCtx.options?.getString("query") ||
                audioAttachment?.url) ??
            (localCtx.additionalArgs.get("values") === undefined
                ? undefined
                : (localCtx.additionalArgs.get("values") as (string | undefined)[])[0]);

        if ((query?.length ?? 0) === 0) {
            const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
            return ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("reusable.invalidUsage", {
                            prefix: formatBoldPrefixedCommand(prefix, "help"),
                            name: `**\`${this.options.name}\`**`,
                        }),
                    ),
                ],
            });
        }

        // Pilihan dari autocomplete: pakai lagu yang sudah di-cache — tanpa pencarian ulang.
        const chosenTrack = takeTrackChoice(ctx.author.id, query ?? "");
        if (chosenTrack !== null) {
            return handleVideos(client, localCtx, [chosenTrack], voiceChannel);
        }

        if (ctx.guild?.queue && voiceChannel.id !== ctx.guild.queue.voiceChannelId) {
            return ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.play.alreadyPlaying", {
                            voiceChannel: `**\`${
                                ctx.guild.channels.cache.get(ctx.guild.queue.voiceChannelId ?? "")
                                    ?.name ?? "#unknown-channel"
                            }\`**`,
                        }),
                    ),
                ],
            });
        }

        const queryCheck = checkQuery(query ?? "");
        const isCollectionQuery = queryCheck.type === "playlist" || queryCheck.type === "artist";

        const resolvingMsg = isCollectionQuery
            ? __mf("requestChannel.resolvingPlaylist")
            : __mf("requestChannel.resolvingSong");
        const resolvingEmbed = createEmbed("info", `🔍 **|** ${resolvingMsg}`);

        let progressMessage: Message | undefined;
        if (localCtx.deferred) {
            await localCtx.editReply({ embeds: [resolvingEmbed] });
        } else {
            progressMessage = await ctx.reply({ embeds: [resolvingEmbed] }).catch(() => undefined);
        }

        const searchError: { value: unknown } = { value: null };
        const songs = await searchTrack(client, query ?? "", "youtube", {
            guildId: ctx.guild?.id,
            userId: ctx.author.id,
        }).catch((error: unknown) => {
            searchError.value = error;
            client.logger.error("[PlayCommand] searchTrack failed:", error);
            return undefined;
        });

        if (!songs || songs.items.length <= 0) {
            let errorText: string | undefined = searchError.value
                ? this.formatSearchError(searchError.value)
                : undefined;
            if (searchError.value instanceof YouTubeNotSupportedInModeError) {
                errorText = __("commands.music.play.youtubeNotSupportedMode");
            } else if (searchError.value instanceof PluginSourceUnsupportedError) {
                errorText = __mf("commands.music.play.pluginSourceUnavailable", {
                    platform: searchError.value.platform,
                });
            } else if (searchError.value instanceof ResolveRateLimitError) {
                errorText = __("requestChannel.rateLimited");
            }
            const errorEmbed = createEmbed(
                "error",
                errorText ?? __("commands.music.play.noSongData"),
                true,
            );
            if (progressMessage) {
                return progressMessage.edit({ embeds: [errorEmbed] });
            }
            return ctx.reply({ embeds: [errorEmbed] });
        }

        if (progressMessage) {
            void progressMessage.delete().catch(() => null);
        }

        return handleVideos(
            client,
            localCtx,
            isCollectionQuery ? songs.items : [songs.items[0]],
            voiceChannel,
            isCollectionQuery ? songs.playlist : undefined,
        );
    }
}

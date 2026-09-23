import { type AudioPlayerPlayingState, AudioPlayerStatus } from "@discordjs/voice";
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder, type VoiceBasedChannel } from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Playlist, type QueueSong } from "../../typings/index.js";
import { chunk } from "../../utils/functions/chunk.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import {
    formatBoldMarkdownLink,
    formatMarkdownLink,
} from "../../utils/functions/formatMarkdown.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import {
    ensureFavorites,
    ensureMusicChannel,
    findSavedSongIndex,
    PLAYLIST_LIMITS,
    storedToSong,
    toSavedPlaylistSong,
} from "../../utils/functions/playlist.js";
import { handleVideos } from "../../utils/handlers/GeneralUtil.js";
import { ButtonPagination } from "../../utils/structures/ButtonPagination.js";

@ApplyOptions<Command.Options>({
    name: "favorite",
    aliases: ["fav", "like"],
    description: i18n.__("commands.music.favorite.description"),
    detailedDescription: { usage: i18n.__("commands.music.favorite.usage") },
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
            .setName(opts.name ?? "favorite")
            .setDescription(opts.description ?? i18n.__("commands.music.favorite.description"))
            .addSubcommand((sub) =>
                sub.setName("toggle").setDescription(i18n.__("commands.music.favorite.subToggle")),
            )
            .addSubcommand((sub) =>
                sub.setName("list").setDescription(i18n.__("commands.music.favorite.subList")),
            )
            .addSubcommand((sub) =>
                sub.setName("play").setDescription(i18n.__("commands.music.favorite.subPlay")),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("remove")
                    .setDescription(i18n.__("commands.music.favorite.subRemove"))
                    .addIntegerOption((opt) =>
                        opt
                            .setName("position")
                            .setDescription(
                                i18n.__("commands.music.favorite.subPositionDescription"),
                            )
                            .setRequired(true),
                    ),
            ) as SlashCommandBuilder;
    },
})
export class FavoriteCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    private async toggle(ctx: CommandContext, client: Rawon): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const queue = ctx.guild?.queue;
        if (!queue || queue.player.state.status !== AudioPlayerStatus.Playing) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.nothingPlaying"))],
            });
            return;
        }
        const np = (queue.player.state as AudioPlayerPlayingState).resource.metadata as QueueSong;
        const favorites = await ensureFavorites(client, ctx.author.id);
        const existingIndex = findSavedSongIndex(favorites.songs, np.song.url);
        if (existingIndex !== -1) {
            favorites.songs.splice(existingIndex, 1);
            await client.data.saveUserPlaylist(favorites);
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "success",
                        __mf("commands.music.favorite.removed", {
                            song: formatBoldMarkdownLink(np.song.title, np.song.url),
                        }),
                        true,
                    ),
                ],
            });
            return;
        }
        if (favorites.songs.length >= PLAYLIST_LIMITS.maxTracks) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.trackLimitReached", {
                            name: favorites.name,
                            max: PLAYLIST_LIMITS.maxTracks,
                        }),
                    ),
                ],
            });
            return;
        }
        favorites.songs.push(toSavedPlaylistSong(np.song));
        await client.data.saveUserPlaylist(favorites);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.favorite.added", {
                        song: formatBoldMarkdownLink(np.song.title, np.song.url),
                    }),
                    true,
                ),
            ],
        });
    }

    private async list(ctx: CommandContext, client: Rawon): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const favorites = client.data.getUserPlaylistByName(
            ctx.author.id,
            PLAYLIST_LIMITS.favoritesName,
        );
        if (favorites === null || favorites.songs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.empty"))],
            });
            return;
        }
        const pages = chunk(favorites.songs, 10).map((songs, pageIndex) =>
            songs
                .map(
                    (song, songIndex) =>
                        `${pageIndex * 10 + songIndex + 1} - ${formatMarkdownLink(
                            song.title,
                            song.url,
                        )}`,
                )
                .join("\n"),
        );
        const embed = createEmbed("info", pages[0]).setTitle(
            `❤️ ${__("commands.music.favorite.listTitle")}`,
        );
        const msg = await ctx.reply({ embeds: [embed] });
        await new ButtonPagination(msg, {
            author: ctx.author.id,
            edit: (i, emb, page) =>
                emb.setDescription(page).setFooter({
                    text: `• ${__mf("reusable.pageFooter", {
                        actual: i + 1,
                        total: pages.length,
                    })}`,
                }),
            embed,
            pages,
        }).start();
    }

    private async play(ctx: CommandContext, client: Rawon): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const favorites = client.data.getUserPlaylistByName(
            ctx.author.id,
            PLAYLIST_LIMITS.favoritesName,
        );
        if (favorites === null || favorites.songs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.empty"))],
            });
            return;
        }
        await this.playFavorites(ctx, client, favorites);
    }

    private async playFavorites(
        ctx: CommandContext,
        client: Rawon,
        favorites: Playlist,
    ): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);

        if (!ensureMusicChannel(localCtx, client, __mf)) {
            return;
        }

        const guild = ctx.guild;
        const member =
            localCtx.member ?? (await guild?.members.fetch(ctx.author.id).catch(() => null));
        const voiceChannel = member?.voice.channel as VoiceBasedChannel | null | undefined;
        if (!voiceChannel) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("utils.musicDecorator.noInVC"))],
            });
            return;
        }
        if (guild?.queue && voiceChannel.id !== guild.queue.connection?.joinConfig.channelId) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.play.alreadyPlaying", {
                            voiceChannel: `**\`${
                                guild.channels.cache.get(
                                    (guild.queue.connection?.joinConfig as { channelId: string })
                                        .channelId,
                                )?.name ?? "#unknown-channel"
                            }\`**`,
                        }),
                    ),
                ],
            });
            return;
        }

        if (ctx.isCommandInteraction() && !localCtx.deferred) {
            await localCtx.deferReply();
        }

        await handleVideos(client, localCtx, favorites.songs.map(storedToSong), voiceChannel, {
            title: __("commands.music.favorite.listTitle"),
            url: "",
        });
    }

    private async remove(
        ctx: CommandContext,
        client: Rawon,
        position: number | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const favorites = client.data.getUserPlaylistByName(
            ctx.author.id,
            PLAYLIST_LIMITS.favoritesName,
        );
        if (favorites === null || favorites.songs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.empty"))],
            });
            return;
        }
        const index = position ?? Number.NaN;
        if (!Number.isInteger(index) || index < 1 || index > favorites.songs.length) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.favorite.invalidIndex", {
                            max: favorites.songs.length,
                        }),
                    ),
                ],
            });
            return;
        }
        const [removed] = favorites.songs.splice(index - 1, 1);
        await client.data.saveUserPlaylist(favorites);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.favorite.removedTrack", {
                        position: index,
                        song: formatMarkdownLink(removed.title, removed.url),
                    }),
                    true,
                ),
            ],
        });
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as unknown as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const arg = localCtx.args[0]?.toLowerCase();
        const sub =
            localCtx.options?.getSubcommand(false) ??
            (["list", "play", "remove"].includes(arg ?? "") ? arg : "toggle");

        switch (sub) {
            case "list":
                await this.list(ctx, client);
                return;
            case "play":
                await this.play(ctx, client);
                return;
            case "remove": {
                const position =
                    localCtx.options?.getInteger("position") ?? Number(localCtx.args[1]);
                await this.remove(ctx, client, position);
                return;
            }
            default:
                await this.toggle(ctx, client);
        }
    }
}

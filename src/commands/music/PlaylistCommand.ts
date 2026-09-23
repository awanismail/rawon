import { Buffer } from "node:buffer";
import { setTimeout } from "node:timers";
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import {
    ActionRowBuilder,
    type APIMessageTopLevelComponent,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    PermissionFlagsBits,
    type SlashCommandBuilder,
    StringSelectMenuBuilder,
    type VoiceBasedChannel,
} from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Playlist, type PlaylistMeta } from "../../typings/index.js";
import { chunk } from "../../utils/functions/chunk.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import {
    formatBoldMarkdownLink,
    formatMarkdownLink,
    formatMarkdownText,
} from "../../utils/functions/formatMarkdown.js";
import { getEffectivePrefix } from "../../utils/functions/getEffectivePrefix.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import {
    ensureMusicChannel,
    findSavedSongIndex,
    PLAYLIST_LIMITS,
    storedToSong,
    toSavedPlaylistSong,
    validatePlaylistName,
} from "../../utils/functions/playlist.js";
import { checkQuery, handleVideos, searchTrack } from "../../utils/handlers/GeneralUtil.js";
import { ButtonPagination } from "../../utils/structures/ButtonPagination.js";

const pendingAddQueries = new Map<string, { query: string }>();

function splitSelectValue(value: string): [string, string] {
    const separator = value.indexOf(":");
    if (separator === -1) {
        return ["", ""];
    }
    return [value.slice(0, separator), value.slice(separator + 1)];
}

@ApplyOptions<Command.Options>({
    name: "playlist",
    aliases: ["pl"],
    description: i18n.__("commands.music.playlist.description"),
    detailedDescription: { usage: i18n.__("commands.music.playlist.usage") },
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
            .setName(opts.name ?? "playlist")
            .setDescription(opts.description ?? i18n.__("commands.music.playlist.description"))
            .addSubcommand((sub) =>
                sub
                    .setName("create")
                    .setDescription(i18n.__("commands.music.playlist.subCreate"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("delete")
                    .setDescription(i18n.__("commands.music.playlist.subDelete"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("rename")
                    .setDescription(i18n.__("commands.music.playlist.subRename"))
                    .addStringOption((opt) =>
                        opt
                            .setName("from")
                            .setDescription(i18n.__("commands.music.playlist.subFromDescription"))
                            .setRequired(true),
                    )
                    .addStringOption((opt) =>
                        opt
                            .setName("to")
                            .setDescription(i18n.__("commands.music.playlist.subToDescription"))
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub.setName("list").setDescription(i18n.__("commands.music.playlist.subList")),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("info")
                    .setDescription(i18n.__("commands.music.playlist.subInfo"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("add")
                    .setDescription(i18n.__("commands.music.playlist.subAdd"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(false),
                    )
                    .addStringOption((opt) =>
                        opt
                            .setName("query")
                            .setDescription(i18n.__("commands.music.playlist.subQueryDescription"))
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("remove")
                    .setDescription(i18n.__("commands.music.playlist.subRemove"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(true),
                    )
                    .addIntegerOption((opt) =>
                        opt
                            .setName("position")
                            .setDescription(
                                i18n.__("commands.music.playlist.subPositionDescription"),
                            )
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("play")
                    .setDescription(i18n.__("commands.music.playlist.subPlay"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(false),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("save")
                    .setDescription(i18n.__("commands.music.playlist.subSave"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(true),
                    ),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("import")
                    .setDescription(i18n.__("commands.music.playlist.subImport"))
                    .addStringOption((opt) =>
                        opt
                            .setName("name")
                            .setDescription(i18n.__("commands.music.playlist.subNameDescription"))
                            .setRequired(true),
                    )
                    .addStringOption((opt) =>
                        opt
                            .setName("url")
                            .setDescription(i18n.__("commands.music.playlist.subUrlDescription"))
                            .setRequired(true),
                    ),
            ) as SlashCommandBuilder;
    },
})
export class PlaylistCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    private buildPlaylistSelect(
        userId: string,
        metas: PlaylistMeta[],
        placeholder: string,
        action: string,
    ): StringSelectMenuBuilder {
        return new StringSelectMenuBuilder()
            .setCustomId(Buffer.from(`${userId}_playlist`).toString("base64"))
            .setPlaceholder(placeholder)
            .addOptions(
                metas.slice(0, 25).map((meta) => ({
                    label: meta.name.length > 98 ? `${meta.name.slice(0, 97)}...` : meta.name,
                    description: `${meta.trackCount}`,
                    value: `${action}:${meta.playlistId}`,
                })),
            );
    }

    private async playPlaylist(
        ctx: CommandContext,
        client: Rawon,
        playlist: Playlist,
    ): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);

        if (!ensureMusicChannel(localCtx, client, __mf)) {
            return;
        }
        if (playlist.songs.length === 0) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.emptyPlaylist", {
                            name: playlist.name,
                        }),
                    ),
                ],
            });
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
                                    (
                                        guild.queue.connection?.joinConfig as {
                                            channelId: string;
                                        }
                                    ).channelId,
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

        await handleVideos(client, localCtx, playlist.songs.map(storedToSong), voiceChannel, {
            title: playlist.name,
            url: "",
        });
    }

    private async create(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if (name === undefined) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        const trimmed = name.trim();
        const error = validatePlaylistName(trimmed);
        if (error === "empty") {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        if (error === "tooLong") {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameTooLong", {
                            max: PLAYLIST_LIMITS.maxNameLength,
                        }),
                    ),
                ],
            });
            return;
        }
        if (error === "reserved") {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameReserved", {
                            name: trimmed,
                        }),
                    ),
                ],
            });
            return;
        }
        if (client.data.getUserPlaylistByName(userId, trimmed) !== null) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameTaken", { name: trimmed }),
                    ),
                ],
            });
            return;
        }
        const metas = client.data.getUserPlaylistMetas(userId);
        if (metas.filter((meta) => !meta.isSpecial).length >= PLAYLIST_LIMITS.maxPlaylists) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.limitReached", {
                            max: PLAYLIST_LIMITS.maxPlaylists,
                        }),
                    ),
                ],
            });
            return;
        }
        await client.data.createUserPlaylist(userId, trimmed);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.playlist.created", { name: trimmed }),
                    true,
                ),
            ],
        });
    }

    private async delete(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if (name === undefined) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        const playlist = client.data.getUserPlaylistByName(userId, name);
        if (playlist === null) {
            await ctx.reply({
                embeds: [createEmbed("warn", __mf("commands.music.playlist.notFound", { name }))],
            });
            return;
        }
        if (playlist.isSpecial) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.cannotDeleteFavorites"))],
            });
            return;
        }

        if (playlist.songs.length > 0) {
            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId("pldel_yes")
                    .setLabel(__("commands.music.playlist.deleteYes"))
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId("pldel_no")
                    .setLabel(__("commands.music.playlist.deleteNo"))
                    .setStyle(ButtonStyle.Secondary),
            );
            const msg = await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.deleteConfirm", {
                            name: playlist.name,
                            count: playlist.songs.length,
                        }),
                    ),
                ],
                components: [row.toJSON() as APIMessageTopLevelComponent],
            });
            let confirmed = false;
            try {
                const btn = await msg.awaitMessageComponent({
                    componentType: ComponentType.Button,
                    filter: (interaction) => interaction.user.id === ctx.author.id,
                    time: 30_000,
                });
                confirmed = btn.customId === "pldel_yes";
                await btn.update({ components: [] });
            } catch {
                await msg.edit({ components: [] }).catch(() => null);
            }
            if (!confirmed) {
                await msg
                    .edit({
                        embeds: [
                            createEmbed("info", __("commands.music.playlist.deleteCancelled")),
                        ],
                    })
                    .catch(() => null);
                return;
            }
        }

        const deleted = await client.data.deleteUserPlaylist(userId, playlist.name);
        await ctx.reply({
            embeds: [
                createEmbed(
                    deleted ? "success" : "error",
                    deleted
                        ? __mf("commands.music.playlist.deleted", { name: playlist.name })
                        : __mf("commands.music.playlist.notFound", { name: playlist.name }),
                    true,
                ),
            ],
        });
    }

    private async rename(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        from: string | undefined,
        to: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if (from === undefined || to === undefined || to.trim().length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        const playlist = client.data.getUserPlaylistByName(userId, from);
        if (playlist === null) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __mf("commands.music.playlist.notFound", { name: from })),
                ],
            });
            return;
        }
        if (playlist.isSpecial) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.cannotRenameFavorites"))],
            });
            return;
        }
        const targetName = to.trim();
        const error = validatePlaylistName(targetName);
        if (error === "empty") {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        if (error === "tooLong") {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameTooLong", {
                            max: PLAYLIST_LIMITS.maxNameLength,
                        }),
                    ),
                ],
            });
            return;
        }
        if (error === "reserved") {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameReserved", {
                            name: targetName,
                        }),
                    ),
                ],
            });
            return;
        }
        const clash = client.data.getUserPlaylistByName(userId, targetName);
        if (clash !== null && clash.playlistId !== playlist.playlistId) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameTaken", {
                            name: targetName,
                        }),
                    ),
                ],
            });
            return;
        }
        const renamed = await client.data.renameUserPlaylist(userId, playlist.name, targetName);
        await ctx.reply({
            embeds: [
                createEmbed(
                    renamed ? "success" : "error",
                    renamed
                        ? __mf("commands.music.playlist.renamed", {
                              from: playlist.name,
                              to: targetName,
                          })
                        : __mf("commands.music.playlist.notFound", { name: playlist.name }),
                    true,
                ),
            ],
        });
    }

    private async list(ctx: CommandContext, client: Rawon, userId: string): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const metas = client.data.getUserPlaylistMetas(userId);
        if (metas.length === 0) {
            const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __mf("commands.music.playlist.noPlaylists", { prefix })),
                ],
            });
            return;
        }
        const lines = metas.map(
            (meta, index) =>
                `${index + 1}. **${formatMarkdownText(meta.name)}** — ${__mf(
                    "commands.music.playlist.trackCountLabel",
                    { count: meta.trackCount },
                )}`,
        );
        await ctx.reply({
            embeds: [
                createEmbed("info", lines.join("\n")).setTitle(
                    `🎶 ${__("commands.music.playlist.listTitle")}`,
                ),
            ],
        });
    }

    private async info(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if (name === undefined) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        const playlist = client.data.getUserPlaylistByName(userId, name);
        if (playlist === null) {
            await ctx.reply({
                embeds: [createEmbed("warn", __mf("commands.music.playlist.notFound", { name }))],
            });
            return;
        }
        if (playlist.songs.length === 0) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.emptyPlaylist", {
                            name: playlist.name,
                        }),
                    ),
                ],
            });
            return;
        }
        const pages = chunk(playlist.songs, 10).map((songs, pageIndex) =>
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
            `📋 ${__mf("commands.music.playlist.infoTitle", { name: playlist.name })}`,
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

    private async add(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
        query: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if ((query?.length ?? 0) === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.noQuery"))],
            });
            return;
        }
        const queryText = query as string;
        const queryCheck = checkQuery(queryText);
        if (queryCheck.isURL && (queryCheck.type === "playlist" || queryCheck.type === "artist")) {
            const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.useImportForCollection", {
                            prefix,
                        }),
                    ),
                ],
            });
            return;
        }
        if (name === undefined || name.trim().length === 0) {
            const metas = client.data.getUserPlaylistMetas(userId);
            if (metas.length === 0) {
                const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
                await ctx.reply({
                    embeds: [
                        createEmbed(
                            "warn",
                            __mf("commands.music.playlist.noPlaylists", { prefix }),
                        ),
                    ],
                });
                return;
            }
            pendingAddQueries.set(userId, { query: queryText });
            setTimeout(() => pendingAddQueries.delete(userId), 60_000);
            await ctx.send({
                content: __("commands.music.playlist.selectAddPlaceholder"),
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>()
                        .addComponents(
                            this.buildPlaylistSelect(
                                userId,
                                metas,
                                __("commands.music.playlist.selectAddPlaceholder"),
                                "add",
                            ),
                        )
                        .toJSON() as APIMessageTopLevelComponent,
                ],
            });
            return;
        }
        const playlist = client.data.getUserPlaylistByName(userId, name);
        if (playlist === null) {
            await ctx.reply({
                embeds: [createEmbed("warn", __mf("commands.music.playlist.notFound", { name }))],
            });
            return;
        }
        await this.addSongTo(ctx, client, playlist, queryText);
    }

    private async addSongTo(
        ctx: CommandContext,
        client: Rawon,
        playlist: Playlist,
        query: string,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const songs = await searchTrack(client, query).catch(() => null);
        const song = songs?.items[0];
        if (!song) {
            await ctx.reply({
                embeds: [createEmbed("error", __("commands.music.playlist.noTracks"), true)],
            });
            return;
        }
        const duplicateIndex = findSavedSongIndex(playlist.songs, song.url);
        if (duplicateIndex !== -1) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.duplicateAt", {
                            song: formatBoldMarkdownLink(song.title, song.url),
                            name: playlist.name,
                            position: duplicateIndex + 1,
                        }),
                    ),
                ],
            });
            return;
        }
        if (playlist.songs.length >= PLAYLIST_LIMITS.maxTracks) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.trackLimitReached", {
                            name: playlist.name,
                            max: PLAYLIST_LIMITS.maxTracks,
                        }),
                    ),
                ],
            });
            return;
        }
        playlist.songs.push(toSavedPlaylistSong(song));
        await client.data.saveUserPlaylist(playlist);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.playlist.addedTo", {
                        song: formatBoldMarkdownLink(song.title, song.url),
                        name: playlist.name,
                    }),
                    true,
                ),
            ],
        });
    }

    private async remove(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
        position: number,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if (name === undefined) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        const playlist = client.data.getUserPlaylistByName(userId, name);
        if (playlist === null) {
            await ctx.reply({
                embeds: [createEmbed("warn", __mf("commands.music.playlist.notFound", { name }))],
            });
            return;
        }
        if (!Number.isInteger(position) || position < 1 || position > playlist.songs.length) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.invalidIndex", {
                            max: Math.max(playlist.songs.length, 1),
                        }),
                    ),
                ],
            });
            return;
        }
        const [removed] = playlist.songs.splice(position - 1, 1);
        await client.data.saveUserPlaylist(playlist);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.playlist.removedTrack", {
                        position,
                        song: formatMarkdownLink(removed.title, removed.url),
                        name: playlist.name,
                    }),
                    true,
                ),
            ],
        });
    }

    private async play(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        if (name === undefined || name.trim().length === 0) {
            const metas = client.data.getUserPlaylistMetas(userId);
            if (metas.length === 0) {
                const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
                await ctx.reply({
                    embeds: [
                        createEmbed(
                            "warn",
                            __mf("commands.music.playlist.noPlaylists", { prefix }),
                        ),
                    ],
                });
                return;
            }
            await ctx.send({
                content: __("commands.music.playlist.selectPlaceholder"),
                components: [
                    new ActionRowBuilder<StringSelectMenuBuilder>()
                        .addComponents(
                            this.buildPlaylistSelect(
                                userId,
                                metas,
                                __("commands.music.playlist.selectPlaceholder"),
                                "play",
                            ),
                        )
                        .toJSON() as APIMessageTopLevelComponent,
                ],
            });
            return;
        }
        const playlist = client.data.getUserPlaylistByName(userId, name);
        if (playlist === null) {
            await ctx.reply({
                embeds: [createEmbed("warn", __mf("commands.music.playlist.notFound", { name }))],
            });
            return;
        }
        await this.playPlaylist(ctx, client, playlist);
    }

    private async save(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const queue = ctx.guild?.queue;
        const queueSongs = queue ? [...queue.songs.sortByIndex().values()] : [];
        if (!queue || queueSongs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.queueEmpty"))],
            });
            return;
        }
        if (name === undefined) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        const trimmed = name.trim();
        const error = validatePlaylistName(trimmed);
        if (error === "empty") {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.nameEmpty"))],
            });
            return;
        }
        if (error === "tooLong") {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameTooLong", {
                            max: PLAYLIST_LIMITS.maxNameLength,
                        }),
                    ),
                ],
            });
            return;
        }
        if (error === "reserved") {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameReserved", {
                            name: trimmed,
                        }),
                    ),
                ],
            });
            return;
        }
        if (client.data.getUserPlaylistByName(userId, trimmed) !== null) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.nameTaken", { name: trimmed }),
                    ),
                ],
            });
            return;
        }
        const metas = client.data.getUserPlaylistMetas(userId);
        if (metas.filter((meta) => !meta.isSpecial).length >= PLAYLIST_LIMITS.maxPlaylists) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.limitReached", {
                            max: PLAYLIST_LIMITS.maxPlaylists,
                        }),
                    ),
                ],
            });
            return;
        }
        const playlist = await client.data.createUserPlaylist(userId, trimmed);
        const seen = new Set<string>();
        for (const queueSong of queueSongs) {
            if (playlist.songs.length >= PLAYLIST_LIMITS.maxTracks) {
                break;
            }
            const saved = toSavedPlaylistSong(queueSong.song);
            if (seen.has(saved.url)) {
                continue;
            }
            seen.add(saved.url);
            playlist.songs.push(saved);
        }
        await client.data.saveUserPlaylist(playlist);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.playlist.savedFromQueue", {
                        count: playlist.songs.length,
                        name: playlist.name,
                    }),
                    true,
                ),
            ],
        });
    }

    private async import(
        ctx: CommandContext,
        client: Rawon,
        userId: string,
        name: string | undefined,
        url: string | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const localCtx = ctx as CommandContext & LocalCommandContext;
        if (name === undefined || (url?.length ?? 0) === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.invalidImportUrl"))],
            });
            return;
        }
        const urlText = url as string;
        if (!checkQuery(urlText).isURL) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.playlist.invalidImportUrl"))],
            });
            return;
        }

        if (ctx.isCommandInteraction() && !localCtx.deferred) {
            await localCtx.deferReply();
        } else if (localCtx.deferred) {
            await localCtx.editReply({
                embeds: [createEmbed("info", `🔍 **|** ${__("requestChannel.resolvingPlaylist")}`)],
            });
        }

        const result = await searchTrack(client, urlText).catch(() => null);
        if (!result || result.items.length === 0) {
            const errorEmbed = createEmbed("error", __("commands.music.playlist.noTracks"), true);
            if (localCtx.deferred) {
                await localCtx.editReply({ embeds: [errorEmbed] });
            } else {
                await ctx.reply({ embeds: [errorEmbed] });
            }
            return;
        }

        let playlist = client.data.getUserPlaylistByName(userId, name);
        if (playlist === null) {
            const trimmed = name.trim();
            const error = validatePlaylistName(trimmed);
            if (error === "empty" || error === "tooLong" || error === "reserved") {
                const message =
                    error === "tooLong"
                        ? __mf("commands.music.playlist.nameTooLong", {
                              max: PLAYLIST_LIMITS.maxNameLength,
                          })
                        : error === "reserved"
                          ? __mf("commands.music.playlist.nameReserved", { name: trimmed })
                          : __("commands.music.playlist.nameEmpty");
                const errorEmbed = createEmbed("warn", message);
                if (localCtx.deferred) {
                    await localCtx.editReply({ embeds: [errorEmbed] });
                } else {
                    await ctx.reply({ embeds: [errorEmbed] });
                }
                return;
            }
            const metas = client.data.getUserPlaylistMetas(userId);
            if (metas.filter((meta) => !meta.isSpecial).length >= PLAYLIST_LIMITS.maxPlaylists) {
                const errorEmbed = createEmbed(
                    "warn",
                    __mf("commands.music.playlist.limitReached", {
                        max: PLAYLIST_LIMITS.maxPlaylists,
                    }),
                );
                if (localCtx.deferred) {
                    await localCtx.editReply({ embeds: [errorEmbed] });
                } else {
                    await ctx.reply({ embeds: [errorEmbed] });
                }
                return;
            }
            playlist = await client.data.createUserPlaylist(userId, trimmed);
        }

        let duplicates = 0;
        let dropped = 0;
        for (const item of result.items) {
            if (playlist.songs.length >= PLAYLIST_LIMITS.maxTracks) {
                dropped++;
                continue;
            }
            if (findSavedSongIndex(playlist.songs, item.url) !== -1) {
                duplicates++;
                continue;
            }
            playlist.songs.push(toSavedPlaylistSong(item));
        }
        await client.data.saveUserPlaylist(playlist);

        const source =
            result.playlist !== undefined && (result.playlist.url?.length ?? 0) > 0
                ? formatBoldMarkdownLink(result.playlist.title, result.playlist.url)
                : `**${formatMarkdownText(result.playlist?.title ?? urlText)}**`;
        const truncated =
            dropped > 0
                ? __mf("commands.music.playlist.importTruncatedSuffix", {
                      dropped,
                      max: PLAYLIST_LIMITS.maxTracks,
                  })
                : "";
        const addedCount = result.items.length - duplicates - dropped;
        const confirmEmbed = createEmbed(
            "success",
            __mf("commands.music.playlist.imported", {
                added: addedCount,
                name: playlist.name,
                source,
                skipped: duplicates,
                truncated,
            }),
            true,
        );
        if (localCtx.deferred) {
            await localCtx.editReply({ embeds: [confirmEmbed] });
        } else {
            await ctx.reply({ embeds: [confirmEmbed] });
        }
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const userId = ctx.author.id;

        const values = localCtx.additionalArgs.get("values") as string[] | undefined;
        if (values !== undefined && localCtx.isStringSelectMenu()) {
            const [action, playlistId] = splitSelectValue(values[0] ?? "");
            const playlist = client.data.getUserPlaylistById(userId, playlistId);
            if (playlist === null) {
                await ctx.reply({
                    embeds: [createEmbed("warn", __("commands.music.playlist.selectExpired"))],
                });
                return;
            }
            if (action === "add") {
                const pending = pendingAddQueries.get(userId);
                if (pending === undefined) {
                    await ctx.reply({
                        embeds: [createEmbed("warn", __("commands.music.playlist.selectExpired"))],
                    });
                    return;
                }
                pendingAddQueries.delete(userId);
                await this.addSongTo(ctx, client, playlist, pending.query);
                return;
            }
            if (action === "play") {
                await this.playPlaylist(ctx, client, playlist);
            }
            return;
        }

        const sub =
            localCtx.options?.getSubcommand(false) ?? localCtx.args[0]?.toLowerCase() ?? "list";
        const argName = localCtx.options?.getString("name") ?? localCtx.args[1];

        switch (sub) {
            case "create":
                await this.create(ctx, client, userId, argName);
                return;
            case "delete":
                await this.delete(ctx, client, userId, argName);
                return;
            case "rename": {
                const from = localCtx.options?.getString("from") ?? localCtx.args[1];
                const to = localCtx.options?.getString("to") ?? localCtx.args[2];
                await this.rename(ctx, client, userId, from, to);
                return;
            }
            case "list":
                await this.list(ctx, client, userId);
                return;
            case "info":
                await this.info(ctx, client, userId, argName);
                return;
            case "add": {
                const name = localCtx.options?.getString("name") ?? localCtx.args[1];
                const query =
                    localCtx.options?.getString("query") ?? localCtx.args.slice(2).join(" ");
                await this.add(ctx, client, userId, name, query);
                return;
            }
            case "remove": {
                const name = localCtx.options?.getString("name") ?? localCtx.args[1];
                const position =
                    localCtx.options?.getInteger("position") ?? Number(localCtx.args[2]);
                await this.remove(ctx, client, userId, name, position);
                return;
            }
            case "play": {
                const name = localCtx.options?.getString("name") ?? localCtx.args[1];
                await this.play(ctx, client, userId, name);
                return;
            }
            case "save": {
                const name = localCtx.options?.getString("name") ?? localCtx.args[1];
                await this.save(ctx, client, userId, name);
                return;
            }
            case "import": {
                const name = localCtx.options?.getString("name") ?? localCtx.args[1];
                const url = localCtx.options?.getString("url") ?? localCtx.args[2];
                await this.import(ctx, client, userId, name, url);
                return;
            }
            default:
                await ctx.reply({
                    embeds: [
                        createEmbed(
                            "warn",
                            __mf("commands.music.playlist.invalidSubcommand", {
                                usage: __("commands.music.playlist.usage"),
                            }),
                        ),
                    ],
                });
        }
    }
}

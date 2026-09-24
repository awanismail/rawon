import { setTimeout } from "node:timers";
import { type Guild, MessageFlags } from "discord.js";
import { createEmbed, safeThumbUrl } from "../../functions/createEmbed.js";
import {
    formatBoldPrefixedCommand,
    formatPrefixedCommand,
} from "../../functions/formatCodeSpan.js";
import { formatBoldMarkdownLink } from "../../functions/formatMarkdown.js";
import { getEffectivePrefix } from "../../functions/getEffectivePrefix.js";
import { i18n__, i18n__mf } from "../../functions/i18n.js";
import {
    AgeRestrictedError,
    AllCookiesFailedError,
    ExpiredDirectMediaError,
    shouldRequeueOnError,
} from "../YTDLUtil.js";
import { hydrateYouTubeSongMetadata } from "./hydrateSongMetadata.js";

export async function play(
    guild: Guild,
    nextSong?: string,
    wasIdle?: boolean,
    seekSeconds = 0,
): Promise<void> {
    const queue = guild.queue;
    if (!queue) {
        return;
    }

    const __ = i18n__(queue.client, guild);
    const __mf = i18n__mf(queue.client, guild);

    queue.seekOffset = seekSeconds;

    const song =
        (nextSong?.length ?? 0) > 0 ? queue.songs.get(nextSong as string) : queue.songs.first();

    if (!song) {
        queue.lastMusicMsg = null;
        queue.lastVSUpdateMsg = null;

        const isRequestChannel = queue.client.requestChannelManager.isRequestChannel(
            guild,
            queue.textChannel.id,
        );
        if (!isRequestChannel) {
            void queue.textChannel.send({
                flags: MessageFlags.SuppressNotifications,
                embeds: [
                    createEmbed(
                        "info",
                        `⏹️ **|** ${__mf("utils.generalHandler.queueEnded", {
                            usage: formatBoldPrefixedCommand(
                                getEffectivePrefix(queue.client, guild.id),
                                "play",
                            ),
                        })}`,
                    ),
                ],
            });
            queue.queueEndedNotified = true;
        }

        void queue.client.requestChannelManager.updatePlayerMessage(guild);

        if (queue.client.data.botSettings.alwaysOn) {
            queue.client.debugLog.logData(
                "info",
                "PLAY_HANDLER",
                `Queue ended for ${guild.name}(${guild.id}), alwaysOn enabled, staying in VC`,
            );
            return;
        }

        setTimeout(async () => {
            if (!guild.queue?.songs.first()) {
                await queue.destroy();
                if (!isRequestChannel) {
                    const msg = await queue.textChannel
                        .send({
                            flags: MessageFlags.SuppressNotifications,
                            embeds: [
                                createEmbed(
                                    "info",
                                    `👋 **|** ${__("utils.generalHandler.leftVC")}`,
                                ),
                            ],
                        })
                        .catch(() => null);
                    if (msg) {
                        setTimeout(() => {
                            void msg.delete().catch(() => null);
                        }, 3_500);
                    }
                }
            }
        }, 60_000);
        queue.client.debugLog.logData(
            "info",
            "PLAY_HANDLER",
            `Queue ended for ${guild.name}(${guild.id})`,
        );
        return;
    }

    const hydratedSong = await hydrateYouTubeSongMetadata(queue.client, song.song);
    if (hydratedSong !== song.song) {
        song.song = hydratedSong;
        void queue.saveQueueState();
        queue.refreshPlayerUi();
    }

    try {
        await queue.engine.startPlayback({
            guild,
            track: song,
            seekSeconds,
            filters: queue.filters,
            wasIdle,
        });
    } catch (error) {
        try {
            queue.client.logger.debug("[PLAY_HANDLER][DIAGNOSTIC] resource metadata:", {
                url: song.song.url,
                title: song.song.title,
                isLive: song.song.isLive,
            });
        } catch {}
        queue.endSkip();
        const isRequestChannel = queue.client.requestChannelManager.isRequestChannel(
            guild,
            queue.textChannel.id,
        );

        if (error instanceof AllCookiesFailedError) {
            queue.client.logger.error(
                `[PLAY_HANDLER] ❌ Bot detection for guild ${guild.name}(${guild.id}), stopping queue`,
            );

            if (!isRequestChannel) {
                await queue.textChannel.send({
                    flags: MessageFlags.SuppressNotifications,
                    embeds: [
                        createEmbed(
                            "error",
                            __mf("utils.generalHandler.allCookiesFailed", {
                                logoutCmd: formatPrefixedCommand(
                                    getEffectivePrefix(queue.client, guild.id),
                                    "login logout",
                                ),
                                startCmd: formatPrefixedCommand(
                                    getEffectivePrefix(queue.client, guild.id),
                                    "login start",
                                ),
                            }),
                            true,
                        ),
                    ],
                });
            }

            await queue.destroy();
            return;
        }

        if (error instanceof ExpiredDirectMediaError) {
            queue.client.logger.warn(
                `[PLAY_HANDLER] ⚠️ Expired direct media for "${song.song.title}": ${error.message}`,
            );

            if (!isRequestChannel) {
                await queue.textChannel.send({
                    flags: MessageFlags.SuppressNotifications,
                    embeds: [
                        createEmbed(
                            "error",
                            `${__mf("utils.generalHandler.errorPlaying", {
                                message: `\`${error.message.slice(0, 200)}\``,
                            })}`,
                            true,
                        ),
                    ],
                });
            }

            queue.songs.delete(song.key);
            const nextS = queue.getNextSongKeyAfter(song) ?? "";

            if (nextS.length > 0) {
                void play(guild, nextS, wasIdle);
            } else {
                await queue.destroy();
            }
            return;
        }

        if (shouldRequeueOnError(error as Error)) {
            queue.client.logger.warn(
                `[PLAY_HANDLER] ⚠️ Error playing song "${song.song.title}", re-queuing for retry. Error: ${(error as Error).message}`,
            );

            const currentSongKey = song.key;
            queue.songs.delete(currentSongKey);

            const newKey = queue.songs.addSong(song.song, song.requester);

            if (!isRequestChannel) {
                const errorMsg = await queue.textChannel.send({
                    flags: MessageFlags.SuppressNotifications,
                    embeds: [
                        createEmbed(
                            "warn",
                            `🔄 **|** ${__mf("utils.generalHandler.songRequeued", {
                                song: formatBoldMarkdownLink(song.song.title, song.song.url),
                            })}`,
                        ).setThumbnail(safeThumbUrl(song.song.thumbnail)),
                    ],
                });
                setTimeout(() => {
                    errorMsg.delete().catch(() => null);
                }, 10_000);
            }

            const nextS = queue.loopMode === "SONG" ? newKey : queue.getNextSongKeyAfter(song);
            if (nextS && nextS.length > 0 && nextS !== newKey) {
                void play(guild, nextS, wasIdle);
            } else {
                void play(guild, newKey, wasIdle);
            }
            return;
        }

        if (error instanceof AgeRestrictedError) {
            queue.client.logger.warn(
                `[PLAY_HANDLER] ⚠️ Age restricted content detected for "${song.song.title}": ${(error as Error).message}`,
            );

            if (!isRequestChannel) {
                await queue.textChannel.send({
                    flags: MessageFlags.SuppressNotifications,
                    embeds: [
                        createEmbed(
                            "error",
                            `${__mf("utils.generalHandler.ageRestricted", {
                                song: formatBoldMarkdownLink(song.song.title, song.song.url),
                            })}`,
                            true,
                        ),
                    ],
                });
            }
            queue.songs.delete(song.key);
            const nextS = queue.getNextSongKeyAfter(song) ?? "";

            if (nextS.length > 0) {
                void play(guild, nextS, wasIdle);
            } else {
                await queue.destroy();
            }
            return;
        }

        queue.client.logger.error(
            `[PLAY_HANDLER] ❌ Unrecoverable error playing song "${song.song.title}": ${(error as Error).message}`,
        );

        if (!isRequestChannel) {
            await queue.textChannel.send({
                flags: MessageFlags.SuppressNotifications,
                embeds: [
                    createEmbed(
                        "error",
                        `${__mf("utils.generalHandler.errorPlaying", {
                            message: `\`${(error as Error).message.slice(0, 200)}\``,
                        })}`,
                        true,
                    ),
                ],
            });
        }

        queue.songs.delete(song.key);
        const nextS = queue.getNextSongKeyAfter(song) ?? "";

        if (nextS.length > 0) {
            void play(guild, nextS, wasIdle);
        } else {
            await queue.destroy();
        }
        return;
    }
}

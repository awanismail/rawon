import { type Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import fs, { promises as fsp } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
    type AudioPlayer,
    AudioPlayerError,
    type AudioPlayerPlayingState,
    AudioPlayerStatus,
    type AudioResource,
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel,
    StreamType,
    type VoiceConnection,
    VoiceConnectionStatus,
} from "@discordjs/voice";
import { ChannelType, type Guild, type Snowflake } from "discord.js";
import prism from "prism-media";
import { type Rawon } from "../../../structures/Rawon.js";
import { type QueueSong, type Song } from "../../../typings/index.js";
import { createVoiceAdapter } from "../../functions/createVoiceAdapter.js";
import { ffmpegArgs } from "../../functions/ffmpegArgs.js";
import { resolveAutoplayCandidate } from "../../handlers/general/autoplaySong.js";
import { searchTrack } from "../../handlers/general/searchTrack.js";
import { getStream } from "../../handlers/YTDLUtil.js";
import { type FfmpegStreamWithEvents, isErrnoException } from "../../typeGuards.js";
import {
    type EngineMode,
    type FilterState,
    type PlaybackEngine,
    type PlaybackStatus,
    type StartPlaybackOptions,
} from "../types.js";

function getPlayableSongUrl(song: { url: string; playableUrl?: string }): string {
    return song.playableUrl?.trim() || song.url;
}

function isPrematureCloseError(error: unknown): boolean {
    return (
        String(error ?? "").includes("Premature close") ||
        (isErrnoException(error) && error.code === "ERR_STREAM_PREMATURE_CLOSE")
    );
}

/**
 * Engine bawaan rawon: yt-dlp → FFmpeg → Opus → @discordjs/voice.
 * Seluruh pipeline ini dipindah dari src/utils/handlers/general/play.ts
 * tanpa perubahan logika — hanya alih referensi dari `queue.*` ke engine.
 */
export class NativeEngine extends EventEmitter implements PlaybackEngine {
    public readonly mode: EngineMode = "rawon";
    private readonly player: AudioPlayer = createAudioPlayer();
    private connection: VoiceConnection | null = null;
    private _volume = 100;

    public constructor(private readonly client: Rawon) {
        super();
        this.wirePlayerEvents();
    }

    private wirePlayerEvents(): void {
        this.player
            .on("stateChange", (oldState, newState) => {
                if (
                    newState.status === AudioPlayerStatus.Playing &&
                    oldState.status !== AudioPlayerStatus.Paused
                ) {
                    newState.resource.volume?.setVolumeLogarithmic(this._volume / 100);
                    this.emit("trackStart", {
                        track: newState.resource.metadata as QueueSong,
                    });
                } else if (newState.status === AudioPlayerStatus.Idle) {
                    const endedResource = (oldState as AudioPlayerPlayingState).resource as
                        | AudioResource
                        | undefined;
                    this.emit("trackEnd", {
                        track: (oldState as AudioPlayerPlayingState).resource.metadata as QueueSong,
                        playbackDurationMs: endedResource?.playbackDuration ?? null,
                    });
                }
            })
            .on("error", (error) => {
                this.emit("playbackError", error);
            })
            .on("debug", (message) => {
                this.emit("debug", message);
            });
    }

    public connect(guild: Guild, voiceChannelId: Snowflake, _textChannelId?: Snowflake): void {
        const adapterCreator = createVoiceAdapter(this.client, guild.id);

        this.client.logger.debug(
            `[MultiBot] ${this.client.user?.tag} creating voice connection using custom adapter for channel ${voiceChannelId}`,
        );

        const connection = joinVoiceChannel({
            adapterCreator,
            channelId: voiceChannelId,
            guildId: guild.id,
            selfDeaf: true,
            group: this.client.user?.id ?? "default",
        }).on("debug", (message) => {
            this.client.logger.debug(message);
        });

        this.connection = connection;
    }

    public disconnectVoice(): void {
        try {
            this.connection?.disconnect();
        } catch {}
    }

    public async recoverConnection(): Promise<boolean> {
        const connection = this.connection;
        if (!connection) {
            return false;
        }
        try {
            connection.configureNetworking();
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
            return true;
        } catch {
            return false;
        }
    }

    public pause(): void {
        this.player.pause();
    }

    public resume(): void {
        this.player.unpause();
    }

    public stopCurrent(): void {
        this.player.stop(true);
    }

    public setVolume(volume: number): void {
        this._volume = volume;
        const resource = (
            this.player.state as AudioPlayerPlayingState & { resource: AudioResource | undefined }
        ).resource;
        resource?.volume?.setVolumeLogarithmic(this._volume / 100);
    }

    public getStatus(): PlaybackStatus {
        const status = this.player.state.status;
        switch (status) {
            case AudioPlayerStatus.Playing:
                return "playing";
            case AudioPlayerStatus.Paused:
                return "paused";
            case AudioPlayerStatus.AutoPaused:
                return "autoPaused";
            case AudioPlayerStatus.Buffering:
                return "buffering";
            default:
                return "idle";
        }
    }

    public getElapsedSeconds(): number {
        const state = this.player.state;
        if (
            state.status === AudioPlayerStatus.Playing ||
            state.status === AudioPlayerStatus.Paused ||
            state.status === AudioPlayerStatus.Buffering ||
            state.status === AudioPlayerStatus.AutoPaused
        ) {
            return Math.floor((state.resource.playbackDuration ?? 0) / 1000);
        }
        return 0;
    }

    public getCurrentTrack(): QueueSong | null {
        const state = this.player.state;
        if (
            state.status === AudioPlayerStatus.Playing ||
            state.status === AudioPlayerStatus.Paused ||
            state.status === AudioPlayerStatus.Buffering
        ) {
            return state.resource.metadata as QueueSong;
        }
        return null;
    }

    public get voiceChannelId(): Snowflake | undefined {
        return this.connection?.joinConfig.channelId ?? undefined;
    }

    public getVoiceWsLatencyMs(): number | undefined {
        return this.connection?.ping.ws;
    }

    public async startPlayback({
        guild,
        track,
        seekSeconds,
        filters,
        wasIdle,
    }: StartPlaybackOptions): Promise<void> {
        const song = track;
        const nativeFilters = filters as Parameters<typeof ffmpegArgs>[0];

        let ffmpegStream: prism.FFmpeg;
        let ffmpegStderr = "";

        const streamResult = await getStream(
            this.client,
            getPlayableSongUrl(song.song),
            song.song.isLive,
            seekSeconds,
        );

        this.client.logger.debug(
            `[PLAY_HANDLER] streamResult for ${song.song.title}: cachePath=${Boolean(
                streamResult.cachePath,
            )}, hasStream=${Boolean(streamResult.stream)}`,
        );

        if (streamResult.cachePath) {
            const args = ffmpegArgs(nativeFilters, seekSeconds, streamResult.cachePath);
            this.client.logger.debug("[PLAY_HANDLER][FFMPEG_ARGS]", args.join(" "));
            ffmpegStream = new prism.FFmpeg({
                args,
            });
            (ffmpegStream as FfmpegStreamWithEvents).stderr?.on?.("data", (chunk: Buffer) => {
                const s = chunk.toString();
                ffmpegStderr += s;
                this.client.logger.debug("[PLAY_HANDLER][FFMPEG_STERR]", s);
            });
            (ffmpegStream as FfmpegStreamWithEvents).on?.("error", (e: unknown) =>
                isPrematureCloseError(e)
                    ? this.client.logger.debug("[PLAY_HANDLER][FFMPEG_PREMATURE_CLOSE]", e)
                    : this.client.logger.error("[PLAY_HANDLER][FFMPEG_ERROR]", e),
            );
            (ffmpegStream as FfmpegStreamWithEvents).on?.("close", (code?: unknown) =>
                this.client.logger.debug("[PLAY_HANDLER][FFMPEG_CLOSE]", code),
            );
        } else if (streamResult.stream) {
            if (seekSeconds === 0) {
                const args = ffmpegArgs(nativeFilters, 0);
                this.client.logger.debug("[PLAY_HANDLER][FFMPEG_ARGS_STREAM]", args.join(" "));
                ffmpegStream = new prism.FFmpeg({ args });

                (ffmpegStream as FfmpegStreamWithEvents).stderr?.on?.("data", (chunk: Buffer) => {
                    const s = chunk.toString();
                    ffmpegStderr += s;
                    this.client.logger.debug("[PLAY_HANDLER][FFMPEG_STERR]", s);
                });

                (ffmpegStream as FfmpegStreamWithEvents).on?.("error", (e: unknown) => {
                    if (isPrematureCloseError(e)) {
                        this.client.logger.debug("[PLAY_HANDLER][FFMPEG_PREMATURE_CLOSE]", e);
                        return;
                    }
                    this.client.logger.error("[PLAY_HANDLER][FFMPEG_ERROR]", e);
                    this.emitPlaybackError(e as Error);
                });

                try {
                    streamResult.stream.pipe(ffmpegStream);
                } catch (e) {
                    this.client.logger.error(
                        "[PLAY_HANDLER] Failed to pipe stream into ffmpeg:",
                        e,
                    );
                    throw e;
                }
            } else {
                const tmpFile = nodePath.join(
                    os.tmpdir(),
                    `rawon-direct-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
                );

                this.client.logger.debug(
                    "[PLAY_HANDLER] Writing incoming stream to temp file",
                    tmpFile,
                );

                const writeStream = fs.createWriteStream(tmpFile);
                const DOWNLOAD_TIMEOUT_MS = 60_000;
                let downloadTimeout: NodeJS.Timeout | null = null;

                const streamPromise = new Promise<void>((resolve, reject) => {
                    const onError = (e: unknown) => {
                        if (downloadTimeout) {
                            clearTimeout(downloadTimeout);
                            downloadTimeout = null;
                        }
                        try {
                            writeStream.destroy();
                        } catch {}
                        reject(e);
                    };

                    downloadTimeout = setTimeout(() => {
                        onError(new Error("Temp download timeout"));
                    }, DOWNLOAD_TIMEOUT_MS);

                    streamResult.stream?.on?.("error", onError);
                    writeStream.on("error", onError);
                    writeStream.on("finish", () => {
                        if (downloadTimeout) {
                            clearTimeout(downloadTimeout);
                            downloadTimeout = null;
                        }
                        resolve();
                    });

                    streamResult.stream?.pipe(writeStream);
                });

                try {
                    await streamPromise;
                } catch (e) {
                    this.client.logger.error(
                        "[PLAY_HANDLER] Failed to write stream to temp file:",
                        e,
                    );
                    throw e;
                }

                const args = ffmpegArgs(nativeFilters, seekSeconds, tmpFile);
                this.client.logger.debug("[PLAY_HANDLER][FFMPEG_ARGS]", args.join(" "));
                ffmpegStream = new prism.FFmpeg({ args });

                (ffmpegStream as FfmpegStreamWithEvents).stderr?.on?.("data", (chunk: Buffer) => {
                    const s = chunk.toString();
                    ffmpegStderr += s;
                    this.client.logger.debug("[PLAY_HANDLER][FFMPEG_STERR]", s);
                });
                (ffmpegStream as FfmpegStreamWithEvents).on?.("error", (e: unknown) => {
                    if (isPrematureCloseError(e)) {
                        this.client.logger.debug("[PLAY_HANDLER][FFMPEG_PREMATURE_CLOSE]", e);
                        return;
                    }
                    this.client.logger.error("[PLAY_HANDLER][FFMPEG_ERROR]", e);
                    this.emitPlaybackError(e as Error);
                });
                (ffmpegStream as FfmpegStreamWithEvents).on?.("close", async (code?: unknown) => {
                    this.client.logger.debug("[PLAY_HANDLER][FFMPEG_CLOSE]", code);
                    try {
                        await fsp.unlink(tmpFile).catch(() => null);
                        this.client.logger.debug("[PLAY_HANDLER] Temp file deleted", tmpFile);
                    } catch {}
                });
            }
        } else {
            throw new Error("No stream or cache path available");
        }

        let resource: AudioResource<unknown> | undefined;
        try {
            this.client.logger.debug(
                "[PLAY_HANDLER] Creating audio resource with inputType=Arbitrary",
            );
            resource = createAudioResource(ffmpegStream, {
                inlineVolume: true,
                inputType: StreamType.Arbitrary,
                metadata: song,
            });

            if (!resource) {
                this.client.logger.error("[PLAY_HANDLER] Resource creation returned undefined");
                return;
            }

            resource.volume?.setVolumeLogarithmic(this._volume / 100);

            resource.playStream.on("error", (e: unknown) => {
                if (isPrematureCloseError(e)) {
                    this.client.logger.debug(
                        "[PLAY_HANDLER] Ignoring premature-close resource stream error",
                    );
                    return;
                }
                this.client.logger.error("[PLAY_HANDLER][RESOURCE_STREAM_ERROR]", e);
            });
        } catch (err) {
            this.client.logger.error(
                "[PLAY_HANDLER][RESOURCE_CREATE_ERROR]",
                err instanceof Error ? (err.stack ?? err.message) : err,
            );
            this.client.logger.debug(
                "[PLAY_HANDLER][RESOURCE_DIAGNOSTIC] ffmpegStderr:",
                ffmpegStderr.slice(0, 10_000),
            );
            this.client.logger.debug("[PLAY_HANDLER][RESOURCE_DIAGNOSTIC] song metadata:", {
                title: song.song.title,
                url: song.song.url,
                isLive: song.song.isLive,
            });
            this.emitPlaybackError(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        this.client.debugLog.logData(
            "info",
            "PLAY_HANDLER",
            `Created audio resource for ${guild.name}(${guild.id})`,
        );
        try {
            this.client.logger.debug("[PLAY_HANDLER][RESOURCE_CREATED]", {
                title: song.song.title,
                url: song.song.url,
                isLive: song.song.isLive,
                metadata: resource?.metadata ?? null,
            });
        } catch {}

        this.connection?.subscribe(this.player);

        const playResource = async (): Promise<void> => {
            if (
                guild.channels.cache.get(this.connection?.joinConfig.channelId ?? "")?.type ===
                ChannelType.GuildStageVoice
            ) {
                this.client.debugLog.logData(
                    "info",
                    "PLAY_HANDLER",
                    `Trying to be a speaker in ${guild.members.me?.voice.channel?.name ?? "Unknown"}(${
                        guild.members.me?.voice.channel?.id ?? "ID UNKNOWN"
                    }) in guild ${guild.name}(${guild.id})`,
                );
                const suppressed = await guild.members.me?.voice
                    .setSuppressed(false)
                    .catch((error: unknown) => ({ error }));
                if (suppressed && "error" in suppressed) {
                    this.client.debugLog.logData(
                        "error",
                        "PLAY_HANDLER",
                        `Failed to be a speaker in ${guild.members.me?.voice.channel?.name ?? "Unknown"}(${
                            guild.members.me?.voice.channel?.id ?? "ID UNKNOWN"
                        }) in guild ${guild.name}(${guild.id}). Reason: ${(suppressed.error as Error).message}`,
                    );
                    this.emitPlaybackError(suppressed.error as Error, resource);
                    return;
                }
            }

            this.player.play(resource!);
        };

        if (wasIdle === true) {
            void playResource();
        } else {
            this.client.debugLog.logData(
                "info",
                "PLAY_HANDLER",
                `Trying to enter Ready state in guild ${guild.name}(${guild.id}) voice connection`,
            );
            await entersState(this.connection!, VoiceConnectionStatus.Ready, 15_000)
                .then(async () => {
                    await playResource();
                    return 0;
                })
                .catch((error: unknown) => {
                    if ((error as Error).message === "The operation was aborted.") {
                        (error as Error).message =
                            "Cannot establish a voice connection within 15 seconds.";
                    }
                    this.client.debugLog.logData(
                        "error",
                        "PLAY_HANDLER",
                        `Failed to enter Ready state in guild ${guild.name}(${guild.id}) voice connection. Reason: ${(error as Error).message}`,
                    );
                    this.emitPlaybackError(error as Error, resource);
                });
        }
    }

    public applyFiltersLive(_filters: FilterState): boolean {
        // Engine native memakai argumen FFmpeg per-stream; filter selalu butuh restart.
        return false;
    }

    public destroy(): void {
        // AudioPlayer dimiliki engine ini sendiri dan ter-GC bersama queue;
        // tidak ada listener pada objek bersama yang perlu dilepas.
    }

    public async resolveRelatedSong(song: Song, rejected: Song[]): Promise<Song | undefined> {
        return resolveAutoplayCandidate(this.client, song, rejected);
    }

    public async resolveSuggestions(song: Song): Promise<Song[]> {
        const query = `${song.title}${song.author ? ` ${song.author}` : ""}`;
        const result = await searchTrack(this.client, query).catch(() => null);
        if (!result) {
            return [];
        }
        return result.items.filter((item) => item.url !== song.url).slice(0, 10);
    }

    private emitPlaybackError(error: Error, resource?: AudioResource<unknown>): void {
        try {
            this.emit(
                "playbackError",
                new AudioPlayerError(error, (resource ?? undefined) as never),
            );
        } catch {}
    }
}

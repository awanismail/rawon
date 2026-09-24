import { type EventEmitter } from "node:events";
import { type Guild, type Snowflake } from "discord.js";
import { type QueueSong, type Song } from "../../typings/index.js";

/**
 * Mode playback nada-bot (lihat docs/DESIGN-MERGE.md §2 K2):
 * - `rawon`: engine bawaan (yt-dlp + FFmpeg + @discordjs/voice)
 * - `musicify`: engine Lavalink v4
 */
export type EngineMode = "rawon" | "musicify";

export type PlaybackStatus = "idle" | "buffering" | "paused" | "autoPaused" | "playing";

export type FilterState = Partial<Record<string, boolean>>;

export interface StartPlaybackOptions {
    guild: Guild;
    track: QueueSong;
    seekSeconds: number;
    filters: FilterState;
    wasIdle?: boolean;
}

export interface EngineTrackStartPayload {
    track: QueueSong;
}

export interface EngineTrackEndPayload {
    track: QueueSong;
    playbackDurationMs: number | null;
}

/**
 * Antarmuka playback yang agnostik terhadap implementasi voice.
 * Tidak boleh membocorkan tipe `@discordjs/voice` (atau klien Lavalink)
 * agar engine mana pun dapat mengimplementasikannya.
 */
export interface PlaybackEngine extends EventEmitter {
    readonly mode: EngineMode;
    connect(guild: Guild, voiceChannelId: Snowflake, textChannelId?: Snowflake): void;
    disconnectVoice(): void;
    recoverConnection(): Promise<boolean>;
    startPlayback(options: StartPlaybackOptions): Promise<void>;
    pause(): void;
    resume(): void;
    stopCurrent(): void;
    setVolume(volume: number): void;
    getStatus(): PlaybackStatus;
    getElapsedSeconds(): number;
    getCurrentTrack(): QueueSong | null;
    getVoiceWsLatencyMs(): number | undefined;
    readonly voiceChannelId: Snowflake | undefined;
    /**
     * Terapkan filter secara langsung tanpa restart lagu.
     * Return true bila diterapkan live; false → pemanggil jatuh ke jalur restart.
     */
    applyFiltersLive(filters: FilterState): boolean;
    /** Cari lagu terkait untuk autoplay (implementasi per engine). */
    resolveRelatedSong(song: Song, rejected: Song[]): Promise<Song | undefined>;
    /** Daftar lagu saran untuk dropdown ChatPlay (maks. 10). */
    resolveSuggestions(song: Song): Promise<Song[]>;
    /** Bersihkan sumber daya engine (listener pada objek bersama, player). */
    destroy(): void;
}

import { EventEmitter } from "node:events";
import { Events, type Guild, type Snowflake } from "discord.js";
import { type Filters, type Player, Riffy, type Track } from "riffy";
import { type Rawon } from "../../../structures/Rawon.js";
import { type QueueSong, type Song } from "../../../typings/index.js";
import {
    type EngineMode,
    type FilterState,
    type PlaybackEngine,
    type PlaybackStatus,
    type StartPlaybackOptions,
} from "../types.js";

type RawVoicePacket = {
    t?: string;
    d?: { guild_id?: string; endpoint?: string | null };
};

function isTransientVoiceStateError(err: unknown): boolean {
    const message = (err as Error | undefined)?.message ?? String(err);
    return (
        message.includes("Missing 'endpoint' property") ||
        message.includes("establishing") ||
        message.includes("connection is not initiated") ||
        message.includes("Connection timed out") ||
        message.includes("Voice connection not ready")
    );
}

/**
 * Kebijakan YouTube mode `musicify` (DESIGN-MERGE.md K3): link youtube.com
 * dinormalisasi ke YouTube Music di pintu masuk playback. Penolakan keras
 * untuk link buatan pengguna diterapkan di lapisan searchTrack.
 */
export function normalizeYouTubeMusicUrl(url: string): string {
    if (!isYouTubeVideoUrl(url)) {
        return url;
    }
    let videoId = "";
    const watchMatch = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?([^#]+)/i.exec(url);
    const shortMatch = /^https?:\/\/youtu\.be\/([\w-]+)/i.exec(url);
    if (watchMatch) {
        videoId = new URLSearchParams(watchMatch[1]).get("v") ?? "";
    } else if (shortMatch) {
        videoId = shortMatch[1];
    }
    if (!videoId) {
        return url;
    }
    return `https://music.youtube.com/watch?v=${videoId}`;
}

export function isYouTubeVideoUrl(url: string): boolean {
    if (/^https?:\/\/(?:www\.|m\.)?music\.youtube\.com/i.test(url)) {
        return false;
    }
    return (
        /^https?:\/\/(?:www\.|m\.)?youtube\.com\//i.test(url) ||
        /^https?:\/\/youtu\.be\//i.test(url)
    );
}

type FilterApplier = (filters: Filters, on: boolean) => void;

/**
 * Mapping preset filter rawon → filter native Lavalink v4.
 * Preset di luar daftar ini (echo, reverb, surround, dsb.) tidak tersedia
 * di mode musicify — dilewati dengan peringatan log (degrade jujur).
 * Catatan: nightcore/spedup/slowed/vaporwave berbagi timescale —
 * hanya satu yang berlaku (model filter Lavalink bernilai tunggal).
 */
const LL_FILTER_APPLIERS: Record<string, FilterApplier> = {
    bassboost: (f, on) => f.setBassboost(on, { value: 4 }),
    nightcore: (f, on) => f.setTimescale(on, { speed: 1.2, pitch: 1.2, rate: 1 }),
    vaporwave: (f, on) => f.setVaporwave(on, { pitch: 0.5 }),
    spedup: (f, on) => f.setTimescale(on, { speed: 1.3, pitch: 1, rate: 1 }),
    slowed: (f, on) => f.setTimescale(on, { speed: 0.85, pitch: 1, rate: 1 }),
    "8d": (f, on) => f.set8D(on, { rotationHz: 0.2 }),
    tremolo: (f, on) => f.setTremolo(on, { frequency: 4, depth: 0.75 }),
    vibrato: (f, on) => f.setVibrato(on, { frequency: 4, depth: 0.75 }),
    karaoke: (f, on) =>
        f.setKaraoke(on, { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 }),
    lowpass: (f, on) => f.setLowPass(on, { smoothing: 20 }),
    slowmode: (f, on) => f.setSlowmode(on, { rate: 0.8 }),
    distortion: (f, on) =>
        f.setDistortion(on, {
            sinOffset: 0,
            sinScale: 1,
            cosOffset: 0,
            cosScale: 1,
            tanOffset: 0,
            tanScale: 1,
            offset: 0,
            scale: 1,
        }),
};

/** Preset filter yang tersedia di mode musicify (dipakai untuk degrade jujur di UI). */
export const LL_SUPPORTED_FILTERS: ReadonlySet<string> = new Set(Object.keys(LL_FILTER_APPLIERS));

/**
 * Inisialisasi klien riffy pada sebuah client bot (dipakai mode musicify).
 * Pola identik dengan musicify: callback `send` per shard, forwarding paket
 * voice mentah, dan pencatatan event node.
 */
export function initRiffy(client: Rawon): Riffy {
    const riffy = new Riffy(client, client.config.lavalinkNodes, {
        send: (payload: { d: { guild_id: string } }) => {
            const guild = client.guilds.cache.get(payload.d.guild_id);
            if (guild) {
                guild.shard.send(payload);
            }
        },
        defaultSearchPlatform: client.config.lavalinkDefaultSearchPlatform,
        restVersion: client.config.lavalinkRestVersion,
        bypassChecks: {
            nodeFetchInfo: true,
        },
    });

    riffy.on("nodeConnect", (node) => {
        client.logger.info(`[Lavalink] Node "${node.name}" connected`);
    });
    riffy.on("nodeDisconnect", (node) => {
        client.logger.warn(`[Lavalink] Node "${node.name}" disconnected`);
    });
    riffy.on("nodeError", (node, error: unknown) => {
        client.logger.error(`[Lavalink] Node "${node.name}" error:`, error);
    });
    riffy.on("nodeReconnect", (node) => {
        client.logger.info(`[Lavalink] Node "${node.name}" reconnecting`);
    });
    // "playerError" dipancarkan riffy saat runtime tetapi tidak dideklarasikan
    // di RiffyEvents — pasang lewat EventEmitter agar tetap terketik sebagian.
    (riffy as EventEmitter).on("playerError", (player: Player, error: unknown) => {
        client.logger.error(`[Lavalink] Player error in ${player.guildId}:`, error);
    });

    client.on(Events.Raw, (packet: unknown) => {
        const raw = packet as RawVoicePacket;
        if (raw?.t !== "VOICE_STATE_UPDATE" && raw?.t !== "VOICE_SERVER_UPDATE") {
            return;
        }
        // Discord dapat mengirim endpoint null saat perpindahan region — lewati.
        if (raw.t === "VOICE_SERVER_UPDATE" && !raw.d?.endpoint) {
            return;
        }
        void Promise.resolve(riffy.updateVoiceState(raw as never)).catch((err: unknown) => {
            if (isTransientVoiceStateError(err)) {
                return;
            }
            client.logger.warn(
                `[Lavalink] Voice state update failed for guild ${raw.d?.guild_id ?? "unknown"}:`,
                (err as Error | undefined)?.message ?? err,
            );
        });
    });

    return riffy;
}

/**
 * Engine Lavalink v4 (mode `musicify`) di atas riffy.
 * Satu instance per guild (per ServerQueue); semua player diambil dari
 * instance riffy milik client yang dibagikan.
 */
export class LavalinkEngine extends EventEmitter implements PlaybackEngine {
    public readonly mode: EngineMode = "musicify";
    private readonly riffy: Riffy;
    private readonly guildId: string;
    private _volume = 100;
    private _seekBaseSeconds = 0;
    private currentQueueSong: QueueSong | null = null;

    private readonly onRiffyTrackStart = (player: Player): void => {
        if (player.guildId !== this.guildId) {
            return;
        }
        const queueSong = player.get("queueSong") as QueueSong | undefined;
        if (!queueSong) {
            return;
        }
        this.currentQueueSong = queueSong;
        this.emit("trackStart", { track: queueSong });
    };

    private readonly onRiffyTrackEnd = (player: Player): void => {
        if (player.guildId !== this.guildId) {
            return;
        }
        const ended = this.currentQueueSong;
        this.currentQueueSong = null;
        if (!ended) {
            return;
        }
        this.emit("trackEnd", {
            track: ended,
            playbackDurationMs: Number.isFinite(player.position) ? player.position : null,
        });
    };

    private readonly onRiffyTrackError = (player: Player): void => {
        if (player.guildId !== this.guildId) {
            return;
        }
        this.emit(
            "playbackError",
            new Error(`Lavalink reported a track error in guild ${this.guildId}`),
        );
    };

    public constructor(
        private readonly client: Rawon,
        guild: Guild,
    ) {
        super();
        if (!client.riffy) {
            throw new Error(
                "LavalinkEngine requires the riffy client (ENGINE_MODE=musicify with configured nodes)",
            );
        }
        this.riffy = client.riffy;
        this.guildId = guild.id;

        this.riffy.on("trackStart", this.onRiffyTrackStart);
        this.riffy.on("trackEnd", this.onRiffyTrackEnd);
        this.riffy.on("trackError", this.onRiffyTrackError);
        this.riffy.on("trackStuck", this.onRiffyTrackError);
    }

    private getPlayer(): Player | undefined {
        try {
            return this.riffy.players.get(this.guildId);
        } catch {
            return undefined;
        }
    }

    private requirePlayer(): Player {
        const player = this.getPlayer();
        if (!player) {
            throw new Error("Lavalink player is not connected for this guild");
        }
        return player;
    }

    public connect(guild: Guild, voiceChannelId: Snowflake, textChannelId?: Snowflake): void {
        const existing = this.getPlayer();
        if (existing) {
            existing.setVoiceChannel(voiceChannelId, { deaf: true });
            return;
        }
        this.riffy.createConnection({
            guildId: guild.id,
            voiceChannel: voiceChannelId,
            textChannel: textChannelId ?? "",
            deaf: true,
            defaultVolume: this._volume,
        });
    }

    public disconnectVoice(): void {
        try {
            this.getPlayer()?.destroy();
        } catch {}
    }

    public destroy(): void {
        this.riffy.off("trackStart", this.onRiffyTrackStart);
        this.riffy.off("trackEnd", this.onRiffyTrackEnd);
        this.riffy.off("trackError", this.onRiffyTrackError);
        this.riffy.off("trackStuck", this.onRiffyTrackError);
        this.disconnectVoice();
    }

    public async recoverConnection(): Promise<boolean> {
        const player = this.getPlayer();
        if (!player) {
            return false;
        }
        if (player.connected) {
            return true;
        }
        try {
            player.connect();
            return true;
        } catch {
            return false;
        }
    }

    public pause(): void {
        try {
            this.getPlayer()?.pause(true);
        } catch {}
    }

    public resume(): void {
        try {
            this.getPlayer()?.pause(false);
        } catch {}
    }

    public stopCurrent(): void {
        try {
            this.getPlayer()?.stop();
        } catch {}
    }

    public setVolume(volume: number): void {
        this._volume = volume;
        try {
            this.getPlayer()?.setVolume(volume);
        } catch {}
    }

    public getStatus(): PlaybackStatus {
        const player = this.getPlayer();
        if (!player) {
            return "idle";
        }
        if (player.paused) {
            return "paused";
        }
        if (player.playing) {
            return "playing";
        }
        return "idle";
    }

    public getElapsedSeconds(): number {
        const player = this.getPlayer();
        if (!player || (!player.playing && !player.paused)) {
            return 0;
        }
        // player.position sudah absolut (termasuk posisi seek), sedangkan
        // ServerQueue menambahkan seekOffset — kompensasi dengan basis seek.
        return Math.max(0, Math.floor(player.position / 1000) - this._seekBaseSeconds);
    }

    public getCurrentTrack(): QueueSong | null {
        const player = this.getPlayer();
        if (!player) {
            return null;
        }
        if (player.playing || player.paused || player.current) {
            return this.currentQueueSong;
        }
        return null;
    }

    public get voiceChannelId(): Snowflake | undefined {
        const voiceChannel = this.getPlayer()?.voiceChannel;
        return voiceChannel && voiceChannel.length > 0 ? voiceChannel : undefined;
    }

    public getVoiceWsLatencyMs(): number | undefined {
        const player = this.getPlayer();
        return player && Number.isFinite(player.ping) ? player.ping : undefined;
    }

    private applyFilterSet(player: Player, filters: FilterState): void {
        for (const [name, applier] of Object.entries(LL_FILTER_APPLIERS)) {
            applier(player.filters, filters[name] === true);
        }
        for (const [name, on] of Object.entries(filters)) {
            if (on && !(name in LL_FILTER_APPLIERS)) {
                this.client.logger.warn(
                    `[Lavalink] Filter "${name}" is not available in musicify mode; skipped`,
                );
            }
        }
    }

    public applyFiltersLive(filters: FilterState): boolean {
        const player = this.getPlayer();
        if (!player) {
            return false;
        }
        this.applyFilterSet(player, filters);
        return true;
    }

    private trackToSong(track: Track): Song {
        return {
            thumbnail: track.info.thumbnail ?? "",
            title: track.info.title,
            author: track.info.author,
            url: normalizeYouTubeMusicUrl(track.info.uri ?? ""),
            duration: Math.floor((track.info.length ?? 0) / 1000),
            id: track.info.identifier ?? "",
            isLive: track.info.stream,
        } satisfies Song;
    }

    public async resolveRelatedSong(song: Song, rejected: Song[]): Promise<Song | undefined> {
        const query = `${song.title}${song.author ? ` ${song.author}` : ""}`;
        const resolved = await this.riffy.resolve({
            query,
            source: this.client.config.lavalinkDefaultSearchPlatform,
            requester: "autoplay",
        });
        const rejectedUrls = new Set(rejected.map((r) => r.url));
        const rejectedIds = new Set(rejected.map((r) => r.id).filter(Boolean));
        const candidate: Track | undefined = resolved.tracks.find((t) => {
            const uri = t.info?.uri ?? "";
            const identifier = t.info?.identifier ?? "";
            return !rejectedUrls.has(uri) && !(identifier && rejectedIds.has(identifier));
        });
        if (!candidate) {
            return undefined;
        }
        return this.trackToSong(candidate);
    }

    public async resolveSuggestions(song: Song): Promise<Song[]> {
        const query = `${song.title}${song.author ? ` ${song.author}` : ""}`;
        const resolved = await this.riffy
            .resolve({
                query,
                source: this.client.config.lavalinkDefaultSearchPlatform,
                requester: "suggestions",
            })
            .catch(() => null);
        if (!resolved?.tracks) {
            return [];
        }
        return resolved.tracks
            .filter((t) => (t.info?.uri ?? "") !== song.url)
            .slice(0, 10)
            .map((t) => this.trackToSong(t));
    }

    public async startPlayback({
        track,
        seekSeconds,
        filters,
    }: StartPlaybackOptions): Promise<void> {
        const playableUrl = track.song.playableUrl?.trim() || track.song.url;
        const query = normalizeYouTubeMusicUrl(playableUrl);

        const resolved = await this.riffy.resolve({
            query,
            requester: track.requester,
        });
        if (!resolved?.tracks || resolved.tracks.length === 0) {
            throw new Error(`No playable results for "${track.song.title}" on Lavalink`);
        }

        const player = this.requirePlayer();

        player.set("queueSong", track);
        this.currentQueueSong = track;
        this._seekBaseSeconds = seekSeconds;

        player.queue.add(resolved.tracks[0]);
        this.applyFilterSet(player, filters);
        player.setVolume(this._volume);
        await player.play();
        if (seekSeconds > 0) {
            player.seek(seekSeconds * 1000);
        }
    }
}

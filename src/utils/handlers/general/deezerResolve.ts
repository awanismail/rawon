import { type Rawon } from "../../../structures/Rawon.js";
import { type SearchTrackResult, type Song } from "../../../typings/index.js";
import { resolveSearchProvider } from "../../functions/searchProvider.js";
import { searchYouTubeMusic } from "./youtubeMusicSearch.js";
import { dumpYtDlpMetadata, mapDumpEntryToSong } from "./ytdlpMetadata.js";

const DEEZER_API = "https://api.deezer.com";
const MAX_PLAYLIST_TRACKS = 100;
const MATCH_CONCURRENCY = 4;

interface DeezerTrack {
    id?: number;
    title?: string;
    title_short?: string;
    duration?: number;
    link?: string;
    artist?: { name?: string };
    album?: { cover_medium?: string; cover_big?: string; cover_xl?: string };
}

interface DeezerCollection {
    tracks?: {
        data?: DeezerTrack[];
        next?: string | null;
    };
}

/** Error ketika short link Deezer tidak bisa dijabarkan ke URL penuh. */
export class DeezerResolveError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "DeezerResolveError";
    }
}

async function deezerGet<T>(client: Rawon, path: string): Promise<T> {
    const response = await client.request<T>(`${DEEZER_API}${path}`, {
        throwHttpErrors: true,
    });
    return response.body;
}

/** Jabarkan short link (link.deezer.com/s/…) ke URL Deezer penuh. */
export async function expandDeezerShortLink(client: Rawon, url: string): Promise<string> {
    if (!/link\.deezer\.com|dzr\.page\.link/u.test(url)) {
        return url;
    }
    try {
        const response = await client.request(url, { followRedirect: true, method: "HEAD" });
        const finalUrl = response.url ?? response.redirectUrls?.at(-1);
        if (finalUrl && /deezer\.com/u.test(finalUrl)) {
            return finalUrl;
        }
    } catch {}
    throw new DeezerResolveError("Unable to expand Deezer short link.");
}

function parseDeezerId(url: string, kind: "track" | "playlist" | "album"): string | null {
    const match = new RegExp(`/${kind}/(\\d+)`, "u").exec(url);
    return match ? match[1] : null;
}

function withDeezerDisplay(track: DeezerTrack, youtubeSong: Song): Song {
    return {
        ...youtubeSong,
        url: track.link ?? youtubeSong.url,
        playableUrl: youtubeSong.url,
        title: track.title ?? youtubeSong.title,
        author: track.artist?.name ?? youtubeSong.author,
        duration: track.duration ?? youtubeSong.duration,
        thumbnail:
            track.album?.cover_xl ??
            track.album?.cover_big ??
            track.album?.cover_medium ??
            youtubeSong.thumbnail,
    };
}

async function matchTrackOnYouTubeMusic(client: Rawon, track: DeezerTrack): Promise<Song | null> {
    const query = `${track.title ?? ""} ${track.artist?.name ?? ""}`.trim();
    if (query.length === 0) {
        return null;
    }

    if (resolveSearchProvider(client) === "dsp") {
        try {
            const items = await searchYouTubeMusic(query, 1);
            const youtubeSong = items[0];
            if (youtubeSong !== undefined) {
                return withDeezerDisplay(track, youtubeSong);
            }
        } catch {}
    }

    try {
        const dump = await dumpYtDlpMetadata(`ytsearch1:${query}`, {
            flatPlaylist: true,
            playlistEnd: 1,
        });
        const entry = dump.entries?.[0] ?? (dump._type === "playlist" ? null : dump);
        if (entry === null || entry === undefined) {
            return null;
        }
        const youtubeSong = mapDumpEntryToSong(entry);
        return youtubeSong === null ? null : withDeezerDisplay(track, youtubeSong);
    } catch {
        return null;
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++;
            results[index] = await mapper(items[index]);
        }
    });

    await Promise.all(workers);
    return results;
}

async function collectDeezerTracks(client: Rawon, firstPageUrl: string): Promise<DeezerTrack[]> {
    const tracks: DeezerTrack[] = [];
    let next: string | null | undefined = firstPageUrl;

    while (next && tracks.length < MAX_PLAYLIST_TRACKS) {
        const page: DeezerCollection = next.startsWith(DEEZER_API)
            ? await deezerGet(client, next.slice(DEEZER_API.length))
            : (await client.request<DeezerCollection>(next, { throwHttpErrors: true })).body;
        tracks.push(...(page.tracks?.data ?? []));
        next = page.tracks?.next ?? null;
    }

    return tracks.slice(0, MAX_PLAYLIST_TRACKS);
}

/**
 * Resolusi URL Deezer (track / playlist / album / short link) — engine-independent:
 * metadata dari API publik Deezer, playback dicocokkan ke YouTube Music
 * (pola yang sama dengan spotifyResolve), sehingga berfungsi di kedua mode.
 */
export async function resolveDeezerUrl(client: Rawon, url: string): Promise<SearchTrackResult> {
    const expanded = await expandDeezerShortLink(client, url);

    const trackId = parseDeezerId(expanded, "track");
    if (trackId) {
        const track = await deezerGet<DeezerTrack>(client, `/track/${trackId}`);
        const matched = await matchTrackOnYouTubeMusic(client, track);
        if (matched === null) {
            throw new DeezerResolveError(
                `No YouTube Music match for Deezer track "${track.title ?? trackId}".`,
            );
        }
        return { type: "selection", items: [matched] };
    }

    const playlistId = parseDeezerId(expanded, "playlist");
    const albumId = parseDeezerId(expanded, "album");
    if (playlistId || albumId) {
        const kind = playlistId ? "playlist" : "album";
        const id = playlistId ?? albumId;
        const tracks = await collectDeezerTracks(client, `/${kind}/${id}`);
        if (tracks.length === 0) {
            throw new DeezerResolveError(`No tracks found on Deezer ${kind} ${id}.`);
        }
        const resolved = await mapWithConcurrency(tracks, MATCH_CONCURRENCY, (track) =>
            matchTrackOnYouTubeMusic(client, track).catch(() => null),
        );
        const items = resolved.filter((song): song is Song => song !== null);
        return {
            type: "results",
            items,
            playlist: {
                title: `Deezer ${kind}`,
                url: expanded,
                thumbnail: tracks[0]?.album?.cover_big ?? tracks[0]?.album?.cover_medium,
            },
        };
    }

    throw new DeezerResolveError("Unsupported Deezer link.");
}

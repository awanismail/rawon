import { type Rawon } from "../../../structures/Rawon.js";
import { type SearchTrackResult } from "../../../typings/index.js";
import { isYouTubeVideoUrl, normalizeYouTubeMusicUrl } from "../../engines/lavalink/index.js";
import {
    normalizeSearchTrackThumbnails,
    withYouTubeVideoThumbnail,
} from "../../functions/getMaxResThumbnail.js";
import { limitedResolve, type ResolveLimitContext } from "../../functions/resolveLimiter.js";
import { resolveSearchProvider } from "../../functions/searchProvider.js";
import { checkQuery } from "./checkQuery.js";
import { resolveDeezerUrl } from "./deezerResolve.js";
import { resolveSpotifyUrl } from "./spotifyResolve.js";
import { applyYouTubeMusicThumbnails } from "./youtubeMusicThumbnail.js";
import { resolveExtractorUrl, resolveUnknownUrl, searchExtractorTracks } from "./ytdlpMetadata.js";

/** K3 (DESIGN-MERGE.md): youtube.com ditolak di mode `musicify`. */
export class YouTubeNotSupportedInModeError extends Error {
    public constructor() {
        super(
            "youtube.com links are not supported in musicify mode. Use YouTube Music (music.youtube.com) links instead.",
        );
        this.name = "YouTubeNotSupportedInModeError";
    }
}

/**
 * Sumber yang hanya bisa diputar plugin Lavalink (LavaSrc dsb.) —
 * tidak tersedia di mode `rawon` (DESIGN-MERGE.md §4.4).
 */
export class PluginSourceUnsupportedError extends Error {
    public constructor(public readonly platform: string) {
        super(
            `${platform} links are only supported in musicify mode (Lavalink). Switch the engine mode or use another source.`,
        );
        this.name = "PluginSourceUnsupportedError";
    }
}

function withNormalizedThumbnails(result: SearchTrackResult): SearchTrackResult {
    return normalizeSearchTrackThumbnails(result);
}

async function withAccurateThumbnails(result: SearchTrackResult): Promise<SearchTrackResult> {
    const items = await applyYouTubeMusicThumbnails(result.items);
    return withNormalizedThumbnails({
        ...result,
        items: items.map(withYouTubeVideoThumbnail),
    });
}

/**
 * Kebijakan YouTube mode `musicify` (DESIGN-MERGE.md K3): link youtube.com
 * buatan pengguna ditolak; hasil pencarian internal dinormalisasi ke YT Music.
 * Seluruh resolve dibatasi limiter berlapis (global/guild/user) bila konteks diberikan.
 */
export async function searchTrack(
    client: Rawon,
    query: string,
    source: "soundcloud" | "youtube" | undefined = "youtube",
    limitContext?: ResolveLimitContext,
): Promise<SearchTrackResult> {
    if (client.config.engineMode === "musicify" && isYouTubeVideoUrl(query.trim())) {
        throw new YouTubeNotSupportedInModeError();
    }

    const run = (): Promise<SearchTrackResult> => searchTrackInternal(client, query, source);
    const result = limitContext ? await limitedResolve(limitContext, run) : await run();

    if (client.config.engineMode === "musicify") {
        return {
            ...result,
            items: result.items.map((song) => ({
                ...song,
                url: normalizeYouTubeMusicUrl(song.url),
                playableUrl: song.playableUrl
                    ? normalizeYouTubeMusicUrl(song.playableUrl)
                    : song.playableUrl,
            })),
        };
    }

    return result;
}

async function searchTrackInternal(
    client: Rawon,
    query: string,
    source: "soundcloud" | "youtube" | undefined = "youtube",
): Promise<SearchTrackResult> {
    const provider = resolveSearchProvider(client);
    const queryData = checkQuery(query);
    if (!queryData.isURL) {
        return withAccurateThumbnails(
            await searchExtractorTracks(query, source ?? "youtube", 10, provider),
        );
    }

    const sourceType = queryData.sourceType ?? "unknown";

    switch (sourceType) {
        case "query":
            return withAccurateThumbnails(
                await searchExtractorTracks(query, source ?? "youtube", 10, provider),
            );
        case "youtube":
            return withAccurateThumbnails(await resolveExtractorUrl(query, queryData.type));
        case "soundcloud":
            return withNormalizedThumbnails(await resolveExtractorUrl(query, queryData.type));
        case "spotify":
            return withNormalizedThumbnails(await resolveSpotifyUrl(client, query));
        case "deezer":
            return withNormalizedThumbnails(await resolveDeezerUrl(client, query));
        case "applemusic":
        case "tidal":
        case "qobuz":
        case "jiosaavn": {
            // Sumber plugin-murni: hanya bisa diputar node Lavalink (mode musicify).
            if (client.config.engineMode !== "musicify") {
                throw new PluginSourceUnsupportedError(sourceType);
            }
            // Diteruskan apa adanya — plugin node (LavaSrc dsb.) yang memuat metadata & audionya.
            return {
                type: "results",
                items: [
                    {
                        thumbnail: "",
                        title: query,
                        url: query,
                        duration: 0,
                        id: query,
                    },
                ],
            };
        }
        case "unknown":
            return withNormalizedThumbnails(await resolveUnknownUrl(query));
        default: {
            const exhaustive: never = sourceType;
            throw new Error(`Unsupported query source: ${String(exhaustive)}`);
        }
    }
}

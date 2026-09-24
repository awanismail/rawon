import { AttachmentBuilder } from "discord.js";
import { Bloom, initializeFonts } from "musicard";
import { getMaxResThumbnail } from "./getMaxResThumbnail.js";

const MUSICARD_PROGRESS_COLOR = "#FACC15";
const MUSICARD_BACKGROUND_COLOR = "#2b2d31";
const FALLBACK_ARTWORK = "https://cdn.stegripe.org/images/icon.png";

let fontsInitialization: Promise<unknown> | null = null;

function formatTime(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface MusicCardInput {
    title: string;
    author: string;
    artwork: string | null;
    positionSeconds: number;
    durationSeconds: number;
}

/**
 * Render kartu "Bloom" musicify (paket `musicard`) sebagai lampiran PNG.
 * Return null saat render gagal — pemanggil jatuh ke tampilan lama.
 */
export async function renderMusicCard(input: MusicCardInput): Promise<AttachmentBuilder | null> {
    try {
        fontsInitialization ??= Promise.resolve(initializeFonts());
        await fontsInitialization;

        const progress =
            input.durationSeconds > 0
                ? Math.min(
                      100,
                      Math.max(
                          0,
                          Math.floor((input.positionSeconds / input.durationSeconds) * 100),
                      ),
                  )
                : 0;

        const buffer = await Bloom({
            trackName: (input.title || "Unknown").slice(0, 40),
            artistName: (input.author || "Unknown artist").slice(0, 30),
            albumArt: getMaxResThumbnail(input.artwork) ?? FALLBACK_ARTWORK,
            fallbackArt: FALLBACK_ARTWORK,
            timeAdjust: {
                timeStart: formatTime(input.positionSeconds),
                timeEnd: formatTime(input.durationSeconds),
            },
            progressBar: progress,
            styleConfig: {
                progressBarStyle: {
                    barColor: MUSICARD_PROGRESS_COLOR,
                },
            },
            backgroundColor: MUSICARD_BACKGROUND_COLOR,
        });

        return new AttachmentBuilder(buffer, { name: "musicard.png" });
    } catch {
        return null;
    }
}

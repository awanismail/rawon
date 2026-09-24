import { type Guild } from "discord.js";
import { type Rawon } from "../../structures/Rawon.js";
import { LavalinkEngine } from "./lavalink/index.js";
import { NativeEngine } from "./native/index.js";
import { type PlaybackEngine } from "./types.js";

/**
 * Pabrik engine sesuai mode global (DESIGN-MERGE.md K2):
 * ENGINE_MODE=musicify → LavalinkEngine (riffy/Lavalink v4)
 * ENGINE_MODE=rawon    → NativeEngine (yt-dlp + FFmpeg) [default]
 */
export function createEngine(client: Rawon, guild: Guild): PlaybackEngine {
    if (client.config.engineMode === "musicify") {
        return new LavalinkEngine(client, guild);
    }
    return new NativeEngine(client);
}

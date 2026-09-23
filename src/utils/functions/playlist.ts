import { type CommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Playlist, type SavedPlaylistSong, type Song } from "../../typings/index.js";
import { createEmbed } from "./createEmbed.js";
import { type i18n__mf } from "./i18n.js";

export const PLAYLIST_LIMITS = {
    maxPlaylists: 25,
    maxTracks: 200,
    maxNameLength: 50,
    favoritesName: "Favorites",
} as const;

export type PlaylistNameError = "empty" | "tooLong" | "reserved";

export function validatePlaylistName(name: string): PlaylistNameError | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return "empty";
    }
    if (trimmed.length > PLAYLIST_LIMITS.maxNameLength) {
        return "tooLong";
    }
    if (trimmed.toLowerCase() === PLAYLIST_LIMITS.favoritesName.toLowerCase()) {
        return "reserved";
    }
    return null;
}

export function toSavedPlaylistSong(song: Song): SavedPlaylistSong {
    return {
        id: song.id,
        title: song.title,
        url: song.url,
        author: song.author,
        duration: song.duration,
        thumbnail: song.thumbnail,
        isLive: song.isLive,
        addedAt: Date.now(),
    };
}

export function storedToSong(saved: SavedPlaylistSong): Song {
    return {
        id: saved.id,
        title: saved.title,
        url: saved.url,
        author: saved.author,
        duration: saved.duration,
        thumbnail: saved.thumbnail,
        isLive: saved.isLive,
    };
}

export function findSavedSongIndex(songs: SavedPlaylistSong[], url: string): number {
    return songs.findIndex((saved) => saved.url === url);
}

export async function ensureFavorites(client: Rawon, userId: string): Promise<Playlist> {
    const existing = client.data.getUserPlaylistByName(userId, PLAYLIST_LIMITS.favoritesName);
    if (existing !== null) {
        return existing;
    }
    return client.data.createUserPlaylist(userId, PLAYLIST_LIMITS.favoritesName, true);
}

export function ensureMusicChannel(
    ctx: CommandContext,
    client: Rawon,
    __mf: ReturnType<typeof i18n__mf>,
): boolean {
    if (!ctx.guild) {
        return true;
    }

    let requestChannel = client.requestChannelManager.getRequestChannel(ctx.guild);
    if (!requestChannel && client.config.isMultiBot) {
        const primaryBot = client.multiBotManager.getPrimaryBot();
        if (primaryBot && primaryBot !== client) {
            requestChannel = primaryBot.requestChannelManager.getRequestChannel(ctx.guild);
        }
    }

    if (!requestChannel || ctx.channel?.id === requestChannel.id) {
        return true;
    }

    void ctx.reply({
        embeds: [
            createEmbed(
                "warn",
                __mf("utils.musicDecorator.useRequestChannel", {
                    channel: `<#${requestChannel.id}>`,
                }),
            ),
        ],
    });
    return false;
}

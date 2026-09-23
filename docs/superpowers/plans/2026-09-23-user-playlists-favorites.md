# User Playlists, Favorites, Leaderboard & Default Prefix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user saved playlists, a favorites list, a per-guild play-count leaderboard with automatic titles, and change the default command prefix to `nada`.

**Architecture:** One new SQLite table per concern (`user_playlists` with a `songs_json` blob mirroring `queue_states`; `guild_user_stats` for play counts), new typed methods on `SQLiteDataManager`, two shared helper modules (`playlist.ts`, `userStats.ts`), four new Sapphire commands in `src/commands/music/`, and a one-line play-count hook inside `handleVideos` (the single choke point every user-initiated enqueue already flows through).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), @sapphire/framework + @stegripe/command-context, discord.js v14, better-sqlite3, Biome lint, SWC build.

**Spec:** `docs/superpowers/specs/2026-09-23-user-playlists-favorites-design.md`

## Global Constraints

- Work on branch `nada-bot` (already created). Commit after every task.
- The project has NO test framework. Verification per task = `pnpm lint` (Biome) then `pnpm build` (SWC). The final task runs the spec's manual smoke checklist.
- Every relative import ends with `.js` (ESM + SWC convention).
- 4-space indent, named exports, follow existing file style exactly.
- Every user-facing string goes through i18n keys (`i18n.__` / `i18n__` / `i18n__mf`). Placeholder syntax is single braces: `{name}`.
- i18n keys must exist in all 14 `lang/*.json` files: `en-US.json` authoritative, `id-ID.json` properly translated, the other 12 get en-US copies (script in Task 6).
- Limits (verbatim from spec): max 25 playlists per user (excluding Favorites), max 200 tracks per playlist, name 1–50 chars unique per user case-insensitive, name `Favorites` reserved, duplicate track URLs rejected everywhere with position report.
- Title tiers (verbatim from spec): 0 Pendengar Baru/New Listener, 25 Penikmat Musik/Music Enjoyer, 100 Audiofil/Audiophile, 500 Melomaniak/Melomaniac, 1000 Legenda Musik/Music Legend.
- Default prefix becomes `nada` (production fallback only; dev prefix `d!` unchanged; `MAIN_PREFIX` env and per-guild prefixes still override).
- Play counts: +1 per song enqueued into the live queue by a user command. Queue restore on startup must NOT increment (it never calls `handleVideos` — verified: only `PlayCommand.ts:89`, `PlayCommand.ts:182`, `MessageCreateListener.ts:500` call it, all user-initiated).

---

### Task 1: Default prefix `nada`

**Files:**
- Modify: `src/config/env.ts:71`
- Modify: `.env.example:20-23`

**Interfaces:**
- Consumes: nothing
- Produces: `mainPrefix` fallback `"nada"` (no signature change)

- [ ] **Step 1: Change the fallback**

In `src/config/env.ts` line 71, replace:

```ts
export const mainPrefix = isDev ? "d!" : (process.env.MAIN_PREFIX ?? "") || "!";
```

with:

```ts
export const mainPrefix = isDev ? "d!" : (process.env.MAIN_PREFIX ?? "") || "nada";
```

- [ ] **Step 2: Update `.env.example`**

Replace the block:

```
# Main command prefix
# Default: !
MAIN_PREFIX=""
```

with:

```
# Main command prefix
# Default: nada
MAIN_PREFIX=""
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/config/env.ts .env.example
git commit -m "feat: change default command prefix to nada"
```

---

### Task 2: Playlist types + SQLite storage

**Files:**
- Modify: `src/typings/index.d.ts` (after `SavedQueueSong` around line 172, and inside `ExtendedDataManager` around line 330)
- Modify: `src/utils/structures/SQLiteDataManager.ts` (imports, `initSchema`, new methods)

**Interfaces:**
- Consumes: `Song` type from typings
- Produces (used by Tasks 4, 7, 8):
  - `type SavedPlaylistSong = Song & { addedAt: number }`
  - `type Playlist = { playlistId: string; userId: string; name: string; isSpecial: boolean; createdAt: number; updatedAt: number; songs: SavedPlaylistSong[] }`
  - `type PlaylistMeta = { playlistId: string; name: string; isSpecial: boolean; createdAt: number; updatedAt: number; trackCount: number }`
  - `SQLiteDataManager.getUserPlaylistMetas(userId: string): PlaylistMeta[]`
  - `SQLiteDataManager.getUserPlaylistByName(userId: string, name: string): Playlist | null`
  - `SQLiteDataManager.getUserPlaylistById(userId: string, playlistId: string): Playlist | null`
  - `SQLiteDataManager.createUserPlaylist(userId: string, name: string, isSpecial?: boolean): Promise<Playlist>`
  - `SQLiteDataManager.saveUserPlaylist(playlist: Playlist): Promise<void>`
  - `SQLiteDataManager.renameUserPlaylist(userId: string, oldName: string, newName: string): Promise<boolean>`
  - `SQLiteDataManager.deleteUserPlaylist(userId: string, name: string): Promise<boolean>`

- [ ] **Step 1: Add types to `src/typings/index.d.ts`**

Insert after the `SavedQueueSong` type (line ~172):

```ts
export type SavedPlaylistSong = Song & { addedAt: number };

export type Playlist = {
    playlistId: string;
    userId: string;
    name: string;
    isSpecial: boolean;
    createdAt: number;
    updatedAt: number;
    songs: SavedPlaylistSong[];
};

export type PlaylistMeta = {
    playlistId: string;
    name: string;
    isSpecial: boolean;
    createdAt: number;
    updatedAt: number;
    trackCount: number;
};

export type UserPlayStats = {
    userId: string;
    playCount: number;
    lastPlayedAt: number;
    rank: number;
};

export type GuildLeaderboardEntry = {
    userId: string;
    playCount: number;
    lastPlayedAt: number;
    rank: number;
};
```

(`UserPlayStats` / `GuildLeaderboardEntry` are consumed by Task 3's methods.)

- [ ] **Step 2: Extend `ExtendedDataManager`**

Inside `export interface ExtendedDataManager { ... }` (typings line ~330), append these members:

```ts
    getUserPlaylistById(userId: string, playlistId: string): Playlist | null;
    getUserPlaylistByName(userId: string, name: string): Playlist | null;
    getUserPlaylistMetas(userId: string): PlaylistMeta[];
    createUserPlaylist(userId: string, name: string, isSpecial?: boolean): Promise<Playlist>;
    saveUserPlaylist(playlist: Playlist): Promise<void>;
    renameUserPlaylist(userId: string, oldName: string, newName: string): Promise<boolean>;
    deleteUserPlaylist(userId: string, name: string): Promise<boolean>;
    incrementUserPlays(guildId: string, userId: string, count: number): Promise<void>;
    getUserPlayStats(guildId: string, userId: string): UserPlayStats | null;
    getGuildLeaderboard(guildId: string, limit: number, offset: number): GuildLeaderboardEntry[];
    countGuildStats(guildId: string): number;
```

- [ ] **Step 3: Update `SQLiteDataManager` imports**

In `src/utils/structures/SQLiteDataManager.ts`, replace line 4:

```ts
import { type BotSettings, type GuildData } from "../../typings/index.js";
```

with:

```ts
import { SnowflakeUtil } from "discord.js";
import {
    type BotSettings,
    type GuildData,
    type GuildLeaderboardEntry,
    type Playlist,
    type PlaylistMeta,
    type UserPlayStats,
} from "../../typings/index.js";
```

(Biome organizes imports; `discord.js` group goes above the local `../../typings` group — keep the existing import block sorted as Biome expects: `node:fs`, `node:path`, `better-sqlite3`, `discord.js`, then typings, then local.)

- [ ] **Step 4: Add schema in `initSchema()`**

At the end of `initSchema()` (after the `search_provider` column migration, before the closing brace), add:

```ts
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_playlists (
                user_id TEXT NOT NULL,
                playlist_id TEXT NOT NULL,
                name TEXT NOT NULL,
                is_special INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                track_count INTEGER NOT NULL DEFAULT 0,
                songs_json TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (playlist_id)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_user_playlists_un
                ON user_playlists(user_id, name COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS guild_user_stats (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                play_count INTEGER NOT NULL DEFAULT 0,
                last_played_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (guild_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_guild_user_stats_rank
                ON guild_user_stats(guild_id, play_count DESC);
        `);
```

- [ ] **Step 5: Add playlist methods**

Add to the `SQLiteDataManager` class (after `setPrefix`, before `deleteGuildData`):

```ts
    private mapPlaylistRow(row: {
        user_id: string;
        playlist_id: string;
        name: string;
        is_special: number;
        created_at: number;
        updated_at: number;
        track_count: number;
        songs_json: string;
    }): Playlist {
        return {
            playlistId: row.playlist_id,
            userId: row.user_id,
            name: row.name,
            isSpecial: row.is_special === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            songs: JSON.parse(row.songs_json) as Playlist["songs"],
        };
    }

    public getUserPlaylistMetas(userId: string): PlaylistMeta[] {
        const rows = this.db
            .prepare(
                "SELECT playlist_id, name, is_special, created_at, updated_at, track_count FROM user_playlists WHERE user_id = ? ORDER BY is_special DESC, updated_at DESC",
            )
            .all(userId) as Array<{
            playlist_id: string;
            name: string;
            is_special: number;
            created_at: number;
            updated_at: number;
            track_count: number;
        }>;
        return rows.map((row) => ({
            playlistId: row.playlist_id,
            name: row.name,
            isSpecial: row.is_special === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            trackCount: row.track_count,
        }));
    }

    public getUserPlaylistByName(userId: string, name: string): Playlist | null {
        const row = this.db
            .prepare("SELECT * FROM user_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE")
            .get(userId, name) as
            | {
                  user_id: string;
                  playlist_id: string;
                  name: string;
                  is_special: number;
                  created_at: number;
                  updated_at: number;
                  track_count: number;
                  songs_json: string;
              }
            | undefined;
        return row === undefined ? null : this.mapPlaylistRow(row);
    }

    public getUserPlaylistById(userId: string, playlistId: string): Playlist | null {
        const row = this.db
            .prepare("SELECT * FROM user_playlists WHERE user_id = ? AND playlist_id = ?")
            .get(userId, playlistId) as
            | {
                  user_id: string;
                  playlist_id: string;
                  name: string;
                  is_special: number;
                  created_at: number;
                  updated_at: number;
                  track_count: number;
                  songs_json: string;
              }
            | undefined;
        return row === undefined ? null : this.mapPlaylistRow(row);
    }

    public async createUserPlaylist(
        userId: string,
        name: string,
        isSpecial = false,
    ): Promise<Playlist> {
        const playlist: Playlist = {
            playlistId: isSpecial
                ? `${userId}-favorites`
                : SnowflakeUtil.generate().toLocaleString(),
            userId,
            name,
            isSpecial,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            songs: [],
        };
        await this.manager.add(async () => {
            this.db
                .prepare(
                    "INSERT INTO user_playlists (user_id, playlist_id, name, is_special, created_at, updated_at, track_count, songs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .run(
                    playlist.userId,
                    playlist.playlistId,
                    playlist.name,
                    playlist.isSpecial ? 1 : 0,
                    playlist.createdAt,
                    playlist.updatedAt,
                    0,
                    "[]",
                );
        });
        return playlist;
    }

    public async saveUserPlaylist(playlist: Playlist): Promise<void> {
        await this.manager.add(async () => {
            this.db
                .prepare(
                    "INSERT INTO user_playlists (user_id, playlist_id, name, is_special, created_at, updated_at, track_count, songs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(playlist_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at, track_count = excluded.track_count, songs_json = excluded.songs_json",
                )
                .run(
                    playlist.userId,
                    playlist.playlistId,
                    playlist.name,
                    playlist.isSpecial ? 1 : 0,
                    playlist.createdAt,
                    Date.now(),
                    playlist.songs.length,
                    JSON.stringify(playlist.songs),
                );
        });
    }

    public async renameUserPlaylist(
        userId: string,
        oldName: string,
        newName: string,
    ): Promise<boolean> {
        let renamed = false;
        await this.manager.add(async () => {
            const changes = this.db
                .prepare(
                    "UPDATE user_playlists SET name = ?, updated_at = ? WHERE user_id = ? AND name = ? COLLATE NOCASE AND is_special = 0",
                )
                .run(newName, Date.now(), userId, oldName).changes;
            renamed = changes > 0;
        });
        return renamed;
    }

    public async deleteUserPlaylist(userId: string, name: string): Promise<boolean> {
        let deleted = false;
        await this.manager.add(async () => {
            const changes = this.db
                .prepare(
                    "DELETE FROM user_playlists WHERE user_id = ? AND name = ? COLLATE NOCASE AND is_special = 0",
                )
                .run(userId, name).changes;
            deleted = changes > 0;
        });
        return deleted;
    }
```

- [ ] **Step 6: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/typings/index.d.ts src/utils/structures/SQLiteDataManager.ts
git commit -m "feat: add user_playlists storage and Playlist types"
```

---

### Task 3: Stats storage (play counts)

**Files:**
- Modify: `src/utils/structures/SQLiteDataManager.ts` (methods only — schema already added in Task 2)

**Interfaces:**
- Consumes: `UserPlayStats`, `GuildLeaderboardEntry` types from Task 2
- Produces (used by Tasks 9, 10):
  - `incrementUserPlays(guildId: string, userId: string, count: number): Promise<void>`
  - `getUserPlayStats(guildId: string, userId: string): UserPlayStats | null` (null when the user has no row)
  - `getGuildLeaderboard(guildId: string, limit: number, offset: number): GuildLeaderboardEntry[]` (ordered `play_count DESC, last_played_at ASC, user_id ASC`; `rank = offset + index + 1`)
  - `countGuildStats(guildId: string): number` (rows with `play_count > 0`)

- [ ] **Step 1: Add stats methods**

Add to `SQLiteDataManager` right after `deleteUserPlaylist`:

```ts
    public async incrementUserPlays(
        guildId: string,
        userId: string,
        count: number,
    ): Promise<void> {
        await this.manager.add(async () => {
            this.db
                .prepare(
                    "INSERT INTO guild_user_stats (guild_id, user_id, play_count, last_played_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET play_count = play_count + excluded.play_count, last_played_at = excluded.last_played_at",
                )
                .run(guildId, userId, count, Date.now());
        });
    }

    public getUserPlayStats(guildId: string, userId: string): UserPlayStats | null {
        const row = this.db
            .prepare("SELECT play_count, last_played_at FROM guild_user_stats WHERE guild_id = ? AND user_id = ?")
            .get(guildId, userId) as { play_count: number; last_played_at: number } | undefined;
        if (row === undefined) {
            return null;
        }
        const higher = this.db
            .prepare(
                "SELECT COUNT(*) AS c FROM guild_user_stats WHERE guild_id = ? AND play_count > ?",
            )
            .get(guildId, row.play_count) as { c: number };
        return {
            userId,
            playCount: row.play_count,
            lastPlayedAt: row.last_played_at,
            rank: higher.c + 1,
        };
    }

    public getGuildLeaderboard(
        guildId: string,
        limit: number,
        offset: number,
    ): GuildLeaderboardEntry[] {
        const rows = this.db
            .prepare(
                "SELECT user_id, play_count, last_played_at FROM guild_user_stats WHERE guild_id = ? ORDER BY play_count DESC, last_played_at ASC, user_id ASC LIMIT ? OFFSET ?",
            )
            .all(guildId, limit, offset) as Array<{
            user_id: string;
            play_count: number;
            last_played_at: number;
        }>;
        return rows.map((row, index) => ({
            userId: row.user_id,
            playCount: row.play_count,
            lastPlayedAt: row.last_played_at,
            rank: offset + index + 1,
        }));
    }

    public countGuildStats(guildId: string): number {
        const row = this.db
            .prepare(
                "SELECT COUNT(*) AS c FROM guild_user_stats WHERE guild_id = ? AND play_count > 0",
            )
            .get(guildId) as { c: number };
        return row.c;
    }
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/structures/SQLiteDataManager.ts
git commit -m "feat: add guild_user_stats play-count storage"
```

---

### Task 4: `playlist.ts` shared helper

**Files:**
- Create: `src/utils/functions/playlist.ts`

**Interfaces:**
- Consumes: `Playlist`, `SavedPlaylistSong`, `Song` types; `client.data.getUserPlaylistByName`, `client.data.createUserPlaylist`; `searchTrack` is NOT used here (stored songs are passed straight to `handleVideos`, which re-hydrates at play time — same as saved-queue restore)
- Produces (used by Tasks 7, 8):
  - `PLAYLIST_LIMITS = { maxPlaylists: 25, maxTracks: 200, maxNameLength: 50, favoritesName: "Favorites" }`
  - `validatePlaylistName(name: string): "empty" | "tooLong" | "reserved" | null`
  - `toSavedPlaylistSong(song: Song): SavedPlaylistSong`
  - `storedToSong(saved: SavedPlaylistSong): Song`
  - `findSavedSongIndex(songs: SavedPlaylistSong[], url: string): number` (−1 when absent)
  - `ensureFavorites(client: Rawon, userId: string): Promise<Playlist>`
  - `ensureMusicChannel(ctx: CommandContext, client: Rawon, __mf: ReturnType<typeof i18n__mf>): boolean` (false = already replied with a warning)

- [ ] **Step 1: Create the file**

`src/utils/functions/playlist.ts`:

```ts
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
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/functions/playlist.ts
git commit -m "feat: add playlist shared helpers and limits"
```

---

### Task 5: `userStats.ts` title tiers

**Files:**
- Create: `src/utils/functions/userStats.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by Tasks 9): `TITLE_TIERS`, `TitleTier`, `getTitleTier(playCount): TitleTier`, `getNextTitleTier(playCount): TitleTier | null`, `getTitlePhrase(playCount): string` (returns an i18n key like `commands.music.titles.audiophile`)

- [ ] **Step 1: Create the file**

`src/utils/functions/userStats.ts`:

```ts
export const TITLE_TIERS = [
    { minPlays: 0, key: "newListener" },
    { minPlays: 25, key: "musicEnjoyer" },
    { minPlays: 100, key: "audiophile" },
    { minPlays: 500, key: "melomaniac" },
    { minPlays: 1000, key: "musicLegend" },
] as const;

export type TitleTier = (typeof TITLE_TIERS)[number];

export function getTitleTier(playCount: number): TitleTier {
    let current: TitleTier = TITLE_TIERS[0];
    for (const tier of TITLE_TIERS) {
        if (playCount >= tier.minPlays) {
            current = tier;
        }
    }
    return current;
}

export function getNextTitleTier(playCount: number): TitleTier | null {
    for (const tier of TITLE_TIERS) {
        if (playCount < tier.minPlays) {
            return tier;
        }
    }
    return null;
}

export function getTitlePhrase(playCount: number): string {
    return `commands.music.titles.${getTitleTier(playCount).key}`;
}
```

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/utils/functions/userStats.ts
git commit -m "feat: add listening title tier helpers"
```

---

### Task 6: i18n keys for all 14 locales

**Files:**
- Modify: `lang/en-US.json` (add 5 objects under `commands.music`)
- Modify: `lang/id-ID.json` (translated versions)
- Modify: the other 12 `lang/*.json` (script copies en-US values)

**Interfaces:**
- Consumes: nothing
- Produces: every key referenced by Tasks 7–9

- [ ] **Step 1: Add keys to `lang/en-US.json`**

Inside the `"music"` object of `"commands"`, add (mind trailing commas — `requestChannel` is currently last):

```json
"playlist": {
    "description": "Manage your personal playlists",
    "usage": "{prefix}playlist <create|delete|rename|list|info|add|remove|play|save|import>",
    "subCreate": "Create a new playlist",
    "subDelete": "Delete a playlist",
    "subRename": "Rename a playlist",
    "subList": "List your playlists",
    "subInfo": "Show a playlist's tracks",
    "subAdd": "Add a song to a playlist",
    "subRemove": "Remove a track from a playlist",
    "subPlay": "Play a playlist",
    "subSave": "Save the current queue as a new playlist",
    "subImport": "Import a playlist URL into a playlist",
    "subNameDescription": "Playlist name",
    "subFromDescription": "Current playlist name",
    "subToDescription": "New playlist name",
    "subQueryDescription": "Song query or URL",
    "subPositionDescription": "Track position",
    "subUrlDescription": "Playlist URL",
    "created": "Playlist **`{name}`** created.",
    "deleted": "Playlist **`{name}`** deleted.",
    "deleteCancelled": "Deletion cancelled.",
    "deleteConfirm": "Delete playlist **`{name}`** ({count} tracks)? This cannot be undone.",
    "deleteYes": "Delete",
    "deleteNo": "Cancel",
    "cannotDeleteFavorites": "The favorites list cannot be deleted.",
    "cannotRenameFavorites": "The favorites list cannot be renamed.",
    "notFound": "Playlist **`{name}`** not found.",
    "nameTaken": "A playlist named **`{name}`** already exists.",
    "limitReached": "You can only have up to **{max}** playlists.",
    "trackLimitReached": "Playlist **`{name}`** can only hold up to **{max}** tracks.",
    "renamed": "Playlist **`{from}`** renamed to **`{to}`**.",
    "nameTooLong": "Playlist names can be at most **{max}** characters long.",
    "nameEmpty": "Please provide a playlist name.",
    "nameReserved": "The name **`{name}`** is reserved.",
    "noPlaylists": "You have no playlists yet. Create one with `{prefix}playlist create <name>`.",
    "listTitle": "Your playlists",
    "trackCountLabel": "{count} tracks",
    "infoTitle": "Playlist: {name}",
    "emptyPlaylist": "Playlist **`{name}`** is empty.",
    "addedTo": "Added {song} to **`{name}`**.",
    "duplicateAt": "{song} is already in **`{name}`** at position **{position}**.",
    "noQuery": "Please provide a song query.",
    "noTracks": "No results found for that query.",
    "useImportForCollection": "That link is a playlist or album. Use `{prefix}playlist import <name> <url>` instead.",
    "selectAddPlaceholder": "Select a playlist to add the song to",
    "selectPlaceholder": "Select a playlist",
    "selectExpired": "That selection has expired — run the command again.",
    "removedTrack": "Removed track **#{position}** ({song}) from **`{name}`**.",
    "invalidIndex": "Invalid track position. Use a number between **1** and **{max}**.",
    "savedFromQueue": "Saved the current queue ({count} tracks) as playlist **`{name}`**.",
    "queueEmpty": "The queue is empty.",
    "imported": "Imported **{added}** tracks into **`{name}`** from {source} — {skipped} duplicate(s) skipped{truncated}.",
    "importTruncatedSuffix": ", {dropped} skipped due to the {max}-track limit",
    "invalidImportUrl": "Please provide a valid playlist URL."
},
"favorite": {
    "description": "Favorite the currently playing song, or manage your favorites",
    "usage": "{prefix}favorite [list|play|remove <position>]",
    "subToggle": "Favorite or unfavorite the current song",
    "subList": "List your favorites",
    "subPlay": "Play your favorites",
    "subRemove": "Remove a track from your favorites",
    "subPositionDescription": "Track position",
    "added": "Added {song} to your favorites.",
    "removed": "Removed {song} from your favorites.",
    "nothingPlaying": "Nothing is playing right now.",
    "listTitle": "Your favorites",
    "empty": "You have no favorites yet. Play a song and use `{prefix}favorite`.",
    "removedTrack": "Removed track **#{position}** ({song}) from your favorites.",
    "invalidIndex": "Invalid track position. Use a number between **1** and **{max}**."
},
"leaderboard": {
    "description": "Show the most active listeners in this server",
    "usage": "{prefix}leaderboard",
    "title": "Top listeners",
    "empty": "No listening activity in this server yet.",
    "playsLabel": "plays"
},
"profile": {
    "description": "Show your listening stats and title",
    "usage": "{prefix}profile [user]",
    "subUserDescription": "User to show stats for",
    "title": "Listening profile",
    "playCountLabel": "Songs requested",
    "rankLabel": "Server rank",
    "rankUnranked": "Unranked",
    "titleLabel": "Title",
    "nextTitle": "Next title",
    "nextTierProgress": "{title} ({current}/{needed})",
    "maxTierReached": "Highest title reached",
    "noData": "No listening activity yet."
},
"titles": {
    "newListener": "New Listener",
    "musicEnjoyer": "Music Enjoyer",
    "audiophile": "Audiophile",
    "melomaniac": "Melomaniac",
    "musicLegend": "Music Legend"
}
```

- [ ] **Step 2: Add translated keys to `lang/id-ID.json`**

Same structure under `commands.music`:

```json
"playlist": {
    "description": "Kelola playlist pribadimu",
    "usage": "{prefix}playlist <create|delete|rename|list|info|add|remove|play|save|import>",
    "subCreate": "Buat playlist baru",
    "subDelete": "Hapus playlist",
    "subRename": "Rename playlist",
    "subList": "Lihat daftar playlist-mu",
    "subInfo": "Lihat isi playlist",
    "subAdd": "Tambah lagu ke playlist",
    "subRemove": "Hapus lagu dari playlist",
    "subPlay": "Putar playlist",
    "subSave": "Simpan queue yang sedang jalan sebagai playlist baru",
    "subImport": "Impor URL playlist ke playlist",
    "subNameDescription": "Nama playlist",
    "subFromDescription": "Nama playlist sekarang",
    "subToDescription": "Nama playlist baru",
    "subQueryDescription": "Kata pencarian atau URL lagu",
    "subPositionDescription": "Nomor urut lagu",
    "subUrlDescription": "URL playlist",
    "created": "Playlist **`{name}`** berhasil dibuat.",
    "deleted": "Playlist **`{name}`** berhasil dihapus.",
    "deleteCancelled": "Penghapusan dibatalkan.",
    "deleteConfirm": "Hapus playlist **`{name}`** ({count} lagu)? Ini tidak bisa dibatalkan.",
    "deleteYes": "Hapus",
    "deleteNo": "Batal",
    "cannotDeleteFavorites": "Daftar favorit tidak bisa dihapus.",
    "cannotRenameFavorites": "Daftar favorit tidak bisa direname.",
    "notFound": "Playlist **`{name}`** tidak ditemukan.",
    "nameTaken": "Playlist bernama **`{name}`** sudah ada.",
    "limitReached": "Kamu hanya bisa punya maksimal **{max}** playlist.",
    "trackLimitReached": "Playlist **`{name}`** hanya bisa menampung maksimal **{max}** lagu.",
    "renamed": "Playlist **`{from}`** direname jadi **`{to}`**.",
    "nameTooLong": "Nama playlist maksimal **{max}** karakter.",
    "nameEmpty": "Tolong kasih nama playlist-nya.",
    "nameReserved": "Nama **`{name}`** dipakai khusus untuk daftar favorit.",
    "noPlaylists": "Kamu belum punya playlist. Buat dulu pakai `{prefix}playlist create <nama>`.",
    "listTitle": "Playlist-mu",
    "trackCountLabel": "{count} lagu",
    "infoTitle": "Playlist: {name}",
    "emptyPlaylist": "Playlist **`{name}`** masih kosong.",
    "addedTo": "{song} ditambahkan ke **`{name}`**.",
    "duplicateAt": "{song} sudah ada di **`{name}`** posisi **{position}**.",
    "noQuery": "Tolong kasih kata pencarian lagunya.",
    "noTracks": "Gak ada hasil untuk pencarian itu.",
    "useImportForCollection": "Link itu playlist/album. Pakai `{prefix}playlist import <nama> <url>` saja.",
    "selectAddPlaceholder": "Pilih playlist tujuan untuk lagunya",
    "selectPlaceholder": "Pilih playlist",
    "selectExpired": "Pilihan itu kedaluwarsa — jalankan ulang command-nya.",
    "removedTrack": "Lagu **#{position}** ({song}) dihapus dari **`{name}`**.",
    "invalidIndex": "Nomor urut tidak valid. Pakai angka antara **1** sampai **{max}**.",
    "savedFromQueue": "Queue yang sedang jalan ({count} lagu) disimpan jadi playlist **`{name}`**.",
    "queueEmpty": "Queuenya kosong.",
    "imported": "**{added}** lagu diimpor ke **`{name}`** dari {source} — {skipped} duplikat dilewati{truncated}.",
    "importTruncatedSuffix": ", {dropped} dilewati karena batas {max} lagu",
    "invalidImportUrl": "Tolong kasih URL playlist yang valid."
},
"favorite": {
    "description": "Favoritkan lagu yang sedang diputar, atau kelola daftar favoritmu",
    "usage": "{prefix}favorite [list|play|remove <nomor>]",
    "subToggle": "Favoritkan / hapus favorit lagu yang sedang diputar",
    "subList": "Lihat daftar favoritmu",
    "subPlay": "Putar daftar favoritmu",
    "subRemove": "Hapus lagu dari daftar favorit",
    "subPositionDescription": "Nomor urut lagu",
    "added": "{song} ditambahkan ke favoritmu.",
    "removed": "{song} dihapus dari favoritmu.",
    "nothingPlaying": "Lagi gak ada yang diputar.",
    "listTitle": "Favoritmu",
    "empty": "Kamu belum punya favorit. Putar lagu lalu pakai `{prefix}favorite`.",
    "removedTrack": "Lagu **#{position}** ({song}) dihapus dari favoritmu.",
    "invalidIndex": "Nomor urut tidak valid. Pakai angka antara **1** sampai **{max}**."
},
"leaderboard": {
    "description": "Lihat pendengar paling aktif di server ini",
    "usage": "{prefix}leaderboard",
    "title": "Pendengar teratas",
    "empty": "Belum ada aktivitas mendengarkan di server ini.",
    "playsLabel": "kali main"
},
"profile": {
    "description": "Lihat statistik dengar dan julukanmu",
    "usage": "{prefix}profile [user]",
    "subUserDescription": "User yang mau dilihat statistiknya",
    "title": "Profil pendengaran",
    "playCountLabel": "Lagu yang diminta",
    "rankLabel": "Peringkat di server",
    "rankUnranked": "Belum berperingkat",
    "titleLabel": "Julukan",
    "nextTitle": "Julukan berikutnya",
    "nextTierProgress": "{title} ({current}/{needed})",
    "maxTierReached": "Julukan tertinggi sudah tercapai",
    "noData": "Belum ada aktivitas mendengarkan."
},
"titles": {
    "newListener": "Pendengar Baru",
    "musicEnjoyer": "Penikmat Musik",
    "audiophile": "Audiofil",
    "melomaniac": "Melomaniak",
    "musicLegend": "Legenda Musik"
}
```

- [ ] **Step 3: Copy en-US values into the other 12 locale files**

Run from the repo root (Git Bash on Windows — use forward slashes):

```bash
node -e "
const fs = require('node:fs');
const dir = 'lang';
const source = JSON.parse(fs.readFileSync(dir + '/en-US.json', 'utf8'));
const keys = ['playlist', 'favorite', 'leaderboard', 'profile', 'titles'];
for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'en-US.json' || file === 'id-ID.json') continue;
    const p = dir + '/' + file;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const key of keys) {
        data.commands.music[key] = source.commands.music[key];
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 4) + '\n');
    console.log('updated', file);
}
"
```

Expected output: 12 `updated <locale>.json` lines. Locale files use 4-space indent (verified), so `JSON.stringify(data, null, 4)` preserves formatting.

- [ ] **Step 4: Validate all locale files parse and keys exist**

```bash
node -e "
const fs = require('node:fs');
for (const file of fs.readdirSync('lang')) {
    if (!file.endsWith('.json')) continue;
    const d = JSON.parse(fs.readFileSync('lang/' + file, 'utf8'));
    for (const k of ['playlist', 'favorite', 'leaderboard', 'profile', 'titles']) {
        if (d.commands.music[k] === undefined) throw new Error(file + ' missing ' + k);
    }
}
console.log('all locale files OK');
"
```

Expected: `all locale files OK`.

- [ ] **Step 5: Verify & commit**

Run: `pnpm lint && pnpm build`
Expected: both pass.

```bash
git add lang/
git commit -m "feat: add playlist/favorite/leaderboard/profile i18n keys"
```

---

### Task 7: `PlaylistCommand`

**Files:**
- Create: `src/commands/music/PlaylistCommand.ts`

**Interfaces:**
- Consumes: storage methods (Task 2), `PLAYLIST_LIMITS`/`validatePlaylistName`/`toSavedPlaylistSong`/`storedToSong`/`findSavedSongIndex`/`ensureMusicChannel` (Task 4), i18n keys (Task 6), `checkQuery`/`searchTrack`/`handleVideos` from `../../utils/handlers/GeneralUtil.js`
- Produces: command `playlist` (alias `pl`) with subcommands `create|delete|rename|list|info|add|remove|play|save|import`; select-menu customId `base64("<userId>_playlist")` with option values `"<action>:<playlistId>"` (actions `add`, `play`)

- [ ] **Step 1: Create the file**

`src/commands/music/PlaylistCommand.ts`:

```ts
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
import { CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Playlist, type PlaylistMeta } from "../../typings/index.js";
import { chunk } from "../../utils/functions/chunk.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { getEffectivePrefix } from "../../utils/functions/getEffectivePrefix.js";
import {
    formatBoldMarkdownLink,
    formatMarkdownLink,
    formatMarkdownText,
} from "../../utils/functions/formatMarkdown.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import {
    PLAYLIST_LIMITS,
    ensureMusicChannel,
    findSavedSongIndex,
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

        if (!ensureMusicChannel(ctx, client, __mf)) {
            return;
        }
        if (playlist.songs.length === 0) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.emptyPlaylist", { name: playlist.name }),
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

        await handleVideos(
            client,
            localCtx,
            playlist.songs.map(storedToSong),
            voiceChannel,
            { title: playlist.name, url: "" },
        );
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
                        embeds: [
                            createEmbed("warn", __("commands.music.playlist.selectExpired")),
                        ],
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
                        __mf("commands.music.playlist.nameReserved", { name: trimmed }),
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
                embeds: [
                    createEmbed("warn", __mf("commands.music.playlist.notFound", { name })),
                ],
            });
            return;
        }
        if (playlist.isSpecial) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __("commands.music.playlist.cannotDeleteFavorites")),
                ],
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
```

(Note: there is no `deleted2`/`notFound2` key — the final delete reply uses the existing `deleted`/`notFound` keys with `{name}` via `__mf`.)

```ts
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
                embeds: [createEmbed("warn", __mf("commands.music.playlist.notFound", { name: from }))],
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
                        __mf("commands.music.playlist.nameReserved", { name: targetName }),
                    ),
                ],
            });
            return;
        }
        const clash = client.data.getUserPlaylistByName(userId, targetName);
        if (clash !== null && clash.playlistId !== playlist.playlistId) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __mf("commands.music.playlist.nameTaken", { name: targetName })),
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
                        ? __mf("commands.music.playlist.renamed", { from: playlist.name, to: targetName })
                        : __mf("commands.music.playlist.notFound", { name: playlist.name }),
                    true,
                ),
            ],
        });
    }
```

```ts
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
```

(The `noPlaylists`, `useImportForCollection` keys contain `{prefix}`; `i18n.__` does not substitute named placeholders — always pass them through `__mf` with `{ prefix }` from `getEffectivePrefix(client, guildId)`, exactly like `PlayCommand` does.)

```ts
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
                        __mf("commands.music.playlist.emptyPlaylist", { name: playlist.name }),
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
                        __mf("commands.music.playlist.useImportForCollection", { prefix }),
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
        if (name === undefined || name.trim().length === 0) {
            const metas = client.data.getUserPlaylistMetas(userId);
            if (metas.length === 0) {
                const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
                const __mf = i18n__mf(client, ctx.guild);
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
        const __mf = i18n__mf(client, ctx.guild);
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
                        __mf("commands.music.playlist.nameReserved", { name: trimmed }),
                    ),
                ],
            });
            return;
        }
        if (client.data.getUserPlaylistByName(userId, trimmed) !== null) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __mf("commands.music.playlist.nameTaken", { name: trimmed })),
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
            const saved = toSavedPlaylistSong(queueSong.song);
            if (seen.has(saved.url)) {
                continue;
            }
            seen.add(saved.url);
            if (playlist.songs.length >= PLAYLIST_LIMITS.maxTracks) {
                break;
            }
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
                embeds: [
                    createEmbed("info", `🔍 **|** ${__("requestChannel.resolvingPlaylist")}`),
                ],
            });
        }

        const result = await searchTrack(client, urlText).catch(() => null);
        if (!result || result.items.length === 0) {
            const errorEmbed = createEmbed(
                "error",
                __("commands.music.playlist.noTracks"),
                true,
            );
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
            if (error === "empty") {
                const errorEmbed = createEmbed("warn", __("commands.music.playlist.nameEmpty"));
                if (localCtx.deferred) {
                    await localCtx.editReply({ embeds: [errorEmbed] });
                } else {
                    await ctx.reply({ embeds: [errorEmbed] });
                }
                return;
            }
            if (error === "tooLong") {
                const errorEmbed = createEmbed(
                    "warn",
                    __mf("commands.music.playlist.nameTooLong", {
                        max: PLAYLIST_LIMITS.maxNameLength,
                    }),
                );
                if (localCtx.deferred) {
                    await localCtx.editReply({ embeds: [errorEmbed] });
                } else {
                    await ctx.reply({ embeds: [errorEmbed] });
                }
                return;
            }
            if (error === "reserved") {
                const errorEmbed = createEmbed(
                    "warn",
                    __mf("commands.music.playlist.nameReserved", { name: trimmed }),
                );
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
}
```

Implementation notes for the implementer (authoritative):
1. `addSongTo`, when reached via select menu, runs on a StringSelectMenuInteraction context — `ctx.reply` handles it (the harness supports select-menu replies, same as SearchCommand).
2. `playPlaylist` mirrors PlayCommand's core guards manually (request-channel via `ensureMusicChannel`, in-VC, different-VC) because method decorators cannot vary per subcommand.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass. Fix any Biome import-order complaints by reordering imports alphabetically within their groups.

- [ ] **Step 3: Commit**

```bash
git add src/commands/music/PlaylistCommand.ts
git commit -m "feat: add playlist command with favorites-aware subcommands"
```

---

### Task 8: `FavoriteCommand`

**Files:**
- Create: `src/commands/music/FavoriteCommand.ts`

**Interfaces:**
- Consumes: `ensureFavorites`, `findSavedSongIndex`, `toSavedPlaylistSong`, `storedToSong`, `PLAYLIST_LIMITS`, `ensureMusicChannel` (Task 4); storage (Task 2); i18n keys (Task 6)
- Produces: command `favorite` (aliases `fav`, `like`); subcommands `toggle|list|play|remove`

- [ ] **Step 1: Create the file**

`src/commands/music/FavoriteCommand.ts`:

```ts
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { AudioPlayerPlayingState, AudioPlayerStatus } from "@discordjs/voice";
import {
    PermissionFlagsBits,
    type SlashCommandBuilder,
    type VoiceBasedChannel,
} from "discord.js";
import i18n from "../../config/index.js";
import { CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Playlist, type QueueSong } from "../../typings/index.js";
import { chunk } from "../../utils/functions/chunk.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { formatBoldMarkdownLink, formatMarkdownLink } from "../../utils/functions/formatMarkdown.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import {
    PLAYLIST_LIMITS,
    ensureFavorites,
    ensureMusicChannel,
    findSavedSongIndex,
    storedToSong,
    toSavedPlaylistSong,
} from "../../utils/functions/playlist.js";
import { handleVideos } from "../../utils/handlers/GeneralUtil.js";
import { ButtonPagination } from "../../utils/structures/ButtonPagination.js";

@ApplyOptions<Command.Options>({
    name: "favorite",
    aliases: ["fav", "like"],
    description: i18n.__("commands.music.favorite.description"),
    detailedDescription: { usage: i18n.__("commands.music.favorite.usage") },
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
            .setName(opts.name ?? "favorite")
            .setDescription(opts.description ?? i18n.__("commands.music.favorite.description"))
            .addSubcommand((sub) =>
                sub.setName("toggle").setDescription(i18n.__("commands.music.favorite.subToggle")),
            )
            .addSubcommand((sub) =>
                sub.setName("list").setDescription(i18n.__("commands.music.favorite.subList")),
            )
            .addSubcommand((sub) =>
                sub.setName("play").setDescription(i18n.__("commands.music.favorite.subPlay")),
            )
            .addSubcommand((sub) =>
                sub
                    .setName("remove")
                    .setDescription(i18n.__("commands.music.favorite.subRemove"))
                    .addIntegerOption((opt) =>
                        opt
                            .setName("position")
                            .setDescription(
                                i18n.__("commands.music.favorite.subPositionDescription"),
                            )
                            .setRequired(true),
                    ),
            ) as SlashCommandBuilder;
    },
})
export class FavoriteCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    private async toggle(ctx: CommandContext, client: Rawon): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const queue = ctx.guild?.queue;
        if (
            !queue ||
            queue.player.state.status !== AudioPlayerStatus.Playing
        ) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __("commands.music.favorite.nothingPlaying")),
                ],
            });
            return;
        }
        const np = (queue.player.state as AudioPlayerPlayingState).resource
            .metadata as QueueSong;
        const favorites = await ensureFavorites(client, ctx.author.id);
        const existingIndex = findSavedSongIndex(favorites.songs, np.song.url);
        if (existingIndex !== -1) {
            favorites.songs.splice(existingIndex, 1);
            await client.data.saveUserPlaylist(favorites);
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "success",
                        __mf("commands.music.favorite.removed", {
                            song: formatBoldMarkdownLink(np.song.title, np.song.url),
                        }),
                        true,
                    ),
                ],
            });
            return;
        }
        if (favorites.songs.length >= PLAYLIST_LIMITS.maxTracks) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.playlist.trackLimitReached", {
                            name: favorites.name,
                            max: PLAYLIST_LIMITS.maxTracks,
                        }),
                    ),
                ],
            });
            return;
        }
        favorites.songs.push(toSavedPlaylistSong(np.song));
        await client.data.saveUserPlaylist(favorites);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.favorite.added", {
                        song: formatBoldMarkdownLink(np.song.title, np.song.url),
                    }),
                    true,
                ),
            ],
        });
    }

    private async list(ctx: CommandContext, client: Rawon): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const favorites = client.data.getUserPlaylistByName(
            ctx.author.id,
            PLAYLIST_LIMITS.favoritesName,
        );
        if (favorites === null || favorites.songs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.empty"))],
            });
            return;
        }
        const pages = chunk(favorites.songs, 10).map((songs, pageIndex) =>
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
            `❤️ ${__("commands.music.favorite.listTitle")}`,
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

    private async play(ctx: CommandContext, client: Rawon): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const favorites = client.data.getUserPlaylistByName(
            ctx.author.id,
            PLAYLIST_LIMITS.favoritesName,
        );
        if (favorites === null || favorites.songs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.empty"))],
            });
            return;
        }
        await this.playFavorites(ctx, client, favorites);
    }

    private async playFavorites(
        ctx: CommandContext,
        client: Rawon,
        favorites: Playlist,
    ): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);

        if (!ensureMusicChannel(ctx, client, __mf)) {
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

        await handleVideos(
            client,
            localCtx,
            favorites.songs.map(storedToSong),
            voiceChannel,
            { title: __("commands.music.favorite.listTitle"), url: "" },
        );
    }

    private async remove(
        ctx: CommandContext,
        client: Rawon,
        position: number | undefined,
    ): Promise<void> {
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const favorites = client.data.getUserPlaylistByName(
            ctx.author.id,
            PLAYLIST_LIMITS.favoritesName,
        );
        if (favorites === null || favorites.songs.length === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.favorite.empty"))],
            });
            return;
        }
        const index = position ?? Number.NaN;
        if (!Number.isInteger(index) || index < 1 || index > favorites.songs.length) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.favorite.invalidIndex", {
                            max: favorites.songs.length,
                        }),
                    ),
                ],
            });
            return;
        }
        const [removed] = favorites.songs.splice(index - 1, 1);
        await client.data.saveUserPlaylist(favorites);
        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    __mf("commands.music.favorite.removedTrack", {
                        position: index,
                        song: formatMarkdownLink(removed.title, removed.url),
                    }),
                    true,
                ),
            ],
        });
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const arg = localCtx.args[0]?.toLowerCase();
        const sub =
            localCtx.options?.getSubcommand(false) ??
            (["list", "play", "remove"].includes(arg ?? "") ? arg : "toggle");

        switch (sub) {
            case "list":
                await this.list(ctx, client);
                return;
            case "play":
                await this.play(ctx, client);
                return;
            case "remove": {
                const position = localCtx.options?.getInteger("position") ?? Number(localCtx.args[1]);
                await this.remove(ctx, client, position);
                return;
            }
            default:
                await this.toggle(ctx, client);
        }
    }
}
```

The code above is final — no corrections pending.

- [ ] **Step 2: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add src/commands/music/FavoriteCommand.ts
git commit -m "feat: add favorite command with current-song toggle"
```

---

### Task 9: `LeaderboardCommand` + `ProfileCommand`

**Files:**
- Create: `src/commands/music/LeaderboardCommand.ts`
- Create: `src/commands/music/ProfileCommand.ts`

**Interfaces:**
- Consumes: `getGuildLeaderboard`, `countGuildStats`, `getUserPlayStats` (Task 3); `getTitlePhrase`, `getNextTitleTier` (Task 5); i18n keys (Task 6)
- Produces: command `leaderboard` (alias `lb`); command `profile` (alias `stats`)

- [ ] **Step 1: Create `LeaderboardCommand.ts`**

```ts
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { type Rawon } from "../../structures/Rawon.js";
import { chunk } from "../../utils/functions/chunk.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { ButtonPagination } from "../../utils/structures/ButtonPagination.js";
import { getTitlePhrase } from "../../utils/functions/userStats.js";

@ApplyOptions<Command.Options>({
    name: "leaderboard",
    aliases: ["lb"],
    description: i18n.__("commands.music.leaderboard.description"),
    detailedDescription: { usage: i18n.__("commands.music.leaderboard.usage") },
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
            .setName(opts.name ?? "leaderboard")
            .setDescription(
                opts.description ?? i18n.__("commands.music.leaderboard.description"),
            ) as SlashCommandBuilder;
    },
})
export class LeaderboardCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const guildId = ctx.guild?.id;

        if (guildId === undefined) {
            return;
        }

        const total = client.data.countGuildStats(guildId);
        if (total === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.leaderboard.empty"))],
            });
            return;
        }

        const rows = client.data.getGuildLeaderboard(guildId, total, 0);
        const lines = await Promise.all(
            rows.map(async (row) => {
                const member = await ctx.guild?.members
                    .fetch(row.userId)
                    .catch(() => null);
                const user =
                    member ?? (await client.users.fetch(row.userId).catch(() => null));
                const display = member?.displayName ?? user?.username ?? row.userId;
                const title = __(getTitlePhrase(row.playCount));
                return `**#${row.rank}** ${display} — **${row.playCount}** ${__(
                    "commands.music.leaderboard.playsLabel",
                )} · ${title}`;
            }),
        );

        const pages = chunk(lines, 10).map((page) => page.join("\n"));
        const embed = createEmbed("info", pages[0]).setTitle(
            `🏆 ${__("commands.music.leaderboard.title")}`,
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
}
```

- [ ] **Step 2: Create `ProfileCommand.ts`**

```ts
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder, type User } from "discord.js";
import i18n from "../../config/index.js";
import { type Rawon } from "../../structures/Rawon.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { getNextTitleTier, getTitlePhrase } from "../../utils/functions/userStats.js";

@ApplyOptions<Command.Options>({
    name: "profile",
    aliases: ["stats"],
    description: i18n.__("commands.music.profile.description"),
    detailedDescription: { usage: i18n.__("commands.music.profile.usage") },
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
            .setName(opts.name ?? "profile")
            .setDescription(opts.description ?? i18n.__("commands.music.profile.description"))
            .addUserOption((opt) =>
                opt
                    .setName("user")
                    .setDescription(i18n.__("commands.music.profile.subUserDescription"))
                    .setRequired(false),
            ) as SlashCommandBuilder;
    },
})
export class ProfileCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as CommandContext & typeof ctx;
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const guildId = ctx.guild?.id;

        if (guildId === undefined) {
            return;
        }

        const target =
            localCtx.options?.getUser("user") ??
            ctx.mentions?.users.first() ??
            (ctx.author as User);
        const stats = client.data.getUserPlayStats(guildId, target.id);
        const playCount = stats?.playCount ?? 0;

        if (stats === null) {
            await ctx.reply({
                embeds: [
                    createEmbed("info", __("commands.music.profile.noData"))
                        .setTitle(`👤 ${__("commands.music.profile.title")}`)
                        .setThumbnail(target.displayAvatarURL({ extension: "png", size: 256 })),
                ],
            });
            return;
        }

        const nextTier = getNextTitleTier(playCount);
        const embed = createEmbed("info")
            .setTitle(`👤 ${__("commands.music.profile.title")}`)
            .setThumbnail(target.displayAvatarURL({ extension: "png", size: 256 }))
            .addFields(
                {
                    name: __("commands.music.profile.playCountLabel"),
                    value: `**${playCount}**`,
                    inline: true,
                },
                {
                    name: __("commands.music.profile.rankLabel"),
                    value: `**#${stats.rank}**`,
                    inline: true,
                },
                {
                    name: __("commands.music.profile.titleLabel"),
                    value: __(getTitlePhrase(playCount)),
                    inline: true,
                },
                {
                    name: __("commands.music.profile.nextTitle"),
                    value:
                        nextTier !== null
                            ? __mf("commands.music.profile.nextTierProgress", {
                                  title: __(`commands.music.titles.${nextTier.key}`),
                                  current: playCount,
                                  needed: nextTier.minPlays,
                              })
                            : __("commands.music.profile.maxTierReached"),
                },
            );
        await ctx.reply({ embeds: [embed] });
    }
}
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/music/LeaderboardCommand.ts src/commands/music/ProfileCommand.ts
git commit -m "feat: add leaderboard and profile commands with title tiers"
```

---

### Task 10: Play-count hook in `handleVideos`

**Files:**
- Modify: `src/utils/handlers/general/handleVideos.ts:337-345` (existing-queue branch) and `:363-365` (new-queue branch)

**Interfaces:**
- Consumes: `incrementUserPlays` (Task 3)
- Produces: side effect — +`toQueue.length` points for `ctx.author.id` in `ctx.guild.id` on every user-initiated enqueue

- [ ] **Step 1: Increment in the existing-queue branch**

Replace:

```ts
    if (ctx.guild?.queue) {
        await sendConfirmation();

        if (wasIdle === true) {
            void play(ctx.guild, undefined, wasIdle);
        }

        return;
    }
```

with:

```ts
    if (ctx.guild?.queue) {
        await sendConfirmation();

        if (ctx.guild) {
            void client.data.incrementUserPlays(ctx.guild.id, ctx.author.id, toQueue.length);
        }

        if (wasIdle === true) {
            void play(ctx.guild, undefined, wasIdle);
        }

        return;
    }
```

- [ ] **Step 2: Increment in the new-queue branch**

Replace:

```ts
    const serverQueue = new ServerQueue(queueTextChannel);
    (ctx.guild as NonNullable<typeof ctx.guild>).queue = serverQueue;
    await sendConfirmation();
```

with:

```ts
    const serverQueue = new ServerQueue(queueTextChannel);
    (ctx.guild as NonNullable<typeof ctx.guild>).queue = serverQueue;
    await sendConfirmation();

    if (ctx.guild) {
        void client.data.incrementUserPlays(ctx.guild.id, ctx.author.id, toQueue.length);
    }
```

- [ ] **Step 3: Verify**

Run: `pnpm lint && pnpm build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/handlers/general/handleVideos.ts
git commit -m "feat: count requested songs toward per-guild play stats"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + build**

Run: `pnpm lint && pnpm build`
Expected: both pass with zero errors.

- [ ] **Step 2: Confirm no stray i18n references**

Run: `grep -rn "notFound2\|deleted2\|new_name" src/`
Expected: no matches.

- [ ] **Step 3: Manual smoke checklist (spec section "Verification")**

Requires a running bot with Discord credentials. Check each item, noting pass/fail:
1. `nada help` (prefix command with fresh env, no `MAIN_PREFIX`) responds.
2. `pl create test` → success; `pl create test` again → "already exists"; 26th playlist → limit message; `pl create Favorites` → reserved.
3. `pl add test <song query>` → added; repeat → "already at position N".
4. `pl info test` paginates; `pl remove test 1` works; `pl rename test test2` works.
5. `pl play test2` joins VC and enqueues; each song adds 1 point.
6. `fav` while a song plays → added; `fav` again → removed; `fav list`, `fav play`, `fav remove 1`.
7. `pl import test2 <YouTube playlist URL>` and a Spotify playlist URL → import summary with duplicate/truncation info.
8. `pl save newsnapshot` on an active queue → saved; on empty queue → "queue is empty".
9. `/playlist add` without name → select menu appears; choosing a playlist adds the song.
10. Restart the bot → playlists/favorites/stats survive (WAL + SQLite), and the restored queue adds **no** points.
11. `lb` shows ranking with titles; `profile` (and `profile <user>`) shows count/rank/title/progress.
12. `db-export` (dev command) shows `user_playlists` and `guild_user_stats` rows.

- [ ] **Step 4: Final commit if anything was fixed**

```bash
git add -A
git commit -m "fix: address smoke test findings"
```

---

## Self-Review Notes (already applied while writing)

- Spec coverage: playlists (Tasks 2, 4, 7), favorites (Tasks 4, 8), import (Task 7 `import`), save-queue (Task 7 `save`), select-menu picker (Task 7), limits/duplicates (Tasks 4, 7), stats/leaderboard/titles (Tasks 3, 5, 9, 10), prefix (Task 1), i18n (Task 6), verification (Task 11). No spec requirement lacks a task.
- Type consistency: `Playlist`/`PlaylistMeta`/`SavedPlaylistSong` defined in Task 2 and used identically in Tasks 4/7/8; `getTitlePhrase`/`getNextTitleTier` defined in Task 5 and used in Task 9; storage method names in Tasks 2/3 match the `ExtendedDataManager` members and every call site.
- All i18n keys referenced in code exist in the Task 6 key blocks; named placeholders always flow through `__mf` with real values (`{prefix}` via `getEffectivePrefix`).
- Manual smoke checklist requires Discord credentials; if unavailable, report Task 11 Step 3 as not executed rather than passing it silently.

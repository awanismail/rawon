# Design: User Playlists & Favorite Songs

- **Date**: 2026-09-23
- **Status**: Approved (brainstorming session)
- **Project**: nada-bot (Discord music bot, Sapphire framework + better-sqlite3)

## Context

nada-bot persists guild settings and per-guild queue state in SQLite (`SQLiteDataManager`), but users have no way to save music across sessions. This design adds per-user playlists and a favorites list.

The user originally referenced `D:\PROJECTs\Typescript\musicify` as containing this feature. Investigation found no committed playlist/favorites code there — only `DROP TABLE playlists / playlist_tracks` remnants of a removed local prototype. The feature is therefore designed fresh for nada-bot; musicify contributed supporting ideas only (URL-keyed duplicate reporting, import UX).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Reference feature in musicify | Does not exist in committed code; design fresh |
| Data scope | Global per Discord user (usable in any guild the bot is in) |
| Favorites model | A special, built-in playlist row (`is_special`), not a separate table/concept |
| Command shape | Two commands: `playlist` (subcommands) + `favorite` |
| Storage model | Single table + `songs_json` blob (mirrors existing `queue_states` pattern); rejected normalized `playlists`/`playlist_tracks` and legacy JSON files |
| v1 extras | Save-current-queue-as-playlist, favorite currently-playing song, select-menu playlist picker, import external playlist URLs |

## Data Model

New types in `src/typings/index.d.ts`:

```ts
export type SavedPlaylistSong = Song & { addedAt: number };

export type Playlist = {
    playlistId: string;      // SnowflakeUtil.generate(); favorites row = `${userId}-favorites`
    userId: string;          // Discord user id
    name: string;            // unique per user (case-insensitive); favorites row = "Favorites"
    isSpecial: boolean;      // true only for Favorites — cannot delete/rename
    createdAt: number;
    updatedAt: number;
    songs: SavedPlaylistSong[];
};
```

The full `Song` snapshot is stored. `url` (canonical source URL) is the source of truth; `playableUrl` from a previous session is never trusted at playback time — songs are re-resolved through the existing search/resolve pipeline (same approach the bot already uses when restoring a saved queue), so stream URLs are always fresh. Remaining fields (title, author, duration, thumbnail) serve as display data.

## Storage Layer

Schema added in `SQLiteDataManager.initSchema()`:

```sql
CREATE TABLE IF NOT EXISTS user_playlists (
    user_id     TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    name        TEXT NOT NULL,
    is_special  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    track_count INTEGER NOT NULL DEFAULT 0,
    songs_json  TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (playlist_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_playlists_un
    ON user_playlists(user_id, name COLLATE NOCASE);
```

- `track_count` is maintained on save so `playlist list` never parses `songs_json` blobs.
- Migration-safe: `CREATE TABLE IF NOT EXISTS` + one new index; no existing table is touched.

New methods on `SQLiteDataManager` (all writes queued through `OperationManager`, matching existing conventions). Also added to the `ExtendedDataManager` interface in `src/typings/index.d.ts`:

- `getUserPlaylistMetas(userId)` — summary list without `songs_json`
- `getUserPlaylistByName(userId, name)` → `Playlist | undefined` (NOCASE match)
- `createUserPlaylist(userId, name, isSpecial?)` → empty `Playlist`
- `saveUserPlaylist(playlist)` — full `INSERT OR REPLACE` (mutate in memory, then save; same pattern as guild data)
- `renameUserPlaylist(userId, oldName, newName)`
- `deleteUserPlaylist(userId, name)` — refuses rows with `is_special`

The favorites row is created lazily via an `ensureFavorites(userId)` helper the first time a user favorites anything.

Shared logic (name validation, duplicate checks, limit enforcement, `ensureFavorites`) lives in a single helper module `src/utils/functions/playlist.ts` so both commands stay thin.

## Commands

### `PlaylistCommand` — `src/commands/music/PlaylistCommand.ts`

Name `playlist`, aliases `pl`. Slash: subcommands. Prefix: first token is the subcommand (`!pl create nama`, `!pl add nama <query>`).

| Subcommand | Behavior |
|---|---|
| `create <name>` | Create empty playlist. Name: 1–50 chars, unique per user (case-insensitive), max 25 playlists per user |
| `delete <name>` | Delete playlist. Button confirmation when it has ≥ 1 track. The favorites row cannot be deleted |
| `rename <from> <to>` | Rename; favorites row cannot be renamed |
| `list` | Embed of playlists with track counts and creation dates |
| `info <name>` | Track list via `ButtonPagination` (10 per page, like `QueueCommand`) |
| `add [name] <query\|URL>` | Resolve one song via existing `searchTrack` and append. Empty name → `StringSelectMenu` of the user's playlists to pick a destination. Duplicate URL rejected with the existing position. A collection/playlist URL is rejected here with a hint to use `import` |
| `remove <name> <index>` | Remove track at index (as shown by `info`) |
| `play [name]` | Enqueue all tracks (guards `@inVC @validVC @sameVC @useRequestChannel`; enqueue via the existing `handleVideos` path). Empty name → select menu |
| `save <name>` | Snapshot the currently playing queue into a **new** playlist — the name must not already exist (no silent overwrite or append) |
| `import <name> <url>` | Import a YouTube/Spotify playlist into a user playlist via the existing resolvers (`spotifyResolve` / playlist ingestion), reusing `playlistQueueProgress` for progress. Duplicate URLs skipped; result truncated at the 200-track cap with a report |

The `name` slash option uses **autocomplete** listing the invoking user's playlist names if `CommandContext` supports it; fallback is a select menu. (Verify during implementation.)

### `FavoriteCommand` — `src/commands/music/FavoriteCommand.ts`

Name `favorite`, aliases `fav`, `like`.

- Bare run (`/fav`, `!fav`) — **toggle** the song currently playing in that guild: adds to Favorites if new, removes if already there; reply embed states the resulting status
- `fav list` — paginated favorites
- `fav play` — enqueue all favorites (same guards as `playlist play`)
- `fav remove <index>` — remove from favorites

All replies use `createEmbed("info"|"warn"|"error")`; select-menu interactions are locked to `ctx.author.id`, matching existing `ButtonPagination` behavior.

## Limits & Validation

Constants defined once and enforced in the shared helper:

- Max **25 playlists** per user (excluding Favorites) — matches Discord's 25-option select-menu cap
- Max **200 tracks** per playlist (import truncates and reports)
- Name **1–50 chars**, unique per user case-insensitive; the name `Favorites` is reserved (`create` with it is rejected)
- Duplicate tracks (same `url`) are **rejected** on every add path (`add`, `import`, `save`, favorites) with a message reporting the existing position — playlists are treated as sets, consistent with favorites
- Only the owner can modify their playlists; commands always operate on `ctx.author.id`. Sharing/collaboration is out of scope for v1

## Error Handling

Every failure mode replies with a one-sentence i18n embed (`warn`/`error`): name not found, playlist name already taken, playlist limit reached, track limit reached, empty playlist on `play`, empty queue on `save`, nothing playing on `fav`, invalid import URL, reserved name. No exceptions leak to users. SQLite write failures continue to flow through `OperationManager` as today.

## i18n

New keys under `commands.music.playlist.*` and `commands.music.favorite.*`:

- `lang/en-US.json` — authoritative, complete
- `lang/id-ID.json` — properly translated
- The other 12 locale files — filled with en-US text so every locale file stays structurally complete; translations can improve incrementally

## Verification

The project has no test framework; its convention is `pnpm lint` (Biome) + `pnpm build` (SWC).

1. Both must pass.
2. Manual smoke checklist:
   - `pl create` → `pl add` → `pl info` → `pl play`, then **restart the bot and confirm data survives**
   - `fav` toggle on → off; `fav list`; `fav play`
   - `pl import` with a YouTube playlist URL and a Spotify playlist URL; duplicate skipping and 200-cap truncation messages
   - `pl save` on an active queue; reject on an empty queue; reject an existing name
   - Limits: 26th playlist rejected; 201st track rejected; `Favorites` name reserved
   - Duplicate `pl add` reports the existing position
   - `db-export` (dev command) to inspect `user_playlists` contents
3. Cross-restart persistence relies on the existing WAL + `OperationManager` flush behavior.

## Out of Scope (v1)

- Playlist sharing between users / collaborative playlists
- Reordering tracks inside a playlist
- Public playlist links or export files
- Per-guild playlists
- Scheduled/automatic playlist backup beyond the existing DB export tooling

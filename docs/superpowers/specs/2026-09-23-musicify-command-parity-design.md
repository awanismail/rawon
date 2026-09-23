# Design: Musicify Command Parity — move, clear, 247 & Alias Cleanup

- **Date**: 2026-09-23
- **Status**: Approved (brainstorming session)
- **Project**: nada-bot (Discord music bot, Sapphire framework + better-sqlite3)

## Context

An audit compared every command in `D:\PROJECTs\Typescript\musicify` (21 commands) against nada-bot. 16 of 21 already have direct equivalents (`play`, `queue`, `skip`, `loop`→`repeat`, `shuffle`, `remove`, `skipto`, `seek`, `volume`, `chatplay`→`requestchannel`, `filter`, `stop`, `nowplaying`, `help`, `about`, `language`). This spec covers the remainder that is worth porting, plus one duplicate found during the audit.

Out of scope by decision: musicify's `status` (a Lavalink node health page — nada-bot does not use Lavalink, and `ping`/`about` already cover the need) and `bot-stats` (bot statistics page; `about` covers most of it and it can be ported later once the `stats` name is freed).

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Which gaps to port | `move`, `clear`, `247` (status/bot-stats skipped — different architecture, covered by ping/about) |
| Who may toggle `247` | Follow the existing DJ system: DJ mode off → everyone; DJ mode on → DJ role or ManageGuild only |
| 247 state storage | Approach A: `ServerQueue.alwaysOn` + `player_states.always_on` column, exactly mirroring the `autoplay` toggle precedent |
| Alias duplicate | Remove `stats` alias from `profile` (it collides with `about`'s existing `stats` alias) |

## Duplicate Fix

`profile` currently declares aliases `["stats"]`, but `about` (upstream, pre-existing) also declares `stats`. Sapphire's alias resolution on collision is not guaranteed, so the alias is removed from `profile` (the command keeps working as `profile`). This also frees the `stats` name for a future musicify-style bot-statistics port.

New command names and aliases were checked against every existing command: `move [mv]`, `clear [cl]`, `247 [alwayson, stay]` — no collisions.

## Command: `247`

`src/commands/music/247Command.ts`, name `247`, aliases `alwayson`, `stay`. Slash: string option `state` with choices ENABLE/DISABLE (optional). Prefix: `!247 [enable|disable]`. Mirrors `AutoPlayCommand` exactly:

- No argument → info embed with the current state
- `enable`/`disable` → set `queue.alwaysOn`, call `queue.saveState()`, success embed
- Invalid value → invalid-usage embed (same pattern as autoplay)
- Guards: `@useRequestChannel @inVC @haveQueue @sameVC`
- Permission: new helper `hasDJOrManagePermission(client, guild, member)` in `src/utils/functions/musicControlPermissions.ts` — returns `true` when DJ mode is disabled for the guild, otherwise `true` only for members with ManageGuild or the configured DJ role (reuses `client.utils.fetchDJRole`). The command replies with a warn embed when denied.

Effect while enabled: at every auto-leave checkpoint the bot pauses and stays in the voice channel instead of disconnecting after the 60s timeout.

## Command: `move`

`src/commands/music/MoveCommand.ts`, name `move`, alias `mv`. Slash: two required integer options `from`, `to`. Prefix: `!move <from> <to>`. Guards: `@haveQueue` (+ `@useRequestChannel`).

- Positions use the **same numbering as the `queue` display and `remove`** (position 1 = the currently playing song, verified against `RemoveCommand`'s `index >= np.index` filter). Since the playing song cannot be moved, both `from` and `to` must be within `2..displayedCount`; position 1 in either argument → warn embed explaining it is the playing song
- Validation: `from` and `to` are distinct integers within the valid range; violation → warn embed stating the valid range
- Behavior: take `queue.songs.sortByIndex()` entries (displayed set: `index >= np.index`), splice the entry out at `from`, insert at `to`, rewrite the `index` property of each entry consecutively starting from `np.index` (the collection is always consumed via `sortByIndex()`), then persist via `queue.saveQueueState()` (each `songs.set()` already triggers it)
- Reply: success embed with the moved song's linked title and `from → to`

## Command: `clear`

`src/commands/music/ClearCommand.ts`, name `clear`, alias `cl`. No arguments. Guards: `@haveQueue` (+ `@useRequestChannel`).

- Deletes every queued song **after** the currently playing one (keys with `index > np.index`); the current song keeps playing and the voice connection stays
- No upcoming songs → warn embed "queue is already empty"
- Reply: success embed with the number of removed tracks

## Storage & Internal Changes

- `SQLiteDataManager.initSchema()`: after the existing `player_states` migrations, check `PRAGMA table_info(player_states)` and `ALTER TABLE player_states ADD COLUMN always_on INTEGER DEFAULT 0;` when missing (same pattern as the `autoplay` column migration)
- `GuildData["playerState"]` type gains `alwaysOn: boolean`; `savePlayerState`/`getPlayerState` map the new column (`1`/`0` ⇄ `true`/`false`)
- `ServerQueue`: new `public alwaysOn = false` field; included in `saveState()`'s playerState object and in the restore path (where `this.autoPlay = savedState.autoplay ?? false` is set)
- Auto-leave checkpoints — `VoiceStateUpdateListener` (requester-deaf timeout, empty-voice-channel, paused-empty paths) and `handlers/general/play.ts` (queue-ended path): change `client.data.botSettings.alwaysOn` to `client.data.botSettings.alwaysOn || guild.queue?.alwaysOn === true`. The bot-wide setting keeps working as a global fallback; the per-guild toggle ORs on top

## i18n

New keys: `commands.music.247.*` (description, usage, slashStateDescription, actualState, enabledMsg, disabledMsg), `commands.music.move.*` (description, usage, slashFromDescription, slashToDescription, invalidPosition, samePosition, playingSongPosition, success), `commands.music.clear.*` (description, usage, alreadyEmpty, removedSingular, removedPlural). en-US authoritative, id-ID translated, the other 12 locales receive en-US copies via the same merge script pattern used for the playlist feature. `reusable.enabled`/`reusable.disabled` are reused for state display.

## Verification

No test framework; convention is lint + build (+ `tsc --noEmit` kept clean by this fork):

1. `pnpm lint`, `pnpm build`, `tsc --noEmit` all pass
2. Runtime harness: `savePlayerState`/`getPlayerState` round-trip `alwaysOn`; schema migration adds the column idempotently; grep confirms `stats` resolves to exactly one command and no new name/alias collides with any existing one
3. Manual smoke (needs a live bot): `247` status/enable/disable while playing, leave VC alone → bot pauses and stays; restart with 247 on → still on; `move` reorders the upcoming queue as displayed by `queue`; `clear` empties upcoming while the current song continues; `profile` still works without the `stats` alias

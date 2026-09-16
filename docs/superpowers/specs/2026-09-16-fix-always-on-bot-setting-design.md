# Design Document: Fix always_on Bot Setting Validation and Consistency

## 1. Context and Problem Statement
When running `/setup alwayson` or invoking the `setupAlwaysOn` method, the bot crashes or reports a listener error:
```
Error: Invalid setting key: always_on
    at SQLiteDataManager.setBotSetting (file:///app/dist/utils/structures/SQLiteDataManager.js:522:19)
    at SetupCommand.setupAlwaysOn (file:///app/dist/commands/developers/SetupCommand.js?d=1789545502363&name=SetupCommand&extension=.js:422:27)
```

### Root Cause
In `src/utils/structures/SQLiteDataManager.ts`, `setBotSetting(key: string, value: string | number | null)` performs runtime column validation against a static whitelist `validColumns`:
```typescript
const validColumns = new Set([
    "embed_color",
    "yes_emoji",
    "no_emoji",
    "alt_prefix",
    "request_channel_splash",
    "default_volume",
    "music_selection_type",
    "enable_audio_cache",
]);
```
While `always_on` exists in the database table schema (`bot_settings` table, `row.always_on`, and `alwaysOn` boolean in `BotSettings`), it was never added to `validColumns`. When `setBotSetting("always_on", ...)` is called, it throws `Error: Invalid setting key: always_on`.

Additionally:
1. In `SetupCommand.ts`, `resetAll()` iterates through setting keys to reset them to `null` on `/setup reset`, but `"always_on"` is missing from the list.
2. In `SetupCommand.ts`, `showSettings()` (which renders the `/setup` overview embed) does not display the current `alwaysOn` configuration alongside the other bot settings.

---

## 2. Goals and Non-Goals

### Goals
- **Permit `always_on` Setting Updates:** Allow `setBotSetting` to accept `"always_on"` without throwing an error.
- **Support Full Reset:** Include `"always_on"` in `SetupCommand.resetAll()` so that `/setup reset` properly resets the 24/7 setting to default (`false`).
- **Display Status in Overview:** Display the current status of `alwaysOn` in the `/setup` overview embed in `SetupCommand.showSettings()`.
- **Regression Testing:** Add unit tests to ensure `setBotSetting` succeeds for all configured bot setting keys and rejects invalid keys.

### Non-Goals
- Changing the underlying 24/7 behavior in voice channels (`VoiceStateUpdateListener.ts` and `play.ts` already handle `botSettings.alwaysOn`).
- Modifying the database schema (the `always_on` column already exists in `bot_settings`).

---

## 3. Component Design & Changes

### 3.1 `SQLiteDataManager` (`src/utils/structures/SQLiteDataManager.ts`)
- Update `validColumns` in `setBotSetting`:
```typescript
const validColumns = new Set([
    "embed_color",
    "yes_emoji",
    "no_emoji",
    "alt_prefix",
    "request_channel_splash",
    "default_volume",
    "music_selection_type",
    "enable_audio_cache",
    "always_on",
]);
```

### 3.2 `SetupCommand` (`src/commands/developers/SetupCommand.ts`)
1. **Include `always_on` in `resetAll()`:**
```typescript
const keys = [
    "embed_color",
    "yes_emoji",
    "no_emoji",
    "alt_prefix",
    "request_channel_splash",
    "default_volume",
    "music_selection_type",
    "enable_audio_cache",
    "always_on",
];
```
2. **Display `alwaysOn` in `showSettings()`:**
```typescript
{
    name: "📻 Always On (24/7)",
    value: isDefault(bs.alwaysOn, BOT_SETTINGS_DEFAULTS.alwaysOn)
        ? "`Default`"
        : bs.alwaysOn
          ? "`Enabled`"
          : "`Disabled`",
    inline: true,
},
```

### 3.3 Unit Tests (`tests/utils/botSettings.test.mjs`)
Create a unit test suite using Node's test runner and temporary in-memory/tempfile SQLite database:
- Verifies that all expected setting keys (including `always_on`) are accepted by `setBotSetting`.
- Verifies that invalid keys throw `Error: Invalid setting key: ...`.
- Verifies that setting `always_on` to `1` updates `botSettings.alwaysOn` to `true`, and setting `0` or `null` updates to `false`.

---

## 4. Verification Plan

### Automated Tests
- Run `node --test tests/utils/botSettings.test.mjs`
- Run existing tests: `node --test tests/utils/parseEnvValue.test.mjs`
- Run TypeScript build check: `pnpm build`

### Manual Verification
- Verify that `SetupCommand.showSettings` and `SetupCommand.resetAll` reference `"always_on"` correctly.

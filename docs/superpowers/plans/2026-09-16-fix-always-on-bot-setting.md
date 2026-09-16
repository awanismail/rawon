# Fix always_on Bot Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `Invalid setting key: always_on` error in `SQLiteDataManager.setBotSetting` and ensure full consistency across `SetupCommand` and unit tests.

**Architecture:** Add `"always_on"` to the `validColumns` whitelist set in `SQLiteDataManager.setBotSetting`, register `"always_on"` in `SetupCommand.resetAll()`, and add the `alwaysOn` status display to `SetupCommand.showSettings()`. Validate behavior using Node.js test runner against an isolated SQLite database.

**Tech Stack:** TypeScript, Node.js (v24), better-sqlite3, discord.js v14, @sapphire/framework.

## Global Constraints
- Only use the `latest` tag (`wanztudio/nada-bot:latest`) if building Docker images.
- Keep credentials out of git.
- Ensure all existing tests pass without regressions.

---

### Task 1: Write Unit Test for `SQLiteDataManager.setBotSetting` (TDD Failing Test)

**Files:**
- Create: `tests/utils/botSettings.test.mjs`

**Interfaces:**
- Consumes: `SQLiteDataManager` from `src/utils/structures/SQLiteDataManager.ts`
- Produces: Test suite validating `setBotSetting` for all valid setting keys and verifying invalid keys throw.

- [ ] **Step 1: Write the test file**

```javascript
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SQLiteDataManager } from "../../src/utils/structures/SQLiteDataManager.ts";

test("setBotSetting updates always_on and reflects in botSettings", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rawon-test-"));
    const dbPath = path.join(tempDir, "test.db");

    try {
        const manager = new SQLiteDataManager(dbPath);
        assert.equal(manager.botSettings.alwaysOn, false);

        await manager.setBotSetting("always_on", 1);
        assert.equal(manager.botSettings.alwaysOn, true);

        await manager.setBotSetting("always_on", 0);
        assert.equal(manager.botSettings.alwaysOn, false);

        await manager.setBotSetting("always_on", null);
        assert.equal(manager.botSettings.alwaysOn, false);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("setBotSetting rejects invalid keys", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rawon-test-"));
    const dbPath = path.join(tempDir, "test.db");

    try {
        const manager = new SQLiteDataManager(dbPath);
        await assert.rejects(
            async () => manager.setBotSetting("non_existent_key", "value"),
            { message: "Invalid setting key: non_existent_key" },
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run test to verify it fails on always_on**

Run: `node --test tests/utils/botSettings.test.mjs`
Expected: FAIL with `Invalid setting key: always_on`

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/utils/botSettings.test.mjs
git commit -m "test: add test suite for SQLiteDataManager setBotSetting"
```

---

### Task 2: Fix `SQLiteDataManager.setBotSetting` Whitelist

**Files:**
- Modify: `src/utils/structures/SQLiteDataManager.ts:797-812`
- Test: `tests/utils/botSettings.test.mjs`

**Interfaces:**
- Consumes: `"always_on"` string key in `setBotSetting`
- Produces: Successful update of the `always_on` column in `bot_settings` table and updated in-memory `botSettings.alwaysOn`.

- [ ] **Step 1: Update `validColumns` in `SQLiteDataManager.ts`**

In `src/utils/structures/SQLiteDataManager.ts`, add `"always_on"` to `validColumns`:

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

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/utils/botSettings.test.mjs`
Expected: PASS (all 2 tests pass)

- [ ] **Step 3: Commit the fix**

```bash
git add src/utils/structures/SQLiteDataManager.ts
git commit -m "fix(data): include always_on in validColumns whitelist"
```

---

### Task 3: Update `SetupCommand.ts` for Consistency

**Files:**
- Modify: `src/commands/developers/SetupCommand.ts`

**Interfaces:**
- Consumes: `botSettings.alwaysOn` from `SQLiteDataManager`
- Produces: Complete reset of all 9 settings in `resetAll()` and display of `alwaysOn` status in `showSettings()`.

- [ ] **Step 1: Add `alwaysOn` status field to `showSettings`**

In `src/commands/developers/SetupCommand.ts`, in `showSettings()`, add the field:

```typescript
                {
                    name: "💾 Audio Cache",
                    value: isDefault(bs.enableAudioCache, BOT_SETTINGS_DEFAULTS.enableAudioCache)
                        ? "`Default`"
                        : bs.enableAudioCache
                          ? "`Enabled`"
                          : "`Disabled`",
                    inline: true,
                },
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

- [ ] **Step 2: Add `"always_on"` to `resetAll` keys list**

In `src/commands/developers/SetupCommand.ts`, in `resetAll()`, add `"always_on"` to `keys`:

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

- [ ] **Step 3: Run project build check**

Run: `pnpm build`
Expected: Successful compilation without errors.

- [ ] **Step 4: Commit changes**

```bash
git add src/commands/developers/SetupCommand.ts
git commit -m "fix(commands): include always_on in setup overview and resetAll"
```

---

### Task 4: Full Verification and Regression Check

**Files:**
- None (verification only)

- [ ] **Step 1: Run all test suites**

Run:
```bash
node --test tests/utils/parseEnvValue.test.mjs
node --test tests/utils/botSettings.test.mjs
```
Expected: All tests pass.

- [ ] **Step 2: Run complete TypeScript build**

Run: `pnpm build`
Expected: Build succeeds with exit code 0.

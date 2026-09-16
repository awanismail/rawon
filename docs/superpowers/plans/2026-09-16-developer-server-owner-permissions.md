# Developer and Server Owner Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow server owners and bot developers to configure the bot via `/setup` while keeping dangerous system commands developer-only, automatically recognizing bot owners/team members as developers at runtime, and fixing environment parser bugs.

**Architecture:** 
1. Fix `parseEnvValue` with robust multi-format string tokenization.
2. Auto-fetch Discord Application owner and Team members in `ReadyListener` on startup into `container.config.devs`.
3. Introduce `devOrGuildOwner` command option in typings, wrappers, and `InteractionCreateListener`.
4. Update command options across all developer commands and add localized permission messages.

**Tech Stack:** TypeScript, Discord.js v14, Sapphire Framework, Node.js (test runner)

## Global Constraints
- Target Node.js >= 20.0.0, Discord.js 14.26.4.
- Preserve existing comments and docstrings.
- Error replies for interaction validation failures must be ephemeral embeds using `createEmbed("error", ...)`.
- No placeholders (TODO/TBD). Complete code in every task.

---

### Task 1: Fix `parseEnvValue` Tokenization with TDD

**Files:**
- Create: `tests/utils/parseEnvValue.test.mjs`
- Modify: `src/utils/functions/parseEnvValue.ts`

**Interfaces:**
- Consumes: `str: string`
- Produces: `parseEnvValue(str: string): string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/utils/parseEnvValue.test.mjs`:
```javascript
import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvValue } from "../../dist/utils/functions/parseEnvValue.js";

test("parseEnvValue parses empty string to empty array", () => {
    assert.deepEqual(parseEnvValue(""), []);
    assert.deepEqual(parseEnvValue("   "), []);
});

test("parseEnvValue parses single unquoted or quoted ID", () => {
    assert.deepEqual(parseEnvValue("123456789"), ["123456789"]);
    assert.deepEqual(parseEnvValue('"123456789"'), ["123456789"]);
    assert.deepEqual(parseEnvValue("'123456789'"), ["123456789"]);
});

test("parseEnvValue parses comma-separated IDs without spaces", () => {
    assert.deepEqual(parseEnvValue("111111111,222222222"), ["111111111", "222222222"]);
});

test("parseEnvValue parses comma-separated IDs with spaces", () => {
    assert.deepEqual(parseEnvValue("111111111, 222222222, 333333333"), ["111111111", "222222222", "333333333"]);
});

test("parseEnvValue parses quoted comma-separated string", () => {
    assert.deepEqual(parseEnvValue('"111111111,222222222"'), ["111111111", "222222222"]);
    assert.deepEqual(parseEnvValue('"111111111, 222222222"'), ["111111111", "222222222"]);
});

test("parseEnvValue parses multiple quoted elements", () => {
    assert.deepEqual(parseEnvValue('"111111111", "222222222"'), ["111111111", "222222222"]);
    assert.deepEqual(parseEnvValue('"111111111","222222222"'), ["111111111", "222222222"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/utils/parseEnvValue.test.mjs`
Expected: FAIL (either module not built yet or `111111111,222222222` asserts fails with dropped elements).

- [ ] **Step 3: Implement robust `parseEnvValue`**

Edit `src/utils/functions/parseEnvValue.ts`:
```typescript
export function parseEnvValue(str: string): string[] {
    const trimmed = str.trim();
    if (!trimmed) {
        return [];
    }

    const unquoted =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1).trim()
            : trimmed;

    if (!unquoted) {
        return [];
    }

    const tokens = unquoted.match(/(?:["'][^"']*["']|[^,;\s"'])+/gu) ?? [];

    return tokens
        .map((token) => {
            const t = token.trim();
            if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
                return t.slice(1, -1).trim();
            }
            return t;
        })
        .filter((token) => token.length > 0);
}
```

- [ ] **Step 4: Build TypeScript and run tests**

Run: `npx tsc --build tsconfig.json; node --test tests/utils/parseEnvValue.test.mjs`
Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**

```bash
git add src/utils/functions/parseEnvValue.ts tests/utils/parseEnvValue.test.mjs
git commit -m "fix(config): improve parseEnvValue regex and delimiter tokenization"
```

---

### Task 2: Discord Application Owner & Team Auto-Detection

**Files:**
- Modify: `src/listeners/ReadyListener.ts:58-61`

**Interfaces:**
- Consumes: `client.application`
- Produces: Updated `this.container.config.devs` array with owner & team members

- [ ] **Step 1: Update ReadyListener to fetch application owner and team**

In `src/listeners/ReadyListener.ts`, replace lines 58-60:
```typescript
        try {
            const app = await client.application?.fetch();
            if (app) {
                const devSet = new Set(this.container.config.devs);
                if (app.owner) {
                    if ("members" in app.owner && app.owner.members) {
                        for (const member of app.owner.members.values()) {
                            devSet.add(member.id);
                        }
                    } else {
                        devSet.add(app.owner.id);
                    }
                }
                if (app.team?.members) {
                    for (const member of app.team.members.values()) {
                        devSet.add(member.id);
                    }
                }
                this.container.config.devs = Array.from(devSet);
                this.container.logger.debug(
                    `[Startup] Registered ${this.container.config.devs.length} developer ID(s)`,
                );
            }
        } catch (err) {
            this.container.logger.warn("[Startup] Failed to fetch application owner/team:", err);
        }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Exit code 0 with no diagnostic errors.

- [ ] **Step 3: Commit**

```bash
git add src/listeners/ReadyListener.ts
git commit -m "feat(listeners): auto-fetch application owner and team members into devs config"
```

---

### Task 3: Typings and Command Wrapper Updates for `devOrGuildOwner`

**Files:**
- Modify: `src/typings/index.d.ts:99,113,126`
- Modify: `src/structures/Rawon.ts:39,56,68`

**Interfaces:**
- Produces: `devOrGuildOwner?: boolean` on `CommandOptions`, `CommandMeta`, and `CompatibleCommand`

- [ ] **Step 1: Add `devOrGuildOwner` to type definitions**

In `src/typings/index.d.ts`:
1. Under `CommandComponent` metadata:
   ```typescript
   devOnly?: boolean;
   devOrGuildOwner?: boolean;
   ```
2. Under `declare module "@sapphire/framework" interface CommandOptions`:
   ```typescript
   devOnly?: boolean;
   devOrGuildOwner?: boolean;
   ```
3. Under `export type CommandMeta`:
   ```typescript
   devOnly?: boolean;
   devOrGuildOwner?: boolean;
   ```

- [ ] **Step 2: Update `wrapCommand` in `Rawon.ts`**

In `src/structures/Rawon.ts`:
1. In `CompatibleCommand`'s `meta`:
   ```typescript
   devOnly?: boolean;
   devOrGuildOwner?: boolean;
   ```
2. In `wrapCommand`:
   ```typescript
   const opts = cmd.options as Command.Options & {
       devOnly?: boolean;
       devOrGuildOwner?: boolean;
       cooldown?: number;
       contextChat?: string;
       contextUser?: string;
       disable?: boolean;
   };
   return Object.assign(cmd, {
       meta: {
           name: cmd.name,
           description: cmd.description,
           aliases: cmd.aliases as readonly string[],
           cooldown: opts.cooldown,
           devOnly: opts.devOnly,
           devOrGuildOwner: opts.devOrGuildOwner,
           contextChat: opts.contextChat,
           // ...
   ```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/typings/index.d.ts src/structures/Rawon.ts
git commit -m "feat(types): add devOrGuildOwner option to command options and metadata"
```

---

### Task 4: Localization Messages for `devOrGuildOwner`

**Files:**
- Modify: `lang/id-ID.json`
- Modify: `lang/en-US.json`
- Modify: other `lang/*.json` files (es-ES, fr-FR, ja-JP, ko-KR, ms-MY, pt-BR, ru-RU, tr-TR, uk-UA, vi-VN, zh-CN, zh-TW)

**Interfaces:**
- Key: `events.createInteraction.devOrGuildOwner`

- [ ] **Step 1: Add translation strings**

In `lang/id-ID.json`:
```json
"createInteraction": {
    "message1": "Sori, tapi interaction ini cuma buat <@{user}> sama staff server.",
    "devOnly": "Command buat developer aja.",
    "devOrGuildOwner": "Command ini cuma buat developer bot atau pemilik server.",
    ...
}
```

In `lang/en-US.json`:
```json
"createInteraction": {
    "message1": "Sorry, but this interaction can only be used by <@{user}> and server staff.",
    "devOnly": "Developer-only command.",
    "devOrGuildOwner": "This command is only available to bot developers or the server owner.",
    ...
}
```

And add fallback string in the remaining language files (using English fallback or localized translation).

- [ ] **Step 2: Commit**

```bash
git add lang/*.json
git commit -m "feat(i18n): add devOrGuildOwner interaction message"
```

---

### Task 5: Interaction Dispatcher Permission Checks

**Files:**
- Modify: `src/listeners/InteractionCreateListener.ts:287-307,342,377-396,490-510`
- Modify: `src/structures/Rawon.ts:160-205` (`CommandsCompatibility.handle`)
- Modify: `src/utils/structures/CommandManager.ts:272-275`

**Interfaces:**
- Evaluates:
  - `isDeveloper = this.container.config.devs.includes(interaction.user.id)`
  - `isGuildOwner = Boolean(interaction.guild && interaction.guild.ownerId === interaction.user.id)`

- [ ] **Step 1: Update `InteractionCreateListener.ts`**

In `InteractionCreateListener.ts`:
1. In `interaction.isCommand()` (slash commands):
```typescript
const isDeveloper = this.container.config.devs.includes(interaction.user.id);
const isGuildOwner = Boolean(
    interaction.guild && interaction.guild.ownerId === interaction.user.id,
);
const cmdOptions = getCommandOptions(cmd) as Command.Options & {
    devOrGuildOwner?: boolean;
    devOnly?: boolean;
};

if (cmdOptions.devOrGuildOwner === true && !isDeveloper && !isGuildOwner) {
    await this.safeReply(
        interaction,
        {
            flags: MessageFlags.Ephemeral,
            embeds: [
                createEmbed(
                    "error",
                    __mf("events.createInteraction.devOrGuildOwner"),
                    true,
                ),
            ],
        },
        "reply to dev-or-guild-owner slash usage",
    );
    this.container.logger.warn(
        `[MultiBot] ${client.user?.tag} ❌ BLOCKED non-dev/non-owner ${interaction.user.tag} [${interaction.user.id}] from using dev/owner slash ${interaction.commandName}`,
    );
    return;
}

if (cmdOptions.devOnly === true && !isDeveloper) {
    await this.safeReply(
        interaction,
        {
            flags: MessageFlags.Ephemeral,
            embeds: [
                createEmbed(
                    "error",
                    __mf("events.createInteraction.devOnly"),
                    true,
                ),
            ],
        },
        "reply to dev-only slash usage",
    );
    this.container.logger.warn(
        `[MultiBot] ${client.user?.tag} ❌ BLOCKED non-dev ${interaction.user.tag} [${interaction.user.id}] from using dev-only slash ${interaction.commandName}`,
    );
    return;
}
```

2. Also apply the `devOrGuildOwner` check in context menu and select menu handlers if applicable.

- [ ] **Step 2: Update prefix command handlers**

In `src/structures/Rawon.ts` (`CommandsCompatibility.handle`):
Check `command.meta.devOrGuildOwner` and `command.meta.devOnly`:
```typescript
const isDeveloper = this.client.config.devs.includes(message.author.id);
const isGuildOwner = Boolean(message.guild && message.guild.ownerId === message.author.id);

if (command.meta.devOrGuildOwner === true && !isDeveloper && !isGuildOwner) {
    return;
}
if (command.meta.devOnly === true && !isDeveloper) {
    return;
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/listeners/InteractionCreateListener.ts src/structures/Rawon.ts src/utils/structures/CommandManager.ts
git commit -m "feat(permissions): enforce devOrGuildOwner and devOnly in interaction and prefix dispatchers"
```

---

### Task 6: Standardize Developer & Configuration Command Options

**Files:**
- Modify: `src/commands/developers/SetupCommand.ts:19`
- Modify: `src/commands/developers/EvalCommand.ts:18`
- Modify: `src/commands/developers/LoginCommand.ts:21`
- Modify: `src/commands/developers/DatabaseExportCommand.ts:25`
- Modify: `src/commands/developers/DatabaseImportCommand.ts:24`

- [ ] **Step 1: Set `devOrGuildOwner: true` on `SetupCommand.ts`**

Change line 19 in `src/commands/developers/SetupCommand.ts`:
```typescript
-    devOnly: true,
+    devOrGuildOwner: true,
```

- [ ] **Step 2: Set `devOnly: true` on dangerous developer commands**

In `src/commands/developers/EvalCommand.ts`:
```typescript
    devOnly: true,
    preconditions: ["DevOnly"],
```

In `src/commands/developers/LoginCommand.ts`:
```typescript
    devOnly: true,
    preconditions: ["DevOnly"],
```

In `src/commands/developers/DatabaseExportCommand.ts`:
```typescript
    devOnly: true,
    preconditions: ["DevOnly"],
```

In `src/commands/developers/DatabaseImportCommand.ts`:
```typescript
    devOnly: true,
    preconditions: ["DevOnly"],
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/commands/developers/*.ts
git commit -m "feat(commands): configure devOrGuildOwner on setup and devOnly on system commands"
```

---

### Task 7: Full System Verification

**Files:**
- Run test suite and linter

- [ ] **Step 1: Run unit tests**

Run: `node --test tests/utils/parseEnvValue.test.mjs`
Expected: PASS (all test cases succeed).

- [ ] **Step 2: Build project**

Run: `npm run tscompile`
Expected: Exit code 0.

- [ ] **Step 3: Run linter**

Run: `npx biome check .`
Expected: Clean linting check.

# Fix CommandContext Type Helpers and PlayCommand isMessage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `TypeError: ctx.isMessage is not a function` in `PlayCommand` and add missing context type helpers to `CommandContext`.

**Architecture:** Add `isMessage()`, `isMessageContext()`, and `isChatInputInteractionContext()` to `CommandContext` (`src/structures/CommandContext.ts`), and make `PlayCommand.ts` safely inspect `ctx.context instanceof Message`. Verify with unit tests and TypeScript compile checks.

**Tech Stack:** TypeScript, discord.js v14, @sapphire/framework, @stegripe/command-context.

## Global Constraints
- Do not break existing commands.
- Ensure all unit tests pass and `pnpm build` compiles cleanly.

---

### Task 1: Add Unit Tests for CommandContext Helper Methods (TDD Failing Test)

**Files:**
- Create: `tests/structures/commandContext.test.mjs`

**Interfaces:**
- Consumes: `CommandContext` from `dist/structures/CommandContext.js`
- Produces: Verified unit test suite testing `isMessage()`, `isMessageContext()`, and `isChatInputInteractionContext()`.

- [ ] **Step 1: Write test suite**

```javascript
import assert from "node:assert/strict";
import test from "node:test";
import { Message, CommandInteraction } from "discord.js";
import { CommandContext } from "../../dist/structures/CommandContext.js";

test("CommandContext correctly detects Message context", () => {
    const mockMessage = Object.create(Message.prototype);
    mockMessage.channel = null;
    mockMessage.guild = null;

    const ctx = new CommandContext(mockMessage);
    assert.equal(ctx.isMessage(), true);
    assert.equal(ctx.isMessageContext(), true);
    assert.equal(ctx.isCommandInteraction(), false);
    assert.equal(ctx.isChatInputInteractionContext(), false);
});

test("CommandContext correctly detects CommandInteraction context", () => {
    const mockInteraction = Object.create(CommandInteraction.prototype);
    mockInteraction.channel = null;
    mockInteraction.guild = null;
    mockInteraction.isChatInputCommand = () => true;

    const ctx = new CommandContext(mockInteraction);
    assert.equal(ctx.isMessage(), false);
    assert.equal(ctx.isMessageContext(), false);
    assert.equal(ctx.isCommandInteraction(), true);
    assert.equal(ctx.isChatInputInteractionContext(), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/structures/commandContext.test.mjs`
Expected: FAIL (`ctx.isMessage is not a function`)

- [ ] **Step 3: Commit failing test**

```bash
git add tests/structures/commandContext.test.mjs
git commit -m "test: add unit tests for CommandContext helper methods"
```

---

### Task 2: Implement Missing Helpers in `CommandContext.ts`

**Files:**
- Modify: `src/structures/CommandContext.ts:315-355`
- Test: `tests/structures/commandContext.test.mjs`

**Interfaces:**
- Produces: `isMessage(): this is this & { context: Message }`, `isMessageContext(): boolean`, and `isChatInputInteractionContext(): boolean` on `CommandContext`.

- [ ] **Step 1: Add helper methods to `CommandContext.ts`**

```typescript
    public isMessage(): this is this & { context: Message } {
        return this.context instanceof Message;
    }

    public isMessageContext(): boolean {
        return this.context instanceof Message;
    }

    public isChatInputInteractionContext(): boolean {
        return (
            this.context instanceof CommandInteraction &&
            typeof (this.context as any).isChatInputCommand === "function" &&
            (this.context as any).isChatInputCommand()
        );
    }
```

- [ ] **Step 2: Recompile and run tests**

Run:
```bash
npx pnpm exec swc src -d dist --strip-leading-paths
node --test tests/structures/commandContext.test.mjs
```
Expected: PASS (all tests pass)

- [ ] **Step 3: Commit changes**

```bash
git add src/structures/CommandContext.ts
git commit -m "feat(structures): add isMessage and interaction context helpers to CommandContext"
```

---

### Task 3: Fix `PlayCommand.ts` Attachment Detection

**Files:**
- Modify: `src/commands/music/PlayCommand.ts:92-94`

- [ ] **Step 1: Update `audioAttachment` check in `PlayCommand.ts`**

In `src/commands/music/PlayCommand.ts:92-94`, replace:
```typescript
        const audioAttachment = ctx.isMessage()
            ? ctx.context.attachments.find((a) => a.contentType?.startsWith("audio/"))
            : undefined;
```
with:
```typescript
        const audioAttachment = ctx.context instanceof Message
            ? ctx.context.attachments.find((a) => a.contentType?.startsWith("audio/"))
            : undefined;
```

- [ ] **Step 2: Run full build and tests**

Run:
```bash
npx pnpm run build
node --test tests/structures/commandContext.test.mjs
node --test tests/utils/botSettings.test.mjs
node --test tests/utils/parseEnvValue.test.mjs
```
Expected: All build steps and all tests pass with 0 errors.

- [ ] **Step 3: Commit changes**

```bash
git add src/commands/music/PlayCommand.ts
git commit -m "fix(commands): use safe instanceof check for audio attachments in PlayCommand"
```

---

### Task 4: Full Verification and Delivery

**Files:**
- None (verification & delivery)

- [ ] **Step 1: Push changes to GitHub (`origin main`)**
- [ ] **Step 2: Run `build-and-push.bat` to publish new image to Docker Hub (`wanztudio/nada-bot:latest`)**

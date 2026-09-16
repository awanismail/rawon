# Design Document: Fix CommandContext Type Helpers and PlayCommand isMessage TypeError

## 1. Context and Problem Statement
When running `/play query:...` via Discord slash command, the bot crashes with:
```
TypeError: ctx.isMessage is not a function
    at PlayCommand.contextRun (file:///app/dist/commands/music/PlayCommand.js?d=1789549984974&name=PlayCommand&extension=.js:48:37)
    at InteractionCreateListener.run (file:///app/dist/listeners/InteractionCreateListener.js?d=1789549984575&name=InteractionCreateListener&extension=.js:288:17)
```

### Root Cause
In `src/commands/music/PlayCommand.ts:92`:
```typescript
const audioAttachment = ctx.isMessage()
    ? ctx.context.attachments.find((a) => a.contentType?.startsWith("audio/"))
    : undefined;
```
1. `InteractionCreateListener.ts` constructs an instance of `CommandContext` (`src/structures/CommandContext.ts`).
2. `CommandContext` defines methods `isInteraction()`, `isCommandInteraction()`, `isCommand()`, `isContextMenu()`, `isMessageComponent()`, `isButton()`, `isStringSelectMenu()`, and `isModal()`, but does **not** define `isMessage()`.
3. In addition, `DatabaseExportCommand.ts` and `DatabaseImportCommand.ts` call `ctx.isChatInputInteractionContext()` and `ctx.isMessageContext()`, which are methods from `@stegripe/command-context` not present on the internal `CommandContext`.

---

## 2. Goals and Non-Goals

### Goals
- **Prevent `TypeError: ctx.isMessage is not a function` in `PlayCommand`:** Ensure attachment checking safely inspects `ctx.context instanceof Message`.
- **Implement Missing Context Helpers in `CommandContext`:** Add `isMessage()`, `isMessageContext()`, and `isChatInputInteractionContext()` to `src/structures/CommandContext.ts`.
- **Add Unit Tests:** Validate that `CommandContext` correctly identifies message vs interaction contexts without runtime type errors.

### Non-Goals
- Refactoring `PlayCommand` audio streaming logic or modifying voice handlers.
- Replacing `@stegripe/command-context` in commands that already use it.

---

## 3. Proposed Changes

### 3.1 `PlayCommand.ts` (`src/commands/music/PlayCommand.ts`)
Update line 92 to directly verify `ctx.context instanceof Message`:
```typescript
const audioAttachment = ctx.context instanceof Message
    ? ctx.context.attachments.find((a) => a.contentType?.startsWith("audio/"))
    : undefined;
```

### 3.2 `CommandContext.ts` (`src/structures/CommandContext.ts`)
Add missing helper methods to `CommandContext`:
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

### 3.3 Unit Tests (`tests/structures/commandContext.test.mjs`)
Add unit tests verifying:
1. When initialized with a mock `Message`, `isMessage()`, `isMessageContext()` return `true` and `isCommandInteraction()`, `isChatInputInteractionContext()` return `false`.
2. When initialized with a mock `CommandInteraction`, `isMessage()` and `isMessageContext()` return `false` and `isCommandInteraction()` / `isChatInputInteractionContext()` return `true`.

---

## 4. Verification Plan

### Automated Tests
- Run `node --test tests/structures/commandContext.test.mjs`
- Run `node --test tests/utils/botSettings.test.mjs`
- Run `node --test tests/utils/parseEnvValue.test.mjs`
- Run `npx pnpm run build`

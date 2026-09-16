# Design Document: Developer and Server Owner Permission System

## 1. Context and Problem Statement
When running commands intended for configuration (such as `/setup` and its subcommands), users receive the error:
`❌ | Command buat developer aja.` (`events.createInteraction.devOnly`).

Even when the user hosting or running the bot is the bot creator or the Discord server owner, this error occurs due to three underlying issues:
1. **Unfetched Bot Application Owner & Missing Team Support:** In `ReadyListener.ts`, `client.application.owner` is accessed without calling `await client.application.fetch()`. In discord.js v14, application owner data is `null` on Gateway login unless explicitly fetched. Additionally, when a bot is owned by a Discord Developer Team, `client.application.owner` is a `Team` object whose `id` is the Team ID (not a User ID), causing developer validation to fail for team members.
2. **Fragile Regex in `parseEnvValue`:** `parseEnvValue.ts` uses a regex lookbehind requiring whitespace or start-of-string before every matched element. In standard comma-separated env values (e.g. `DEVS=id1,id2` or `DEVS="id1,id2"`), IDs after the first comma or comma-separated quoted lists are dropped or corrupted.
3. **Inconsistent Developer Command Metadata:** While `SetupCommand.ts` uses `devOnly: true`, other developer commands (`EvalCommand`, `LoginCommand`, `DatabaseExportCommand`, `DatabaseImportCommand`) use `preconditions: ["DevOnly"]` and omit `devOnly: true`. `InteractionCreateListener.ts` only checks `getCommandOptions(cmd).devOnly === true` and bypasses Sapphire preconditions during interaction dispatch.

Furthermore, commands like `/setup` only configure guild-specific and bot presentation settings (e.g. embed colors, emojis, default volume), which server owners should naturally be permitted to configure without needing access to global host configuration or manual developer ID registration.

---

## 2. Goals and Non-Goals

### Goals
- **Server Owner Accessibility:** Allow Discord Server Owners (`guild.ownerId === interaction.user.id`) to execute bot configuration commands (`/setup`) in their guilds alongside bot developers.
- **Automatic Bot Developer Recognition:** Automatically detect and register bot owners and all Discord Developer Team members as developers at runtime by fetching the Discord application.
- **Robust Environment Parsing:** Fix `parseEnvValue` to correctly parse comma-separated IDs with or without spaces, and handle quoted or unquoted lists gracefully.
- **Safe Command Segregation:** Keep critical system commands (`/eval`, `/login`, `/db-export`, `/db-import`) strictly restricted to bot developers to prevent RCE or database exfiltration.
- **Consistent Command Configuration:** Standardize developer commands with proper metadata flags.
- **Localization:** Provide clear, localized error responses for both `devOnly` and `devOrGuildOwner` validation failures.

### Non-Goals
- Allowing server owners to execute system-critical commands like `/eval` or database export/import.
- Replacing Discord's native interaction permissions or role management systems.

---

## 3. Architecture and Component Design

### 3.1 Permission Model
Commands will support two explicit access restriction flags in `Command.Options`:
1. `devOnly?: boolean`
   - Allowed users: Bot Developers only (`container.config.devs.includes(userId)`).
   - Applied to: `EvalCommand`, `LoginCommand`, `DatabaseExportCommand`, `DatabaseImportCommand`.
   - Unauthorized response: `events.createInteraction.devOnly` ("Command buat developer aja.").
2. `devOrGuildOwner?: boolean`
   - Allowed users: Bot Developers OR Server Owners (`interaction.guild?.ownerId === interaction.user.id`).
   - Applied to: `SetupCommand`.
   - Unauthorized response: `events.createInteraction.devOrGuildOwner` ("Command ini cuma buat developer bot atau pemilik server.").

### 3.2 Component Details

#### A. Environment Value Parser (`src/utils/functions/parseEnvValue.ts`)
Refactor `parseEnvValue(str: string): string[]` to:
- Accept comma-separated, semicolon-separated, or whitespace-separated values.
- Strip wrapping quotes (`"` or `'`) around each item or the entire string.
- Trim whitespace and filter out empty items.
- Correctly parse:
  - `DEVS=123,456` -> `["123", "456"]`
  - `DEVS=123, 456` -> `["123", "456"]`
  - `DEVS="123,456"` -> `["123", "456"]`
  - `DEVS="123", "456"` -> `["123", "456"]`
  - `DEVS='123'` -> `["123"]`
  - `DEVS=""` -> `[]`

#### B. Application Owner & Team Auto-Detection (`src/listeners/ReadyListener.ts`)
In `ReadyListener#run`:
```typescript
try {
    const app = await client.application?.fetch();
    if (app) {
        const devSet = new Set(this.container.config.devs);
        if (app.owner) {
            if ("members" in app.owner && app.owner.members) {
                // app.owner is a Team
                for (const member of app.owner.members.values()) {
                    devSet.add(member.id);
                }
            } else {
                // app.owner is a User
                devSet.add(app.owner.id);
            }
        }
        if (app.team?.members) {
            for (const member of app.team.members.values()) {
                devSet.add(member.id);
            }
        }
        this.container.config.devs = Array.from(devSet);
        this.container.logger.debug(`[Startup] Registered ${this.container.config.devs.length} developer ID(s)`);
    }
} catch (error) {
    this.container.logger.warn("[Startup] Failed to fetch application owner/team:", error);
}
```

#### C. Type Declarations & Wrapper (`src/typings/index.d.ts`, `src/structures/Rawon.ts`)
1. Extend `CommandOptions` and `CommandMeta`:
   ```typescript
   declare module "@sapphire/framework" {
       interface CommandOptions {
           devOnly?: boolean;
           devOrGuildOwner?: boolean;
           // ...
       }
   }
   ```
2. Update `wrapCommand` in `Rawon.ts`:
   - Map `devOrGuildOwner: opts.devOrGuildOwner`.

#### D. Interaction Dispatcher (`src/listeners/InteractionCreateListener.ts`)
Update slash command validation before execution:
```typescript
const isDeveloper = this.container.config.devs.includes(interaction.user.id);
const isGuildOwner = Boolean(interaction.guild && interaction.guild.ownerId === interaction.user.id);
const cmdOptions = getCommandOptions(cmd);

if (cmdOptions.devOrGuildOwner === true && !isDeveloper && !isGuildOwner) {
    await this.safeReply(
        interaction,
        {
            flags: MessageFlags.Ephemeral,
            embeds: [createEmbed("error", __mf("events.createInteraction.devOrGuildOwner"), true)],
        },
        "reply to dev-or-guild-owner slash usage",
    );
    return;
}

if (cmdOptions.devOnly === true && !isDeveloper) {
    await this.safeReply(
        interaction,
        {
            flags: MessageFlags.Ephemeral,
            embeds: [createEmbed("error", __mf("events.createInteraction.devOnly"), true)],
        },
        "reply to dev-only slash usage",
    );
    return;
}
```
Apply corresponding checks for context menus and select menus if applicable.

#### E. Command Definitions
1. `src/commands/developers/SetupCommand.ts`:
   - Set `devOrGuildOwner: true` (remove `devOnly: true`).
2. `src/commands/developers/{EvalCommand, LoginCommand, DatabaseExportCommand, DatabaseImportCommand}.ts`:
   - Ensure `devOnly: true` is explicitly present in `@ApplyOptions<Command.Options>`.

#### F. Localization
Add `devOrGuildOwner` key under `events.createInteraction` across all supported languages (e.g. `lang/id-ID.json`, `lang/en-US.json`, etc.):
- `id-ID`: `"Command ini cuma buat developer bot atau pemilik server."`
- `en-US`: `"This command is only available to bot developers or the server owner."`

---

## 4. Edge Cases & Error Handling
- **Direct Messages (DMs):** In DMs, `interaction.guild` is `null`, making `isGuildOwner` false. Only bot developers can execute `devOrGuildOwner` commands in DMs.
- **Discord API Failure on Startup:** If fetching the application fails due to network outage or API error, the error is caught and logged. The bot continues running using the `DEVS` list from environment variables.
- **Duplicate IDs:** Storing developers in a `Set` ensures duplicate IDs are not appended when multiple bot instances start or application fetch runs.

---

## 5. Verification Plan
1. **Unit Tests:** Run unit tests verifying `parseEnvValue` with single, unquoted comma-separated, quoted comma-separated, and spaced values.
2. **Build and Lint:** Run `pnpm build` / `npm run tscompile` and `pnpm lint` to verify type safety and code style conformance.
3. **Behavioral Checks:**
   - Server owner can execute `/setup view` and subcommands without error.
   - Non-server owner / non-developer receives the localized permission error.
   - Developer commands (`/eval`, etc.) remain strictly blocked for non-developers.

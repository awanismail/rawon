# Design: Per-Bot Presence in Multi-Bot Mode

- **Date**: 2026-09-23
- **Status**: Approved (brainstorming session)
- **Project**: nada-bot (Discord music bot, Sapphire framework)

## Context

In multi-bot mode (comma-separated `DISCORD_TOKEN`), both bots showed the same "my name is …" status identity even though each has its own username. Two stacked causes were found in `src/listeners/ReadyListener.ts`:

1. **Shared-config mutation.** `setPresence` builds activities with `Object.assign(a, { name: await this.formatString(a.name), … })`, which overwrites the objects inside the global `container.config.presenceData.activities` array shared by every bot. The first bot to format permanently bakes its `{username}` (and all `{userCount}`-style counts) into the shared template; every later format — by either bot, on any refresh — sees no placeholders left. Side effect: presence statistics freeze at first-format values.
2. **Intentional mirroring (upstream design).** `doPresence` makes every non-primary bot copy the primary bot's presence each interval (`syncPresence`), and only the primary/single bot gets the rotating `setPresence(true)` interval. Secondaries therefore display the primary's identity by design.

## Decision

Approach A — independent presence per bot: fix the mutation AND remove the mirroring, so each bot displays its own username and its own live statistics, rotating on its own interval. (Rejected: B, fixing only the mutation — secondaries would still mirror the primary; C, adding a `PRESENCE_SYNC` env toggle — YAGNI.)

## Changes (single file: `src/listeners/ReadyListener.ts`)

1. **Pure activity formatting.** In `setPresence`, replace the `Object.assign(a, …)` mutation with a fresh object literal `{ name, type, typeNumber }` produced by the `Promise.all` map. `presenceData` templates are never modified, so every bot and every refresh substitutes `{username}`, `{prefix}`, and the count placeholders from scratch.
2. **Remove the mirroring branch.** Delete the `if (this.container.config.isMultiBot) { … syncPresence … }` block from `doPresence`; every bot then falls through to `return await this.setPresence(false)`.
3. **Interval for every bot.** In `doPresence`'s `finally` block, drop the `isPrimaryOrSingle` condition so all bots run `setInterval(() => this.setPresence(true), presenceData.interval)`.

No schema, env, or i18n changes.

## Verification

- `pnpm lint`, `pnpm build`, `tsc --noEmit` all clean.
- Runtime check with a live bot (deploy panel): with two tokens configured, each bot's Discord profile shows its own username in the status; after the 60s interval the status rotates and counts update rather than staying frozen.

# Design: Per-Bot Default Prefix in Multi-Bot Mode

- **Date**: 2026-09-23
- **Status**: Approved (brainstorming; user pre-authorized continuing with the recommended approach)
- **Project**: nada-bot (Discord music bot, Sapphire framework)

## Context

All bot instances share one `clientOptions` object (including `defaultPrefix`), and every prefix consumer (`MessageCreateListener`, `getEffectivePrefix`, the presence `{prefix}` placeholder) reads the single global `config.mainPrefix`. In multi-bot mode both bots therefore answer to the same default prefix. The user wants a different default prefix per bot.

Known related behavior, explicitly out of scope: the per-guild prefix (`prefix` command, `guilds.prefix` column) is stored per guild only — it applies to every bot in that guild. Slash commands are unaffected.

## Decision

Mirror the existing `DISCORD_TOKEN` convention: `MAIN_PREFIX` accepts a comma-separated list aligned by index with the tokens.

```
DISCORD_TOKEN="tokenBot1,tokenBot2"
MAIN_PREFIX="nada,nbot"
```

Rules: split on commas, trim, drop empty entries; index `i` token gets prefix `list[i]`; when the list is shorter, remaining bots reuse the **last** entry; a single value (no comma) keeps today's behavior (same prefix everywhere); an unset `MAIN_PREFIX` falls back to the current defaults (`d!` in dev, `nada` in production). Empty-list edge case (e.g. `MAIN_PREFIX=","`) falls back to the single default for every bot.

## Changes

1. **`src/config/env.ts`** — parse `MAIN_PREFIX` into `mainPrefixes: string[]` (aligned with `discordTokens` length via the repeat-last rule). Keep exporting `mainPrefix` as `mainPrefixes[0]` (fallback for legacy consumers).
2. **`src/utils/structures/MultiBotLauncher.ts`** — `createBotInstance` builds a per-bot options clone: `{ ...options, defaultPrefix: mainPrefixes[Math.min(tokenIndex, mainPrefixes.length - 1)] }`, so each `Rawon` carries its own `options.defaultPrefix`. Single-bot path (index 0) gets `mainPrefixes[0]`.
3. **`src/listeners/MessageCreateListener.ts`** — the prefix list uses `client.options.defaultPrefix ?? client.config.mainPrefix` instead of the global (the listener already holds the per-event `client`).
4. **`src/utils/functions/getEffectivePrefix.ts`** — the no-guild-prefix fallback becomes `client.options.defaultPrefix ?? client.config.mainPrefix`.
5. **`src/listeners/ReadyListener.ts` (`formatString`)** — `{prefix}` resolves from `this.currentClient.options.defaultPrefix ?? this.container.config.mainPrefix` (per-bot presence, consistent with the per-bot presence fix).
6. **Docs** — `.env.example` `MAIN_PREFIX` entry and the README config section document the comma-separated multi-bot form with an example.

## Verification

- `pnpm lint`, `pnpm build`, `tsc --noEmit` clean.
- Runtime harness on the env parser: unset → `["nada"]` (prod) / `["d!"]` (dev); `"nada,nbot"` + 2 tokens → `["nada","nbot"]`; `"nada,nbot"` + 3 tokens → `["nada","nbot","nbot"]`; `"nada"` → `["nada"]`; `","` → fallback default for all.
- Live smoke after deploy: with two tokens and `MAIN_PREFIX="nada,nbot"`, bot #1 responds to `nada …` only and bot #2 to `nbot …` only; presence status shows each bot's own `{prefix}`.

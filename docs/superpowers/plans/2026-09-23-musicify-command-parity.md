# Musicify Command Parity (move, clear, 247) & Alias Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port musicify's `move`, `clear`, and `247` commands to nada-bot, persist 247 per guild via the `autoplay` pattern, and remove the duplicate `stats` alias from `profile`.

**Architecture:** `247` is a per-guild toggle stored exactly like `autoplay` (`ServerQueue.alwaysOn` → `player_states.always_on`), OR'd on top of the existing bot-wide `alwaysOn` at the four auto-leave checkpoints via a single `ServerQueue.effectiveAlwaysOn` getter. `move` and `clear` operate directly on `SongManager` using the same displayed-queue numbering as `remove` (position 1 = playing song).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), @sapphire/framework + @stegripe/command-context, discord.js v14, better-sqlite3, Biome lint, SWC build.

**Spec:** `docs/superpowers/specs/2026-09-23-musicify-command-parity-design.md`

## Global Constraints

- Work on branch `nada-bot`. Commit after every task.
- No test framework. Verification per task = `pnpm lint` + `pnpm build`; this fork additionally keeps `pnpm exec tsc --noEmit -p tsconfig.json` clean (run it whenever types change).
- Relative imports end with `.js`; 4-space indent; follow existing command file style exactly.
- All user-facing strings via i18n keys; placeholders `{name}` flow through `__mf`.
- i18n keys must land in all 14 `lang/*.json` files (en-US authoritative, id-ID translated, other 12 get en-US copies).
- New command identifiers, verified collision-free: `move [mv]`, `clear [cl]`, `247 [alwayson, stay]`.
- `move`/`clear` position numbering = the `queue` display (`index >= np.index`; position 1 is the playing song — verified against `RemoveCommand.ts:79-81`).

---

### Task 1: i18n keys for `247`, `move`, `clear`

**Files:**
- Modify: all 14 `lang/*.json` (via a one-off script)

**Interfaces:**
- Produces: every key referenced by Tasks 4–6

- [ ] **Step 1: Create and run the merge script**

Create `scripts/add-parity-i18n.tmp.cjs` with the following content, run `node scripts/add-parity-i18n.tmp.cjs`, then delete it:

```js
const fs = require("node:fs");

const enUS = {
    "247": {
        description: "Toggle 24/7 mode so the bot stays in the voice channel",
        usage: "{prefix}247 [enable | disable]",
        slashStateDescription: "New 24/7 state",
        actualState: "Current 24/7 state: {state}",
        enabledMsg: "24/7 mode is now enabled — the bot will stay in the voice channel.",
        disabledMsg: "24/7 mode is now disabled.",
        noPermission:
            "You need the DJ role or Manage Server permission to change 24/7 mode.",
    },
    move: {
        description: "Move a song to a different position in the queue",
        usage: "{prefix}move <from> <to>",
        slashFromDescription: "Position of the song to move",
        slashToDescription: "New position for the song",
        invalidPosition:
            "Invalid positions. Use two different numbers between **2** and **{max}**.",
        samePosition: "That song is already at position **{position}**.",
        playingSongPosition:
            "Position **1** is the currently playing song and cannot be moved.",
        success: "Moved {song} from position **{from}** to **{to}**.",
    },
    clear: {
        description: "Clear all upcoming songs from the queue",
        usage: "{prefix}clear",
        alreadyEmpty: "The queue is already empty.",
        removedSingular: "Removed **1** upcoming song. The current song keeps playing.",
        removedPlural: "Removed **{count}** upcoming songs. The current song keeps playing.",
    },
};

const idID = {
    "247": {
        description: "Aktifkan mode 24/7 agar bot menetap di voice channel",
        usage: "{prefix}247 [enable | disable]",
        slashStateDescription: "Status 24/7 baru",
        actualState: "Status 24/7 saat ini: {state}",
        enabledMsg: "Mode 24/7 aktif — bot akan menetap di voice channel.",
        disabledMsg: "Mode 24/7 nonaktif.",
        noPermission: "Kamu butuh role DJ atau izin Manage Server untuk mengubah mode 24/7.",
    },
    move: {
        description: "Pindahkan lagu ke posisi lain di queue",
        usage: "{prefix}move <dari> <ke>",
        slashFromDescription: "Posisi lagu yang mau dipindah",
        slashToDescription: "Posisi baru untuk lagunya",
        invalidPosition: "Posisi tidak valid. Pakai dua angka berbeda antara **2** dan **{max}**.",
        samePosition: "Lagu itu memang sudah di posisi **{position}**.",
        playingSongPosition: "Posisi **1** adalah lagu yang sedang diputar dan tidak bisa digeser.",
        success: "{song} dipindah dari posisi **{from}** ke **{to}**.",
    },
    clear: {
        description: "Hapus semua lagu mendatang dari queue",
        usage: "{prefix}clear",
        alreadyEmpty: "Queuenya memang sudah kosong.",
        removedSingular: "**1** lagu mendatang dihapus. Lagu yang sedang main tetap lanjut.",
        removedPlural: "**{count}** lagu mendatang dihapus. Lagu yang sedang main tetap lanjut.",
    },
};

const dir = "lang";
const keys = ["247", "move", "clear"];
for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const p = `${dir}/${file}`;
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    const source = file === "id-ID.json" ? idID : enUS;
    for (const key of keys) {
        data.commands.music[key] = source[key];
    }
    fs.writeFileSync(p, `${JSON.stringify(data, null, 4)}\n`);
    console.log("updated", file);
}
for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const d = JSON.parse(fs.readFileSync(`${dir}/${file}`, "utf8"));
    for (const k of keys) {
        if (d.commands.music[k] === undefined) throw new Error(`${file} missing ${k}`);
    }
}
console.log("all locale files OK");
```

Expected: 14 `updated` lines + `all locale files OK`.

- [ ] **Step 2: Verify & commit**

Run: `pnpm lint && pnpm build` — both pass.

```bash
git add lang/
git commit -m "feat: add 247/move/clear i18n keys"
```

---

### Task 2: `always_on` storage + `ServerQueue.alwaysOn`

**Files:**
- Modify: `src/utils/structures/SQLiteDataManager.ts` (initSchema autoplay migration block ~line 144-158; `getPlayerState` ~line 507; `savePlayerState` ~line 542)
- Modify: `src/typings/index.d.ts` (`GuildData["playerState"]` ~line 284)
- Modify: `src/structures/ServerQueue.ts` (field ~line 92, restore ~line 469, `saveState` ~line 507)

**Interfaces:**
- Produces: `GuildData["playerState"].alwaysOn: boolean`; `ServerQueue.alwaysOn: boolean`; `ServerQueue.effectiveAlwaysOn: boolean` getter (used by Task 8 checkpoints)

- [ ] **Step 1: Schema migration**

In `initSchema()`, immediately after the existing `hasAutoplayColumn` block, add (reusing the already-fetched `playerStateInfo`):

```ts
        const hasAlwaysOnColumn = playerStateInfo.some((col) => col.name === "always_on");
        if (!hasAlwaysOnColumn) {
            this.db.exec(`
                ALTER TABLE player_states ADD COLUMN always_on INTEGER DEFAULT 0;
            `);
        }
```

- [ ] **Step 2: Map the column in `getPlayerState`**

Add `always_on: number | null;` to the row type, and to the returned object add:

```ts
            alwaysOn: result.always_on === 1,
```

- [ ] **Step 3: Persist in `savePlayerState`**

Update the INSERT/UPDATE statement to include `always_on` in both the column list and the `DO UPDATE SET` clause (`always_on = excluded.always_on`), and add the run argument `playerState.alwaysOn ? 1 : 0` after the `autoplay` argument.

- [ ] **Step 4: Type + ServerQueue field**

In `src/typings/index.d.ts`, inside `playerState` add `alwaysOn: boolean;` after `autoplay: boolean;`.

In `src/structures/ServerQueue.ts` line ~92, after `public autoPlay = false;` add:

```ts
    public alwaysOn = false;
```

Add a getter next to it:

```ts
    public get effectiveAlwaysOn(): boolean {
        return this.client.data.botSettings.alwaysOn || this.alwaysOn;
    }
```

- [ ] **Step 5: Save & restore**

In `saveState()` (~line 507), add `alwaysOn: this.alwaysOn,` after `autoplay: this.autoPlay,` in the `playerState` object literal.

In the restore path (~line 469), after `this.autoPlay = savedState.autoplay ?? false;` add:

```ts
                this.alwaysOn = savedState.alwaysOn ?? false;
```

- [ ] **Step 6: Verify & commit**

Run: `pnpm lint && pnpm build` and `pnpm exec tsc --noEmit -p tsconfig.json` — all clean.

```bash
git add src/utils/structures/SQLiteDataManager.ts src/typings/index.d.ts src/structures/ServerQueue.ts
git commit -m "feat: persist per-guild 24/7 state in player_states"
```

---

### Task 3: DJ permission helper

**Files:**
- Modify: `src/utils/functions/musicControlPermissions.ts` (append after `hasElevatedMusicPermission`, before `hasMusicControlPermission`)

**Interfaces:**
- Consumes: private `isDJEnabled`, `hasElevatedMusicPermission` (same file)
- Produces: `hasDJOrManagePermission({ client, guild, member }: MusicPermissionOptions): Promise<boolean>` — `true` when DJ mode is off; otherwise ManageGuild or DJ role

- [ ] **Step 1: Add the helper**

```ts
export async function hasDJOrManagePermission({
    client,
    guild,
    member,
}: MusicPermissionOptions): Promise<boolean> {
    if (!isDJEnabled(client, guild)) {
        return true;
    }
    return hasElevatedMusicPermission({ client, guild, member });
}
```

- [ ] **Step 2: Verify & commit**

Run: `pnpm lint && pnpm build && pnpm exec tsc --noEmit -p tsconfig.json` — clean.

```bash
git add src/utils/functions/musicControlPermissions.ts
git commit -m "feat: add DJ-or-manage permission helper for 24/7 toggle"
```

---

### Task 4: `247Command`

**Files:**
- Create: `src/commands/music/247Command.ts`

**Interfaces:**
- Consumes: `queue.alwaysOn` + `queue.saveState()` (Task 2); `hasDJOrManagePermission` (Task 3); i18n keys (Task 1); guards from `MusicUtil.ts`

- [ ] **Step 1: Create the file**

```ts
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { haveQueue, inVC, sameVC, useRequestChannel } from "../../utils/decorators/MusicUtil.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { formatBoldPrefixedCommand } from "../../utils/functions/formatCodeSpan.js";
import { getEffectivePrefix } from "../../utils/functions/getEffectivePrefix.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { hasDJOrManagePermission } from "../../utils/functions/musicControlPermissions.js";

@ApplyOptions<Command.Options>({
    name: "247",
    aliases: ["alwayson", "stay"],
    description: i18n.__("commands.music.247.description"),
    detailedDescription: { usage: i18n.__("commands.music.247.usage") },
    requiredClientPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ],
    chatInputCommand(
        builder: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[0],
        opts: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[1],
    ): SlashCommandBuilder {
        return builder
            .setName(opts.name ?? "247")
            .setDescription(opts.description ?? i18n.__("commands.music.247.description"))
            .addStringOption((opt) =>
                opt
                    .setName("state")
                    .setDescription(i18n.__("commands.music.247.slashStateDescription"))
                    .setRequired(false)
                    .addChoices(
                        { name: "ENABLE", value: "enable" },
                        { name: "DISABLE", value: "disable" },
                    ),
            ) as SlashCommandBuilder;
    },
})
export class AlwaysOnCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    @useRequestChannel
    @inVC
    @haveQueue
    @sameVC
    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const queue = ctx.guild?.queue;
        if (!queue) {
            return;
        }

        const allowed = await hasDJOrManagePermission({
            client,
            guild: ctx.guild as NonNullable<typeof ctx.guild>,
            member: localCtx.member,
        });
        if (!allowed) {
            await ctx.reply({
                embeds: [createEmbed("error", __("commands.music.247.noPermission"), true)],
            });
            return;
        }

        const newStateRaw =
            localCtx.options?.getString("state") ?? (localCtx.args[0] as string | undefined);
        const newState =
            typeof newStateRaw === "string" ? newStateRaw.trim().toLowerCase() : undefined;

        if (!newState) {
            await ctx.reply({
                embeds: [
                    createEmbed("info", `♾️ **|** ${__mf("commands.music.247.actualState", {
                        state: `**\`${queue.alwaysOn === true ? __("reusable.enabled") : __("reusable.disabled")}\`**`,
                    })}`),
                ],
            });
            return;
        }

        if (newState !== "enable" && newState !== "disable") {
            const prefix = getEffectivePrefix(client, ctx.guild?.id ?? null);
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "error",
                        __mf("reusable.invalidUsage", {
                            prefix: formatBoldPrefixedCommand(prefix, "help"),
                            name: `**\`${this.options.name}\`**`,
                        }),
                        true,
                    ),
                ],
            });
            return;
        }

        queue.alwaysOn = newState === "enable";
        await queue.saveState();

        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    `♾️ **|** ${__(newState === "enable" ? "commands.music.247.enabledMsg" : "commands.music.247.disabledMsg")}`,
                    true,
                ),
            ],
        });
    }
}
```

- [ ] **Step 2: Verify & commit**

Run: `pnpm lint && pnpm build && pnpm exec tsc --noEmit -p tsconfig.json` — clean.

```bash
git add src/commands/music/247Command.ts
git commit -m "feat: add 24/7 stay-in-channel command"
```

---

### Task 5: `MoveCommand`

**Files:**
- Create: `src/commands/music/MoveCommand.ts`

**Interfaces:**
- Consumes: `queue.songs` (`SongManager`), `queue.loopMode`, `queue.saveQueueState()` via `songs.set`; i18n keys (Task 1)

- [ ] **Step 1: Create the file**

```ts
import { type AudioPlayerPlayingState } from "@discordjs/voice";
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type QueueSong } from "../../typings/index.js";
import { haveQueue, useRequestChannel } from "../../utils/decorators/MusicUtil.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { formatBoldMarkdownLink } from "../../utils/functions/formatMarkdown.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";

@ApplyOptions<Command.Options>({
    name: "move",
    aliases: ["mv"],
    description: i18n.__("commands.music.move.description"),
    detailedDescription: { usage: i18n.__("commands.music.move.usage") },
    requiredClientPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ],
    chatInputCommand(
        builder: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[0],
        opts: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[1],
    ): SlashCommandBuilder {
        return builder
            .setName(opts.name ?? "move")
            .setDescription(opts.description ?? i18n.__("commands.music.move.description"))
            .addIntegerOption((opt) =>
                opt
                    .setName("from")
                    .setDescription(i18n.__("commands.music.move.slashFromDescription"))
                    .setRequired(true),
            )
            .addIntegerOption((opt) =>
                opt
                    .setName("to")
                    .setDescription(i18n.__("commands.music.move.slashToDescription"))
                    .setRequired(true),
            ) as SlashCommandBuilder;
    },
})
export class MoveCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    @useRequestChannel
    @haveQueue
    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const queue = ctx.guild?.queue;
        if (!queue) {
            return;
        }

        const from = localCtx.options?.getInteger("from") ?? Number(localCtx.args[0]);
        const to = localCtx.options?.getInteger("to") ?? Number(localCtx.args[1]);

        const np = (queue.player.state as AudioPlayerPlayingState).resource
            .metadata as QueueSong;
        const displayed = [...queue.songs.sortByIndex().values()].filter(
            (val) => queue.loopMode === "QUEUE" || val.index >= np.index,
        );

        if (from === 1 || to === 1) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __("commands.music.move.playingSongPosition")),
                ],
            });
            return;
        }
        if (from === to) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __mf("commands.music.move.samePosition", {
                        position: to,
                    })),
                ],
            });
            return;
        }
        if (
            !Number.isInteger(from) ||
            !Number.isInteger(to) ||
            from < 2 ||
            to < 2 ||
            from > displayed.length ||
            to > displayed.length
        ) {
            await ctx.reply({
                embeds: [
                    createEmbed("warn", __mf("commands.music.move.invalidPosition", {
                        max: displayed.length,
                    })),
                ],
            });
            return;
        }

        const [moved] = displayed.splice(from - 1, 1);
        displayed.splice(to - 1, 0, moved);

        const baseIndex = displayed[0]?.index ?? 0;
        for (const [i, entry] of displayed.entries()) {
            entry.index = baseIndex + i;
            queue.songs.set(entry.key, entry);
        }

        await ctx.reply({
            embeds: [
                createEmbed("success", __mf("commands.music.move.success", {
                    song: formatBoldMarkdownLink(moved.song.title, moved.song.url),
                    from,
                    to,
                }), true),
            ],
        });
    }
}
```

- [ ] **Step 2: Verify & commit**

Run: `pnpm lint && pnpm build && pnpm exec tsc --noEmit -p tsconfig.json` — clean.

```bash
git add src/commands/music/MoveCommand.ts
git commit -m "feat: add queue move command"
```

---

### Task 6: `ClearCommand`

**Files:**
- Create: `src/commands/music/ClearCommand.ts`

**Interfaces:**
- Consumes: `queue.songs`, current song key; i18n keys (Task 1)

- [ ] **Step 1: Create the file**

```ts
import { type AudioPlayerPlayingState } from "@discordjs/voice";
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type QueueSong } from "../../typings/index.js";
import { haveQueue, useRequestChannel } from "../../utils/decorators/MusicUtil.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";

@ApplyOptions<Command.Options>({
    name: "clear",
    aliases: ["cl"],
    description: i18n.__("commands.music.clear.description"),
    detailedDescription: { usage: i18n.__("commands.music.clear.usage") },
    requiredClientPermissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
    ],
    chatInputCommand(
        builder: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[0],
        opts: Parameters<NonNullable<Command.Options["chatInputCommand"]>>[1],
    ): SlashCommandBuilder {
        return builder
            .setName(opts.name ?? "clear")
            .setDescription(opts.description ?? i18n.__("commands.music.clear.description"))
            as SlashCommandBuilder;
    },
})
export class ClearCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    @useRequestChannel
    @haveQueue
    public async contextRun(ctx: CommandContext): Promise<void> {
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const queue = ctx.guild?.queue;
        if (!queue) {
            return;
        }

        const np = (queue.player.state as AudioPlayerPlayingState).resource
            .metadata as QueueSong;

        if (queue.songs.size <= 1) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.clear.alreadyEmpty"))],
            });
            return;
        }

        const removed = queue.songs.size - 1;
        for (const key of [...queue.songs.keys()]) {
            const entry = queue.songs.get(key);
            if (entry !== undefined && entry.key !== np.key) {
                queue.songs.delete(key);
            }
        }

        await ctx.reply({
            embeds: [
                createEmbed(
                    "success",
                    removed === 1
                        ? __("commands.music.clear.removedSingular")
                        : __mf("commands.music.clear.removedPlural", { count: removed }),
                    true,
                ),
            ],
        });
    }
}
```

- [ ] **Step 2: Verify & commit**

Run: `pnpm lint && pnpm build && pnpm exec tsc --noEmit -p tsconfig.json` — clean.

```bash
git add src/commands/music/ClearCommand.ts
git commit -m "feat: add clear-queue command"
```

---

### Task 7: Remove duplicate `stats` alias

**Files:**
- Modify: `src/commands/music/ProfileCommand.ts:14`

- [ ] **Step 1: Change the alias list**

Replace `aliases: ["stats"],` with `aliases: [],`.

- [ ] **Step 2: Verify no duplicate names/aliases remain**

Run this check (expects no output before `OK`):

```bash
cd /d/PROJECTs/Typescript/nada-bot && for f in src/commands/*/*.ts; do
  grep -m1 'name: "' "$f" | sed 's/.*name: "\([^"]*\)".*/\1/';
  grep -A1 'aliases:' "$f" | grep -o '"[^"]*"' | tr -d '"';
done | sort | uniq -d
```

Expected: empty output (no duplicates), then print `OK` manually. If any duplicate appears, resolve it before committing.

- [ ] **Step 3: Verify & commit**

Run: `pnpm lint && pnpm build` — clean.

```bash
git add src/commands/music/ProfileCommand.ts
git commit -m "fix: drop duplicate stats alias from profile command"
```

---

### Task 8: Auto-leave checkpoints honor per-guild 247

**Files:**
- Modify: `src/listeners/VoiceStateUpdateListener.ts` (3 sites: ~line 411, ~625, ~706)
- Modify: `src/utils/handlers/general/play.ts` (~line 92)

**Interfaces:**
- Consumes: `ServerQueue.effectiveAlwaysOn` (Task 2)

- [ ] **Step 1: Update the three listener sites**

Each site currently reads `if (queue.client.data.botSettings.alwaysOn) {` or `if (client.data.botSettings.alwaysOn) {`. Replace the condition with `queue.effectiveAlwaysOn` / `guild.queue?.effectiveAlwaysOn === true` respectively, keeping each site's surrounding code (pause + return) unchanged. The three sites are: the requester-deaf timeout guard (~411), the empty-voice-channel path (~625), and the paused-empty path (~706).

- [ ] **Step 2: Update `play.ts` queue-ended path**

Replace `if (queue.client.data.botSettings.alwaysOn) {` with `if (queue.effectiveAlwaysOn) {` (the debug log line inside may keep its text).

- [ ] **Step 3: Verify & commit**

Run: `pnpm lint && pnpm build && pnpm exec tsc --noEmit -p tsconfig.json` — clean. Grep to confirm no checkpoint still reads botSettings.alwaysOn for the stay/leave decision:

```bash
grep -rn "botSettings.alwaysOn" src/listeners/VoiceStateUpdateListener.ts src/utils/handlers/general/play.ts
```

Expected: no matches.

```bash
git add src/listeners/VoiceStateUpdateListener.ts src/utils/handlers/general/play.ts
git commit -m "feat: honor per-guild 24/7 at auto-leave checkpoints"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Lint, build, typecheck**

Run: `pnpm lint && pnpm build && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: all clean.

- [ ] **Step 2: Runtime harness**

Create `verify-parity.tmp.mjs`, run `node verify-parity.tmp.mjs`, delete it. Content:

```js
import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

// 1) locale key presence across all 14 files
for (const file of readdirSync("lang")) {
    if (!file.endsWith(".json")) continue;
    const d = JSON.parse(readFileSync(`lang/${file}`, "utf8"));
    for (const k of ["247", "move", "clear"]) {
        if (d.commands.music[k] === undefined) throw new Error(`${file} missing ${k}`);
    }
}
console.log("locale keys OK");

// 2) player state round-trip incl. alwaysOn + idempotent migration
const dbPath = path.join(process.cwd(), "cache", "verify-parity.db");
rmSync(dbPath, { force: true });
const { SQLiteDataManager } = await import("./dist/utils/structures/SQLiteDataManager.js");
const mgr = new SQLiteDataManager(dbPath);
await mgr.load();
await mgr.savePlayerState("g1", "b1", {
    loopMode: "OFF",
    shuffle: false,
    autoplay: false,
    alwaysOn: true,
    volume: 100,
    filters: {},
});
const state = mgr.getPlayerState("g1", "b1");
if (state?.alwaysOn !== true) throw new Error(`alwaysOn round-trip broken: ${JSON.stringify(state)}`);
const mgr2 = new SQLiteDataManager(dbPath); // re-runs initSchema on the same file
const state2 = mgr2.getPlayerState("g1", "b1");
if (state2?.alwaysOn !== true) throw new Error("migration not idempotent / state lost");
mgr.close();
mgr2.close();
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
console.log("player state round-trip OK");
console.log("ALL PARITY VERIFICATIONS PASSED");
```

- [ ] **Step 3: Manual smoke checklist (needs a live bot)**

1. While playing: `247` shows state; `247 enable`; leave the VC alone → bot pauses and stays; `247 disable`; leave → bot disconnects after ~60s
2. Restart the bot with 247 enabled and a saved queue → 247 still enabled after restore
3. With ≥3 upcoming songs: `move 3 2` reorders exactly as `queue` displays; `move 1 3` → "playing song" message; `move 2 99` → invalid range message
4. `clear` with upcoming songs → only current song keeps playing, connection stays; `clear` again → "already empty"
5. `profile` works; `stats` resolves to `about`; `mv`/`cl`/`alwayson`/`stay` prefixes all respond

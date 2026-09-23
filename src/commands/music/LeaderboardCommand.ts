import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { type Rawon } from "../../structures/Rawon.js";
import { chunk } from "../../utils/functions/chunk.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { getTitlePhrase } from "../../utils/functions/userStats.js";
import { ButtonPagination } from "../../utils/structures/ButtonPagination.js";

@ApplyOptions<Command.Options>({
    name: "leaderboard",
    aliases: ["lb"],
    description: i18n.__("commands.music.leaderboard.description"),
    detailedDescription: { usage: i18n.__("commands.music.leaderboard.usage") },
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
            .setName(opts.name ?? "leaderboard")
            .setDescription(
                opts.description ?? i18n.__("commands.music.leaderboard.description"),
            ) as SlashCommandBuilder;
    },
})
export class LeaderboardCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const guildId = ctx.guild?.id;

        if (guildId === undefined) {
            return;
        }

        const total = client.data.countGuildStats(guildId);
        if (total === 0) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.leaderboard.empty"))],
            });
            return;
        }

        const rows = client.data.getGuildLeaderboard(guildId, total, 0);
        const lines = await Promise.all(
            rows.map(async (row) => {
                const member = await ctx.guild?.members.fetch(row.userId).catch(() => null);
                const user = await client.users.fetch(row.userId).catch(() => null);
                const display = member?.displayName ?? user?.username ?? row.userId;
                const title = __(getTitlePhrase(row.playCount));
                return `**#${row.rank}** ${display} — **${row.playCount}** ${__(
                    "commands.music.leaderboard.playsLabel",
                )} · ${title}`;
            }),
        );

        const pages = chunk(lines, 10).map((page) => page.join("\n"));
        const embed = createEmbed("info", pages[0]).setTitle(
            `🏆 ${__("commands.music.leaderboard.title")}`,
        );
        const msg = await ctx.reply({ embeds: [embed] });
        await new ButtonPagination(msg, {
            author: ctx.author.id,
            edit: (i, emb, page) =>
                emb.setDescription(page).setFooter({
                    text: `• ${__mf("reusable.pageFooter", {
                        actual: i + 1,
                        total: pages.length,
                    })}`,
                }),
            embed,
            pages,
        }).start();
    }
}

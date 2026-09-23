import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder, type User } from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
import { type Rawon } from "../../structures/Rawon.js";
import { createEmbed } from "../../utils/functions/createEmbed.js";
import { i18n__, i18n__mf } from "../../utils/functions/i18n.js";
import { getNextTitleTier, getTitlePhrase } from "../../utils/functions/userStats.js";

@ApplyOptions<Command.Options>({
    name: "profile",
    aliases: ["stats"],
    description: i18n.__("commands.music.profile.description"),
    detailedDescription: { usage: i18n.__("commands.music.profile.usage") },
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
            .setName(opts.name ?? "profile")
            .setDescription(opts.description ?? i18n.__("commands.music.profile.description"))
            .addUserOption((opt) =>
                opt
                    .setName("user")
                    .setDescription(i18n.__("commands.music.profile.subUserDescription"))
                    .setRequired(false),
            ) as SlashCommandBuilder;
    },
})
export class ProfileCommand extends ContextCommand {
    private getClient(ctx: CommandContext): Rawon {
        return ctx.client as Rawon;
    }

    public async contextRun(ctx: CommandContext): Promise<void> {
        const localCtx = ctx as unknown as CommandContext & LocalCommandContext;
        const client = this.getClient(ctx);
        const __ = i18n__(client, ctx.guild);
        const __mf = i18n__mf(client, ctx.guild);
        const guildId = ctx.guild?.id;

        if (guildId === undefined) {
            return;
        }

        const target =
            localCtx.options?.getUser("user") ?? localCtx.mentions?.users.first() ?? ctx.author;
        const stats = client.data.getUserPlayStats(guildId, target.id);

        if (stats === null) {
            await ctx.reply({
                embeds: [
                    createEmbed("info", __("commands.music.profile.noData"))
                        .setTitle(`👤 ${__("commands.music.profile.title")}`)
                        .setThumbnail(
                            (target as User).displayAvatarURL({ extension: "png", size: 256 }),
                        ),
                ],
            });
            return;
        }

        const playCount = stats.playCount;
        const nextTier = getNextTitleTier(playCount);
        const embed = createEmbed("info")
            .setTitle(`👤 ${__("commands.music.profile.title")}`)
            .setThumbnail((target as User).displayAvatarURL({ extension: "png", size: 256 }))
            .addFields(
                {
                    name: __("commands.music.profile.playCountLabel"),
                    value: `**${playCount}**`,
                    inline: true,
                },
                {
                    name: __("commands.music.profile.rankLabel"),
                    value: `**#${stats.rank}**`,
                    inline: true,
                },
                {
                    name: __("commands.music.profile.titleLabel"),
                    value: __(getTitlePhrase(playCount)),
                    inline: true,
                },
                {
                    name: __("commands.music.profile.nextTitle"),
                    value:
                        nextTier === null
                            ? __("commands.music.profile.maxTierReached")
                            : __mf("commands.music.profile.nextTierProgress", {
                                  title: __(`commands.music.titles.${nextTier.key}`),
                                  current: playCount,
                                  needed: nextTier.minPlays,
                              }),
                },
            );
        await ctx.reply({ embeds: [embed] });
    }
}

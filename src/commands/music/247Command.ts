import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
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
                    createEmbed(
                        "info",
                        `♾️ **|** ${__mf("commands.music.247.actualState", {
                            state: `**\`${queue.alwaysOn === true ? __("reusable.enabled") : __("reusable.disabled")}\`**`,
                        })}`,
                    ),
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

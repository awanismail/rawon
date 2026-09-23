import { type AudioPlayerPlayingState } from "@discordjs/voice";
import { ApplyOptions } from "@sapphire/decorators";
import { type Command } from "@sapphire/framework";
import { type CommandContext, ContextCommand } from "@stegripe/command-context";
import { PermissionFlagsBits, type SlashCommandBuilder } from "discord.js";
import i18n from "../../config/index.js";
import { type CommandContext as LocalCommandContext } from "../../structures/CommandContext.js";
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

        const np = (queue.player.state as AudioPlayerPlayingState).resource.metadata as QueueSong;
        const displayed = [...queue.songs.sortByIndex().values()].filter(
            (val) => queue.loopMode === "QUEUE" || val.index >= np.index,
        );

        if (from === 1 || to === 1) {
            await ctx.reply({
                embeds: [createEmbed("warn", __("commands.music.move.playingSongPosition"))],
            });
            return;
        }
        if (from === to) {
            await ctx.reply({
                embeds: [
                    createEmbed(
                        "warn",
                        __mf("commands.music.move.samePosition", {
                            position: to,
                        }),
                    ),
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
                    createEmbed(
                        "warn",
                        __mf("commands.music.move.invalidPosition", {
                            max: displayed.length,
                        }),
                    ),
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
                createEmbed(
                    "success",
                    __mf("commands.music.move.success", {
                        song: formatBoldMarkdownLink(moved.song.title, moved.song.url),
                        from,
                        to,
                    }),
                    true,
                ),
            ],
        });
    }
}

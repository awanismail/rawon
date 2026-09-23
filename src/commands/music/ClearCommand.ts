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
            .setDescription(
                opts.description ?? i18n.__("commands.music.clear.description"),
            ) as SlashCommandBuilder;
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

        const np = (queue.player.state as AudioPlayerPlayingState).resource.metadata as QueueSong;

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

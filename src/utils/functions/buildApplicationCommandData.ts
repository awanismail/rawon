import { type Command } from "@sapphire/framework";
import {
    type ApplicationCommandDataResolvable,
    ApplicationCommandType,
    SlashCommandBuilder,
} from "discord.js";
import { type Rawon } from "../../structures/Rawon.js";

type CommandOptionsWithMenus = Command.Options & {
    contextChat?: string;
    contextUser?: string;
    disable?: boolean;
};

type ChatInputBuilderParam = Parameters<NonNullable<Command.Options["chatInputCommand"]>>[0];
type ChatInputOptionsParam = Parameters<NonNullable<Command.Options["chatInputCommand"]>>[1];

/**
 * Builds the full application command payload from the pieces currently loaded in the
 * (shared) command store. Mirrors what Sapphire's registry flow would produce: chat input
 * commands come from each piece's `chatInputCommand` option, context menus from the
 * custom `contextChat`/`contextUser` options.
 */
export function buildApplicationCommandData(client: Rawon): ApplicationCommandDataResolvable[] {
    const data: ApplicationCommandDataResolvable[] = [];

    for (const piece of client.stores.get("commands").values()) {
        const options = piece.options as CommandOptionsWithMenus;
        if (options.disable === true) {
            continue;
        }

        if (options.chatInputCommand) {
            const builder = options.chatInputCommand(
                new SlashCommandBuilder() as ChatInputBuilderParam,
                options as ChatInputOptionsParam,
            );
            data.push(builder.toJSON());
        }
        if ((options.contextChat?.length ?? 0) > 0) {
            data.push({
                name: options.contextChat ?? "",
                type: ApplicationCommandType.Message,
            });
        }
        if ((options.contextUser?.length ?? 0) > 0) {
            data.push({
                name: options.contextUser ?? "",
                type: ApplicationCommandType.User,
            });
        }
    }

    return data;
}

import { ApplyOptions } from "@sapphire/decorators";
import { Events, Listener, type ListenerOptions } from "@sapphire/framework";
import { type Message, type PartialMessage } from "discord.js";
import { type Rawon } from "../structures/Rawon.js";
import { hasGetRequestChannel } from "../utils/typeGuards.js";

@ApplyOptions<ListenerOptions>({ event: Events.MessageDelete })
export class MessageDeleteListener extends Listener<typeof Events.MessageDelete> {
    public async run(message: Message | PartialMessage): Promise<void> {
        if (!message.guild) {
            return;
        }

        const guild = message.guild;
        const client = message.client as Rawon;
        const botId = client.user?.id ?? "unknown";

        let requestChannelData: { channelId: string | null; messageId: string | null } | null =
            null;

        if (hasGetRequestChannel(this.container.data)) {
            requestChannelData = this.container.data.getRequestChannel(guild.id, botId);
        } else {
            const fallback = this.container
                .data as import("../utils/typeGuards.js").FallbackDataManager;
            requestChannelData = fallback.data?.[guild.id]?.requestChannel ?? null;
        }

        if (requestChannelData?.messageId === message.id) {
            this.container.logger.info(
                `ChatPlay player message (${message.id}) was deleted in guild ${guild.name} (${guild.id}). Recreating...`,
            );

            this.container.debugLog.logData("info", "MESSAGE_DELETE_EVENT", [
                ["MessageId", message.id],
                ["Guild", `${guild.name}(${guild.id})`],
                ["Reason", "ChatPlay player message deleted — auto-recreate"],
            ]);

            try {
                await client.requestChannelManager.setPlayerMessageId(guild, null);
                await client.requestChannelManager.createOrUpdatePlayerMessage(guild, true);
                this.container.logger.info(
                    `Recreated ChatPlay player message for guild ${guild.name} (${guild.id})`,
                );
            } catch (error) {
                this.container.logger.error(
                    `Failed to recreate ChatPlay player message for guild ${guild.id}:`,
                    error,
                );
            }
        }
    }
}

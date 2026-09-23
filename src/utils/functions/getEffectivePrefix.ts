import { type ClientOptions } from "discord.js";
import { type Rawon } from "../../structures/Rawon.js";

export function getBotDefaultPrefix(client: Rawon): string {
    return (
        (client.options as ClientOptions & { defaultPrefix?: string }).defaultPrefix ??
        client.config.mainPrefix
    );
}

export function getEffectivePrefix(client: Rawon, guildId: string | null): string {
    const fallback = getBotDefaultPrefix(client);
    if (!guildId) {
        return fallback;
    }
    const guildPrefix = client.data.getPrefix(guildId);
    return guildPrefix ?? fallback;
}

import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import {
    ActionRowBuilder,
    type APIMessageTopLevelComponent,
    type AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    type Guild,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    type Message,
    type MessageCreateOptions,
    type MessageEditOptions,
    MessageFlags,
    PermissionFlagsBits,
    SectionBuilder,
    SeparatorBuilder,
    type StageChannel,
    StringSelectMenuBuilder,
    type TextChannel,
    TextDisplayBuilder,
    ThumbnailBuilder,
    type VoiceChannel,
} from "discord.js";
import { type Rawon } from "../../structures/Rawon.js";
import { type Song } from "../../typings/index.js";
import { createEmbed } from "../functions/createEmbed.js";

import { getMaxResThumbnail } from "../functions/getMaxResThumbnail.js";
import { i18n__, i18n__mf } from "../functions/i18n.js";
import { renderMusicCard } from "../functions/musicCard.js";
import { formatDuration, normalizeTime } from "../functions/normalizeTime.js";
import {
    type FallbackDataManager,
    hasGetPlayerState,
    hasGetRequestChannel,
    hasSaveRequestChannel,
} from "../typeGuards.js";

type PlayerStatusGridItem = {
    label: string;
    value: string;
};

export type ChatPlayOptions = {
    mode: "chat" | "command";
    smartFilter: boolean;
    autoDelete: boolean;
    slowmode: boolean;
    pinPlayer: boolean;
};

const CHAT_PLAY_DEFAULT_OPTIONS: ChatPlayOptions = {
    mode: "chat",
    smartFilter: false,
    autoDelete: false,
    slowmode: false,
    pinPlayer: false,
};

export class RequestChannelManager {
    private readonly pendingUpdates = new Map<string, NodeJS.Timeout>();
    private readonly updateGenerations = new Map<string, number>();
    private readonly ephemeralPlayerMessageIds = new Map<string, string>();
    private readonly updateDebounceMs = 500;
    private readonly permissionWarningCooldowns = new Map<string, number>();
    private readonly permissionWarningCooldownMs = 60_000;
    private readonly progressRefreshIntervals = new Map<string, NodeJS.Timeout>();
    private readonly suggestionsCache = new Map<string, Song[]>();
    private readonly suggestionsForKeys = new Map<string, string>();
    private readonly progressRefreshIntervalMs = 15_000;

    private static readonly supportedChannelTypes = new Set<ChannelType>([
        ChannelType.GuildText,
        ChannelType.GuildVoice,
        ChannelType.GuildStageVoice,
    ]);

    public constructor(public readonly client: Rawon) {}

    private getPlayerAccentColor(): number {
        const normalizedColor = this.client.data.botSettings.embedColor.replace(/^#/u, "");
        const parsedColor = Number.parseInt(normalizedColor, 16);

        if (!Number.isFinite(parsedColor) || parsedColor < 0 || parsedColor > 0xffffff) {
            return 0x22c9ff;
        }

        return parsedColor;
    }

    private getSafeImageUrl(url: string | null | undefined): string {
        if (typeof url === "string" && /^https?:\/\//iu.test(url)) {
            return url;
        }

        return "https://cdn.stegripe.org/images/rawon_splash.png";
    }

    private formatQueueFooter(
        count: string | number,
        duration: string,
        autoPlay: boolean,
        __: (key: string) => string,
        __mf: (key: string, values: Record<string, string | number>) => string,
    ): string {
        const autoPlayState = autoPlay ? "ON" : "OFF";
        const footerTemplate = __("requestChannel.queueFooter");

        if (footerTemplate.includes("{state}")) {
            return __mf("requestChannel.queueFooter", {
                count,
                duration,
                state: autoPlayState,
            });
        }

        const baseFooter = __mf("requestChannel.queueFooter", {
            count,
            duration,
        });

        return baseFooter;
    }

    private isPrimaryBot(): boolean {
        if (!this.client.config.isMultiBot) {
            return true;
        }

        const thisBot = this.client.multiBotManager.getBotByClient(this.client);
        return thisBot?.isPrimary ?? true;
    }

    private getPrimaryRequestChannel(
        guild: Guild,
    ): TextChannel | VoiceChannel | StageChannel | null {
        if (!this.client.config.isMultiBot || this.isPrimaryBot()) {
            return null;
        }

        const primaryBot = this.client.multiBotManager.getPrimaryBot();
        if (!primaryBot) {
            return null;
        }

        const primaryGuild = primaryBot.guilds.cache.get(guild.id);
        if (!primaryGuild) {
            return null;
        }

        return primaryBot.requestChannelManager.getRequestChannel(primaryGuild);
    }

    private isValidId(id: string | null | undefined): id is string {
        return id !== null && id !== undefined && id.length > 0;
    }

    private isSupportedRequestChannel(
        channel: Guild["channels"]["cache"] extends Map<any, infer Channel> ? Channel : never,
    ): channel is TextChannel | VoiceChannel | StageChannel {
        return RequestChannelManager.supportedChannelTypes.has(channel.type);
    }

    private getConfiguredRequestChannelId(guild: Guild): string | null {
        const botId = this.client.user?.id ?? "unknown";

        if (hasGetRequestChannel(this.client.data)) {
            return this.client.data.getRequestChannel(guild.id, botId)?.channelId ?? null;
        }

        const fallback = this.client.data as FallbackDataManager;
        return fallback.data?.[guild.id]?.requestChannel?.channelId ?? null;
    }

    public ownsConfiguredRequestChannel(guild: Guild): boolean {
        return this.isValidId(this.getConfiguredRequestChannelId(guild));
    }

    private rememberPlayerMessageId(guildId: string, messageId: string | null): void {
        if (this.isValidId(messageId)) {
            this.ephemeralPlayerMessageIds.set(guildId, messageId);
            return;
        }

        this.ephemeralPlayerMessageIds.delete(guildId);
    }

    private getMissingRequestChannelPermissions(
        guild: Guild,
        channel: TextChannel | VoiceChannel | StageChannel,
    ): bigint[] {
        const requiredPermissions = [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
        ];

        const botMember = guild.members.me ?? guild.members.cache.get(this.client.user?.id ?? "");
        if (!botMember) {
            return [...requiredPermissions];
        }

        const channelPermissions = channel.permissionsFor(botMember);
        if (!channelPermissions) {
            return [...requiredPermissions];
        }

        return requiredPermissions.filter((permission) => !channelPermissions.has(permission));
    }

    private formatPermissionName(permission: bigint): string {
        const flagName = Object.entries(PermissionFlagsBits).find(
            ([, value]) => value === permission,
        )?.[0];
        const spacedName = (flagName ?? "Unknown").replace(/([a-z])([A-Z])/g, "$1 $2");
        return `**\`${spacedName}\`**`;
    }

    private canSendEmbedToTextChannel(
        guild: Guild,
        channel: TextChannel | VoiceChannel | StageChannel,
    ): boolean {
        const botMember = guild.members.me ?? guild.members.cache.get(this.client.user?.id ?? "");
        if (!botMember) {
            return false;
        }

        const permissions = channel.permissionsFor(botMember);
        if (!permissions) {
            return false;
        }

        return (
            permissions.has(PermissionFlagsBits.ViewChannel) &&
            permissions.has(PermissionFlagsBits.SendMessages) &&
            permissions.has(PermissionFlagsBits.EmbedLinks)
        );
    }

    private isPermissionError(error: unknown): boolean {
        const code = (error as { code?: number }).code;
        return code === 50_001 || code === 50_013;
    }

    private shouldNotifyPermissionIssue(
        guildId: string,
        channelId: string,
        reason: string,
    ): boolean {
        const key = `${guildId}:${channelId}:${this.client.user?.id ?? "unknown"}:${reason}`;
        const now = Date.now();
        const lastNotifiedAt = this.permissionWarningCooldowns.get(key) ?? 0;

        if (now - lastNotifiedAt < this.permissionWarningCooldownMs) {
            return false;
        }

        this.permissionWarningCooldowns.set(key, now);
        return true;
    }

    private async notifyRequestChannelPermissionIssue(
        guild: Guild,
        channelId: string,
        messageText: string,
        reason: string,
    ): Promise<void> {
        if (!this.shouldNotifyPermissionIssue(guild.id, channelId, reason)) {
            return;
        }

        const fallbackChannels: Array<TextChannel | VoiceChannel | StageChannel> = [];
        if (guild.queue?.textChannel && guild.queue.textChannel.id !== channelId) {
            fallbackChannels.push(guild.queue.textChannel);
        }
        if (
            guild.systemChannel &&
            guild.systemChannel.id !== channelId &&
            !fallbackChannels.some((channel) => channel.id === guild.systemChannel?.id)
        ) {
            fallbackChannels.push(guild.systemChannel);
        }

        for (const fallbackChannel of fallbackChannels) {
            if (!this.canSendEmbedToTextChannel(guild, fallbackChannel)) {
                continue;
            }

            const sent = await fallbackChannel
                .send({
                    flags: MessageFlags.SuppressNotifications,
                    embeds: [createEmbed("error", messageText, true)],
                })
                .then(() => true)
                .catch(() => false);

            if (sent) {
                return;
            }
        }
    }

    public getRequestChannel(guild: Guild): TextChannel | VoiceChannel | StageChannel | null {
        const botId = this.client.user?.id ?? "unknown";

        if (hasGetRequestChannel(this.client.data)) {
            const data = this.client.data.getRequestChannel(guild.id, botId);
            if (this.isValidId(data?.channelId)) {
                const channel = guild.channels.cache.get(data.channelId);
                if (channel && this.isSupportedRequestChannel(channel)) {
                    return channel;
                }
            }
        }

        const fallback = this.client.data as FallbackDataManager;
        const data = fallback.data?.[guild.id]?.requestChannel;
        if (this.isValidId(data?.channelId)) {
            const channel = guild.channels.cache.get(data.channelId);
            if (channel && this.isSupportedRequestChannel(channel)) {
                return channel;
            }
        }

        const primaryChannel = this.getPrimaryRequestChannel(guild);
        if (primaryChannel) {
            return primaryChannel;
        }

        return null;
    }

    public async getPlayerMessage(guild: Guild): Promise<Message | null> {
        const botId = this.client.user?.id ?? "unknown";
        const channel = this.getRequestChannel(guild);
        if (!channel) {
            return null;
        }

        let messageId: string | null = null;
        if (hasGetRequestChannel(this.client.data)) {
            const data = this.client.data.getRequestChannel(guild.id, botId);
            if (this.isValidId(data?.messageId)) {
                messageId = data.messageId;
            }
        } else {
            const fallback = this.client.data as FallbackDataManager;
            const data = fallback.data?.[guild.id]?.requestChannel;
            if (this.isValidId(data?.messageId)) {
                messageId = data.messageId;
            }
        }

        messageId ??= this.ephemeralPlayerMessageIds.get(guild.id) ?? null;

        if (messageId) {
            try {
                const storedMessage = await channel.messages.fetch(messageId);
                if (storedMessage.author.id === this.client.user?.id) {
                    this.rememberPlayerMessageId(guild.id, storedMessage.id);
                    return storedMessage;
                }
            } catch {
                this.rememberPlayerMessageId(guild.id, null);
            }
        }

        const found = await this.findPlayerMessages(channel);
        const ownMessage = found[0] ?? null;
        this.rememberPlayerMessageId(guild.id, ownMessage?.id ?? null);
        return ownMessage;
    }

    public hasRequestChannel(guild: Guild): boolean {
        const botId = this.client.user?.id ?? "unknown";

        if (hasGetRequestChannel(this.client.data)) {
            const data = this.client.data.getRequestChannel(guild.id, botId);
            return this.isValidId(data?.channelId);
        }

        const fallback = this.client.data as FallbackDataManager;
        const data = fallback.data?.[guild.id]?.requestChannel;
        return this.isValidId(data?.channelId);
    }

    public async setRequestChannel(guild: Guild, channelId: string | null): Promise<void> {
        const botId = this.client.user?.id ?? "unknown";

        if (hasSaveRequestChannel(this.client.data)) {
            if (channelId === null) {
                const existingMessage = await this.getPlayerMessage(guild);
                if (existingMessage) {
                    await existingMessage.delete().catch(() => null);
                }
                await this.client.data.saveRequestChannel(guild.id, botId, null, null);
            } else {
                await this.client.data.saveRequestChannel(guild.id, botId, channelId, null);
            }
            if (typeof this.client.data.load === "function") {
                await this.client.data.load();
            }
        } else {
            const fallback = this.client.data as FallbackDataManager;
            const currentData = fallback.data ?? {};
            const guildData = currentData[guild.id] ?? {};

            if (channelId === null) {
                const existingMessage = await this.getPlayerMessage(guild);
                if (existingMessage) {
                    await existingMessage.delete().catch(() => null);
                }
                guildData.requestChannel = { channelId: null, messageId: null };
            } else {
                guildData.requestChannel = { channelId, messageId: null };
            }

            (await fallback.save?.(() => ({
                ...currentData,
                [guild.id]: guildData,
            }))) ?? Promise.resolve();
        }
    }

    public async setPlayerMessageId(guild: Guild, messageId: string | null): Promise<void> {
        this.rememberPlayerMessageId(guild.id, messageId);

        const botId = this.client.user?.id ?? "unknown";
        const ownedChannelId = this.getConfiguredRequestChannelId(guild);
        if (!this.isValidId(ownedChannelId) && !this.isPrimaryBot()) {
            return;
        }

        if (hasGetRequestChannel(this.client.data) && hasSaveRequestChannel(this.client.data)) {
            const current = this.client.data.getRequestChannel(guild.id, botId);
            const channelId = current?.channelId ?? this.getRequestChannel(guild)?.id ?? null;
            await this.client.data.saveRequestChannel(guild.id, botId, channelId, messageId);
            if (typeof this.client.data.load === "function") {
                await this.client.data.load();
            }
        } else {
            const fallback = this.client.data as FallbackDataManager;
            const currentData = fallback.data ?? {};
            const guildData = currentData[guild.id] ?? {};
            const effectiveChannelId =
                guildData.requestChannel?.channelId ?? this.getRequestChannel(guild)?.id ?? null;

            guildData.requestChannel ??= { channelId: effectiveChannelId, messageId: null };
            guildData.requestChannel.channelId ??= effectiveChannelId;
            guildData.requestChannel.messageId = messageId;

            (await fallback.save?.(() => ({
                ...currentData,
                [guild.id]: guildData,
            }))) ?? Promise.resolve();
        }
    }

    public getRequestChannelOptions(guild: Guild): ChatPlayOptions {
        const botId = this.client.user?.id ?? "unknown";

        if (hasGetRequestChannel(this.client.data)) {
            const data = this.client.data.getRequestChannel(guild.id, botId);
            return {
                mode: data?.mode === "command" ? "command" : "chat",
                smartFilter: data?.smartFilter === true,
                autoDelete: data?.autoDelete === true,
                slowmode: data?.slowmode === true,
                pinPlayer: data?.pinPlayer === true,
            };
        }

        // Jalur fallback JSON legacy tidak menyimpan opsi ChatPlay.
        return { ...CHAT_PLAY_DEFAULT_OPTIONS };
    }

    public async setChatPlayOptions(
        guild: Guild,
        options: Partial<ChatPlayOptions>,
    ): Promise<void> {
        const botId = this.client.user?.id ?? "unknown";

        if (hasSaveRequestChannel(this.client.data)) {
            const current = this.client.data.getRequestChannel(guild.id, botId);
            await this.client.data.saveRequestChannel(
                guild.id,
                botId,
                current?.channelId ?? this.getRequestChannel(guild)?.id ?? null,
                current?.messageId ?? null,
                options,
            );
            if (typeof this.client.data.load === "function") {
                await this.client.data.load();
            }
            return;
        }

        const fallback = this.client.data as FallbackDataManager;
        const currentData = fallback.data ?? {};
        const guildData = currentData[guild.id] ?? {};
        guildData.requestChannel ??= { channelId: null, messageId: null };
        this.client.logger.debug(
            "[RequestChannel] ChatPlay options ignored on legacy JSON data manager",
        );
    }

    public getSuggestions(guildId: string): Song[] {
        return this.suggestionsCache.get(guildId) ?? [];
    }

    private async refreshSuggestions(guild: Guild): Promise<void> {
        const queue = guild.queue;
        const currentSong = queue?.getCurrentSong() ?? null;
        if (!queue || !currentSong) {
            this.suggestionsCache.delete(guild.id);
            return;
        }

        try {
            const suggestions = await queue.engine.resolveSuggestions(currentSong.song);
            this.suggestionsCache.set(guild.id, suggestions);
        } catch {
            this.suggestionsCache.delete(guild.id);
        }
        this.suggestionsForKeys.set(guild.id, currentSong.key);
        await this.updatePlayerMessage(guild);
    }

    private manageProgressRefresh(guild: Guild): void {
        const queue = guild.queue;
        const shouldRefresh =
            queue?.playing === true &&
            queue.songs.size > 0 &&
            this.getRequestChannel(guild) !== null;

        if (!shouldRefresh) {
            this.stopProgressRefresh(guild.id);
            return;
        }

        const currentKey = queue?.getCurrentSong()?.key;
        if (currentKey && this.suggestionsForKeys.get(guild.id) !== currentKey) {
            this.suggestionsForKeys.set(guild.id, currentKey);
            void this.refreshSuggestions(guild);
        }

        if (!this.progressRefreshIntervals.has(guild.id)) {
            const interval = setInterval(() => {
                void this.refreshPlayerCard(guild);
            }, this.progressRefreshIntervalMs);
            this.progressRefreshIntervals.set(guild.id, interval);
        }
    }

    private stopProgressRefresh(guildId: string): void {
        const interval = this.progressRefreshIntervals.get(guildId);
        if (interval) {
            clearInterval(interval);
            this.progressRefreshIntervals.delete(guildId);
        }
    }

    private async refreshPlayerCard(guild: Guild): Promise<void> {
        try {
            if (guild.queue?.playing !== true) {
                this.stopProgressRefresh(guild.id);
                return;
            }
            const message = await this.getPlayerMessage(guild);
            if (!message) {
                return;
            }
            await message.edit(await this.createPlayerMessageEditOptions(guild));
        } catch (error) {
            this.client.logger.debug(
                `[RequestChannel] Failed to refresh musicard: ${(error as Error).message}`,
            );
        }
    }

    public createPlayerComponents(
        guild: Guild,
        cardAttachment: AttachmentBuilder | null = null,
    ): APIMessageTopLevelComponent[] {
        const queue = guild.queue;

        const botId = this.client.user?.id ?? "unknown";
        let savedState: {
            loopMode?: string;
            shuffle?: boolean;
            autoplay?: boolean;
            volume?: number;
            filters?: Record<string, boolean>;
        } | null = null;

        if (hasGetPlayerState(this.client.data)) {
            savedState = this.client.data.getPlayerState(guild.id, botId) ?? null;
        } else {
            const fallback = this.client.data as FallbackDataManager;
            savedState = fallback.data?.[guild.id]?.playerState ?? null;
        }

        const bs = this.client.data.botSettings;
        const splash = this.getSafeImageUrl(bs.requestChannelSplash);

        const __ = i18n__(this.client, guild);
        const __mf = i18n__mf(this.client, guild);
        const guildIcon = this.getSafeImageUrl(guild.iconURL({ size: 2_048 }) ?? splash);

        if (!queue || queue.songs.size === 0) {
            const savedLoopMode = savedState?.loopMode ?? "OFF";
            const savedShuffle = savedState?.shuffle ?? false;
            const savedAutoPlay = savedState?.autoplay ?? false;
            const savedVolume = savedState?.volume ?? bs.defaultVolume;

            return this.createPlayerContainer(guild, {
                imageUrl: splash,
                cardImageUrl: null,
                mainText: `### ${__("requestChannel.standby")}`,
                queueText: this.formatQueueFooter(0, "0:00", savedAutoPlay, __, __mf),
                requesterText: null,
                imageMode: "gallery",
                statusItems: [
                    {
                        label: __("requestChannel.status"),
                        value: `▶️ ${savedLoopMode}`,
                    },
                    {
                        label: __("requestChannel.shuffle"),
                        value: `🔀 ${savedShuffle ? "ON" : "OFF"}`,
                    },
                    {
                        label: __("requestChannel.volume"),
                        value: `🔊 ${savedVolume}%`,
                    },
                ],
                autoPlayItem: {
                    label: __("requestChannel.autoplay"),
                    value: savedAutoPlay ? "ON" : "OFF",
                },
                thumbnailUrl: guildIcon,
                title: __("requestChannel.title"),
            });
        }

        const queueSong = queue.getCurrentSong();
        const song = queueSong?.song;

        const duration = song?.duration ?? 0;
        const isLive = song?.isLive === true;

        const loopModeEmoji: Record<string, string> = {
            OFF: "▶️",
            SONG: "🔂",
            QUEUE: "🔁",
        };

        const statusEmoji = queue.isPaused ? "⏸️" : "▶️";
        const loopEmoji = loopModeEmoji[queue.loopMode] ?? "▶️";

        const hasThumbnail = (song?.thumbnail?.length ?? 0) > 0;
        const imageUrl = this.getSafeImageUrl(
            hasThumbnail ? getMaxResThumbnail(song?.thumbnail) : splash,
        );

        const totalQueueDuration = queue.songs
            .map((s) => s.song.duration)
            .reduce((acc, dur) => acc + dur, 0);

        let mainText: string;
        if (song) {
            let durationLine: string;
            if (isLive) {
                durationLine = `🔴 **\`${__("requestChannel.live")}\`**`;
            } else {
                const songDurationStr = duration > 0 ? normalizeTime(duration) : "--:--";
                durationLine = `${statusEmoji} ${__("requestChannel.songDuration")}: **\`${songDurationStr}\`**`;
            }

            const linkLabel = (song.title ?? "")
                .replace(/\p{Extended_Pictographic}/gu, "")
                .replaceAll("[", "\u200b[")
                .replaceAll("]", "]\u200b")
                .replace(/\s{2,}/gu, " ")
                .trim();
            const linkUrl = encodeURI(song.url ?? "")
                .replaceAll("(", "%28")
                .replaceAll(")", "%29");
            mainText = `### [${linkLabel || (song.title ?? "")}](${linkUrl})\n\n${durationLine}`;
        } else {
            const standbyLine = `${statusEmoji} ${__("requestChannel.standby")}`;
            mainText = standbyLine;
        }

        const shuffleState = queue.shuffle ? "ON" : "OFF";

        const queueDurationStr =
            totalQueueDuration > 0 ? formatDuration(totalQueueDuration) : "0:00";
        const queueText = this.formatQueueFooter(
            queue.songs.size.toString(),
            queueDurationStr,
            queue.autoPlay,
            __,
            __mf,
        );

        return this.createPlayerContainer(guild, {
            imageUrl,
            cardImageUrl: cardAttachment === null ? null : "attachment://musicard.png",
            mainText,
            queueText,
            requesterText: song
                ? `${__("requestChannel.requestedBy")}: ${queueSong?.requester.toString() ?? __("requestChannel.unknown")}`
                : null,
            imageMode: "gallery",
            statusItems: [
                {
                    label: __("requestChannel.status"),
                    value: `${loopEmoji} ${queue.loopMode}`,
                },
                {
                    label: __("requestChannel.shuffle"),
                    value: `🔀 ${shuffleState}`,
                },
                {
                    label: __("requestChannel.volume"),
                    value: `🔊 ${queue.volume}%`,
                },
            ],
            autoPlayItem: {
                label: __("requestChannel.autoplay"),
                value: queue.autoPlay ? "ON" : "OFF",
            },
            thumbnailUrl: guildIcon,
            title: __("requestChannel.title"),
        });
    }

    private createPlayerContainer(
        guild: Guild,
        options: {
            imageUrl: string;
            cardImageUrl: string | null;
            mainText: string;
            queueText: string;
            requesterText: string | null;
            imageMode: "gallery" | "thumbnail";
            statusItems: [PlayerStatusGridItem, PlayerStatusGridItem, PlayerStatusGridItem];
            autoPlayItem: PlayerStatusGridItem;
            thumbnailUrl: string;
            title: string;
        },
    ): APIMessageTopLevelComponent[] {
        const [primaryControlsRow, secondaryControlsRow] = this.createPlayerButtonRows(guild);
        const statusRow = this.createPlayerStatusRow(options.statusItems, options.autoPlayItem);
        const [, , volumeStatus] = options.statusItems;
        const volumeText = `🔊 **${volumeStatus.label}:** \`${volumeStatus.value.replace(/^🔊 /u, "")}\``;
        const headerLines = [`## ${options.title}`, options.requesterText, "", volumeText].filter(
            (line): line is string => line !== null,
        );
        const container = new ContainerBuilder()
            .setAccentColor(this.getPlayerAccentColor())
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(headerLines.join("\n")),
                    )
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.thumbnailUrl)),
            )
            .addActionRowComponents(statusRow)
            .addSeparatorComponents(new SeparatorBuilder());

        if (options.imageMode === "thumbnail") {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(options.mainText))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(options.imageUrl)),
            );
        } else {
            container
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(options.mainText))
                .addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(
                            options.cardImageUrl ?? options.imageUrl,
                        ),
                    ),
                );
        }

        container
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(options.queueText))
            .addSeparatorComponents(new SeparatorBuilder());

        const suggestionsRow = this.createSuggestionsRow(guild);
        if (suggestionsRow) {
            container.addActionRowComponents(suggestionsRow);
        }

        container.addActionRowComponents(primaryControlsRow, secondaryControlsRow);

        return [container.toJSON() as APIMessageTopLevelComponent];
    }

    private createPlayerStatusRow(
        items: [PlayerStatusGridItem, PlayerStatusGridItem, PlayerStatusGridItem],
        autoPlayItem: PlayerStatusGridItem,
    ): ActionRowBuilder<ButtonBuilder> {
        const [loopStatus, shuffleStatus] = items;

        return new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("RC_LOOP")
                .setLabel(`${loopStatus.label}: ${loopStatus.value.replace(/^🔁 |^🔂 |^▶️ /u, "")}`)
                .setEmoji("🔁")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("RC_SHUFFLE")
                .setLabel(`${shuffleStatus.label}: ${shuffleStatus.value.replace(/^🔀 /u, "")}`)
                .setEmoji("🔀")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("RC_AUTOPLAY")
                .setLabel(`${autoPlayItem.label}: ${autoPlayItem.value}`)
                .setEmoji("♾️")
                .setStyle(ButtonStyle.Secondary),
        );
    }

    private async renderPlayerCard(guild: Guild): Promise<AttachmentBuilder | null> {
        const queue = guild.queue;
        const currentSong = queue?.getCurrentSong() ?? null;
        if (!queue || !currentSong || queue.playing !== true) {
            return null;
        }
        const song = currentSong.song;
        if (song.isLive === true) {
            return null;
        }
        return renderMusicCard({
            title: song.title,
            author: song.author ?? "",
            artwork: song.thumbnail ?? null,
            positionSeconds: queue.getCurrentPosition(),
            durationSeconds: song.duration ?? 0,
        });
    }

    private async createPlayerMessageCreateOptions(guild: Guild): Promise<MessageCreateOptions> {
        const card = await this.renderPlayerCard(guild);
        return {
            flags: MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2,
            components: this.createPlayerComponents(guild, card),
            files: card === null ? [] : [card],
        };
    }

    private async createPlayerMessageEditOptions(guild: Guild): Promise<MessageEditOptions> {
        const card = await this.renderPlayerCard(guild);
        return {
            embeds: [],
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
            components: this.createPlayerComponents(guild, card),
            files: card === null ? [] : [card],
        };
    }

    private createSuggestionsRow(guild: Guild): ActionRowBuilder<StringSelectMenuBuilder> | null {
        const suggestions = this.suggestionsCache.get(guild.id) ?? [];
        if (suggestions.length === 0) {
            return null;
        }

        const __ = i18n__(this.client, guild);
        const menu = new StringSelectMenuBuilder()
            .setCustomId("RC_SONG_SUGGESTION")
            .setPlaceholder(`🎵 ${__("requestChannel.suggestions")}`)
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                ...suggestions.slice(0, 10).map((song, index) => ({
                    label: (song.title || "Unknown").slice(0, 100),
                    description: (song.author ?? "").slice(0, 100),
                    value: String(index),
                })),
            );

        return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    }

    private createPlayerButtonRows(
        guild: Guild,
    ): [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>] {
        const queue = guild.queue;

        const isPlaying = queue?.playing ?? false;

        const pauseResumeEmoji = isPlaying ? "⏸️" : "▶️";

        const primaryControlsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("RC_PAUSE_RESUME")
                .setEmoji(pauseResumeEmoji)
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("RC_SKIP").setEmoji("⏭️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("RC_STOP").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
        );

        const secondaryControlsRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("RC_VOL_DOWN")
                .setEmoji("🔉")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId("RC_VOL_UP")
                .setEmoji("🔊")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("RC_REMOVE").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("RC_QUEUE")
                .setEmoji("📜")
                .setStyle(ButtonStyle.Secondary),
        );

        return [primaryControlsRow, secondaryControlsRow];
    }

    private hasPlayerControls(message: Message): boolean {
        return message.components.some((component) =>
            this.hasComponentCustomId(component, "RC_PAUSE_RESUME"),
        );
    }

    public isPlayerControlMessage(message: Message): boolean {
        return message.author.id === this.client.user?.id && this.hasPlayerControls(message);
    }

    private hasComponentCustomId(component: unknown, customId: string): boolean {
        if (typeof component !== "object" || component === null) {
            return false;
        }

        if ("customId" in component && component.customId === customId) {
            return true;
        }

        if ("components" in component && Array.isArray(component.components)) {
            return component.components.some((child) => this.hasComponentCustomId(child, customId));
        }

        return false;
    }

    private async findPlayerMessages(
        channel: TextChannel | VoiceChannel | StageChannel,
    ): Promise<Message[]> {
        try {
            const recent = await channel.messages.fetch({ limit: 100 });
            return recent
                .filter(
                    (msg) => msg.author.id === this.client.user?.id && this.hasPlayerControls(msg),
                )
                .map((message) => message)
                .sort(
                    (a: Message, b: Message) =>
                        (b.createdTimestamp ?? b.editedTimestamp ?? 0) -
                        (a.createdTimestamp ?? a.editedTimestamp ?? 0),
                );
        } catch {
            return [];
        }
    }

    private async pruneDuplicatePlayerMessages(
        guild: Guild,
        channel: TextChannel | VoiceChannel | StageChannel,
        preferredMessage?: Message | null,
    ): Promise<Message | null> {
        const playerMessages = await this.findPlayerMessages(channel);

        const preferredOwnMessage =
            preferredMessage &&
            preferredMessage.author.id === this.client.user?.id &&
            preferredMessage.channelId === channel.id
                ? preferredMessage
                : null;

        const canonicalMessage = playerMessages[0] ?? preferredOwnMessage;
        if (!canonicalMessage) {
            return null;
        }

        const duplicateMessages = playerMessages.filter(
            (message) => message.id !== canonicalMessage.id,
        );
        if (preferredOwnMessage && preferredOwnMessage.id !== canonicalMessage.id) {
            duplicateMessages.push(preferredOwnMessage);
        }

        for (const duplicateMessage of duplicateMessages) {
            await duplicateMessage.delete().catch(() => null);
        }

        await this.setPlayerMessageId(guild, canonicalMessage.id);
        return canonicalMessage;
    }

    public async updatePlayerMessage(guild: Guild, immediate = false): Promise<void> {
        const existingTimeout = this.pendingUpdates.get(guild.id);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            this.pendingUpdates.delete(guild.id);
        }

        const generation = (this.updateGenerations.get(guild.id) ?? 0) + 1;
        this.updateGenerations.set(guild.id, generation);

        const performUpdate = async (): Promise<void> => {
            this.pendingUpdates.delete(guild.id);
            if (this.updateGenerations.get(guild.id) !== generation) {
                return;
            }

            try {
                const configuredChannelId = this.getConfiguredRequestChannelId(guild);
                const channel = this.getRequestChannel(guild);
                const hasActiveQueue = !!guild.queue && guild.queue.songs.size > 0;

                if (!this.isPrimaryBot() && !hasActiveQueue) {
                    await this.deletePlayerMessage(guild);
                    return;
                }

                if (!channel) {
                    if (configuredChannelId) {
                        const __ = i18n__(this.client, guild);
                        const botMention = this.client.user ? `<@${this.client.user.id}>` : "";
                        const prefixLine = botMention.length > 0 ? `${botMention}\n` : "";

                        await this.notifyRequestChannelPermissionIssue(
                            guild,
                            configuredChannelId,
                            `${prefixLine}<#${configuredChannelId}>\n${__("commands.music.requestChannel.noBotPermissions")}`,
                            "channel-unavailable",
                        );

                        this.client.logger.warn(
                            `[RequestChannel] ${this.client.user?.tag} cannot access configured request channel ${configuredChannelId} in guild ${guild.id}`,
                        );
                    }
                    return;
                }

                const missingPermissions = this.getMissingRequestChannelPermissions(guild, channel);
                if (missingPermissions.length > 0) {
                    const __mf = i18n__mf(this.client, guild);
                    const permissionNames = missingPermissions
                        .map((permission) => this.formatPermissionName(permission))
                        .join(", ");
                    const botMention = this.client.user ? `<@${this.client.user.id}>` : "";
                    const prefixLine = botMention.length > 0 ? `${botMention}\n` : "";

                    await this.notifyRequestChannelPermissionIssue(
                        guild,
                        channel.id,
                        `${prefixLine}<#${channel.id}>\n${__mf(
                            "commands.music.requestChannel.missingBotPermissions",
                            {
                                permissions: permissionNames,
                            },
                        )}`,
                        "missing-permissions",
                    );

                    this.client.logger.warn(
                        `[RequestChannel] ${this.client.user?.tag} missing permissions in ${channel.id}: ${permissionNames}`,
                    );
                    return;
                }

                if (this.updateGenerations.get(guild.id) !== generation) {
                    return;
                }

                const trackedMessage = await this.getPlayerMessage(guild).catch(() => null);
                if (this.updateGenerations.get(guild.id) !== generation) {
                    return;
                }

                const message = await this.pruneDuplicatePlayerMessages(
                    guild,
                    channel,
                    trackedMessage,
                );

                if (this.updateGenerations.get(guild.id) !== generation) {
                    return;
                }

                if (!message) {
                    if (hasActiveQueue) {
                        await this.createOrUpdatePlayerMessage(guild, true);
                    }

                    return;
                }

                if (message.author.id !== this.client.user?.id) {
                    this.client.logger.debug(
                        `[MultiBot] ${this.client.user?.tag} cannot edit message ${message.id} - created by ${message.author.tag}`,
                    );
                    if (hasActiveQueue) {
                        await this.createOrUpdatePlayerMessage(guild, true);
                    }
                    return;
                }

                try {
                    await message.edit(await this.createPlayerMessageEditOptions(guild));
                } catch (error) {
                    if (this.isPermissionError(error)) {
                        const __ = i18n__(this.client, guild);
                        const botMention = this.client.user ? `<@${this.client.user.id}>` : "";
                        const prefixLine = botMention.length > 0 ? `${botMention}\n` : "";
                        await this.notifyRequestChannelPermissionIssue(
                            guild,
                            channel.id,
                            `${prefixLine}<#${channel.id}>\n${__("commands.music.requestChannel.noBotPermissions")}`,
                            "edit-permission-error",
                        );
                    }

                    this.client.logger.debug(
                        `Failed to update player message: ${(error as Error).message}`,
                    );
                }

                this.manageProgressRefresh(guild);
            } catch (error) {
                this.client.logger.debug(
                    `Error in updatePlayerMessage: ${(error as Error).message}`,
                );
            }
        };

        if (immediate) {
            await performUpdate();
        } else {
            const timeout = setTimeout(() => {
                void performUpdate();
            }, this.updateDebounceMs);
            this.pendingUpdates.set(guild.id, timeout);
        }
    }

    public async createOrUpdatePlayerMessage(
        guild: Guild,
        allowCreate = false,
    ): Promise<Message | null> {
        const configuredChannelId = this.getConfiguredRequestChannelId(guild);
        const channel = this.getRequestChannel(guild);
        const hasActiveQueue = !!guild.queue && guild.queue.songs.size > 0;

        if (this.client.config.isMultiBot && !this.isPrimaryBot() && !hasActiveQueue) {
            await this.deletePlayerMessage(guild);
            return null;
        }

        if (!channel) {
            if (configuredChannelId) {
                const __ = i18n__(this.client, guild);
                const botMention = this.client.user ? `<@${this.client.user.id}>` : "";
                const prefixLine = botMention.length > 0 ? `${botMention}\n` : "";

                await this.notifyRequestChannelPermissionIssue(
                    guild,
                    configuredChannelId,
                    `${prefixLine}<#${configuredChannelId}>\n${__("commands.music.requestChannel.noBotPermissions")}`,
                    "channel-unavailable-create",
                );

                this.client.logger.warn(
                    `[RequestChannel] ${this.client.user?.tag} cannot access configured request channel ${configuredChannelId} in guild ${guild.id}`,
                );
            }
            return null;
        }

        const missingPermissions = this.getMissingRequestChannelPermissions(guild, channel);
        if (missingPermissions.length > 0) {
            const __mf = i18n__mf(this.client, guild);
            const permissionNames = missingPermissions
                .map((permission) => this.formatPermissionName(permission))
                .join(", ");
            const botMention = this.client.user ? `<@${this.client.user.id}>` : "";
            const prefixLine = botMention.length > 0 ? `${botMention}\n` : "";

            await this.notifyRequestChannelPermissionIssue(
                guild,
                channel.id,
                `${prefixLine}<#${channel.id}>\n${__mf(
                    "commands.music.requestChannel.missingBotPermissions",
                    {
                        permissions: permissionNames,
                    },
                )}`,
                "missing-permissions-create",
            );

            this.client.logger.warn(
                `[RequestChannel] ${this.client.user?.tag} missing permissions in ${channel.id}: ${permissionNames}`,
            );
            return null;
        }

        const trackedMessage = await this.getPlayerMessage(guild).catch(() => null);
        let message = await this.pruneDuplicatePlayerMessages(guild, channel, trackedMessage);

        try {
            if (message && message.author.id === this.client.user?.id) {
                await message.edit(await this.createPlayerMessageEditOptions(guild));
            } else if (allowCreate) {
                message = await channel.send(await this.createPlayerMessageCreateOptions(guild));
                await this.setPlayerMessageId(guild, message.id);
                if (this.getRequestChannelOptions(guild).pinPlayer) {
                    void message.pin().catch(() => null);
                }
            } else {
                return null;
            }
            this.manageProgressRefresh(guild);
            return message;
        } catch (error) {
            if (this.isPermissionError(error)) {
                const __ = i18n__(this.client, guild);
                const botMention = this.client.user ? `<@${this.client.user.id}>` : "";
                const prefixLine = botMention.length > 0 ? `${botMention}\n` : "";
                await this.notifyRequestChannelPermissionIssue(
                    guild,
                    channel.id,
                    `${prefixLine}<#${channel.id}>\n${__("commands.music.requestChannel.noBotPermissions")}`,
                    "create-permission-error",
                );
            }

            this.client.logger.debug(
                `Failed to create/update player message: ${(error as Error).message}`,
            );
            return null;
        }
    }

    public async deletePlayerMessage(guild: Guild): Promise<void> {
        this.stopProgressRefresh(guild.id);
        this.suggestionsCache.delete(guild.id);
        this.suggestionsForKeys.delete(guild.id);

        const existingMessage = await this.getPlayerMessage(guild);
        if (existingMessage && existingMessage.author.id === this.client.user?.id) {
            await existingMessage.delete().catch(() => null);
        }

        const channel = this.getRequestChannel(guild);
        if (channel) {
            const leftover = await this.findPlayerMessages(channel);
            for (const message of leftover) {
                if (message.id === existingMessage?.id) {
                    continue;
                }
                await message.delete().catch(() => null);
            }
        }

        this.rememberPlayerMessageId(guild.id, null);
        if (this.ownsConfiguredRequestChannel(guild) || this.isPrimaryBot()) {
            await this.setPlayerMessageId(guild, null);
        }
    }

    public isRequestChannel(guild: Guild, channelId: string): boolean {
        if (this.client.config.isMultiBot) {
            const bots = this.client.multiBotManager.getBotsInGuild(guild);

            for (const bot of bots) {
                const botId = bot.botId;
                if (hasGetRequestChannel(bot.client.data)) {
                    const data = bot.client.data.getRequestChannel(guild.id, botId);
                    if (data?.channelId === channelId) {
                        this.client.logger.debug(
                            `[MultiBot] ${this.client.user?.tag} checking request channel: channelId=${channelId}, isRequest=true (owned by bot ${botId})`,
                        );
                        return true;
                    }
                } else {
                    const fallback = bot.client.data as FallbackDataManager;
                    const data = fallback.data?.[guild.id]?.requestChannel;
                    if (data?.channelId === channelId) {
                        this.client.logger.debug(
                            `[MultiBot] ${this.client.user?.tag} checking request channel: channelId=${channelId}, isRequest=true (owned by bot ${botId})`,
                        );
                        return true;
                    }
                }
            }

            this.client.logger.debug(
                `[MultiBot] ${this.client.user?.tag} checking request channel: channelId=${channelId}, isRequest=false (no bot has this channel)`,
            );
            return false;
        }

        const botId = this.client.user?.id ?? "unknown";
        if (hasGetRequestChannel(this.client.data)) {
            const data = this.client.data.getRequestChannel(guild.id, botId);
            const isRequest = data?.channelId === channelId;
            this.client.logger.debug(
                `[MultiBot] ${this.client.user?.tag} checking request channel using own data: channelId=${channelId}, isRequest=${isRequest}`,
            );
            return isRequest;
        }

        const fallback = this.client.data as FallbackDataManager;
        const data = fallback.data?.[guild.id]?.requestChannel;
        const isRequest = data?.channelId === channelId;
        this.client.logger.debug(
            `[MultiBot] ${this.client.user?.tag} checking request channel using own data (JSON): channelId=${channelId}, isRequest=${isRequest}`,
        );
        return isRequest;
    }
}

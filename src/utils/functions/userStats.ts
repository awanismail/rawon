export const TITLE_TIERS = [
    { minPlays: 0, key: "newListener" },
    { minPlays: 25, key: "musicEnjoyer" },
    { minPlays: 100, key: "audiophile" },
    { minPlays: 500, key: "melomaniac" },
    { minPlays: 1000, key: "musicLegend" },
] as const;

export type TitleTier = (typeof TITLE_TIERS)[number];

export function getTitleTier(playCount: number): TitleTier {
    let current: TitleTier = TITLE_TIERS[0];
    for (const tier of TITLE_TIERS) {
        if (playCount >= tier.minPlays) {
            current = tier;
        }
    }
    return current;
}

export function getNextTitleTier(playCount: number): TitleTier | null {
    for (const tier of TITLE_TIERS) {
        if (playCount < tier.minPlays) {
            return tier;
        }
    }
    return null;
}

export function getTitlePhrase(playCount: number): string {
    return `commands.music.titles.${getTitleTier(playCount).key}`;
}

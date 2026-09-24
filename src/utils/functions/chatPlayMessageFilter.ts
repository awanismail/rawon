/**
 * Filter pintar ChatPlay — dipindah dari musicify
 * (src/utils/chatPlayMessageFilter.js) tanpa perubahan heuristik.
 * Menolak pesan yang jelas-jelas obrolan (slang, emoji, tanda baca, mention)
 * agar hanya permintaan lagu yang diproses di mode `chat`.
 */

const CHAT_BLOCKLIST = new Set([
    "lol",
    "lmao",
    "lmfao",
    "rofl",
    "brb",
    "gtg",
    "g2g",
    "bbl",
    "ttyl",
    "afk",
    "ty",
    "thx",
    "thanks",
    "np",
    "nvm",
    "idk",
    "ikr",
    "tbh",
    "imo",
    "imho",
    "gg",
    "rip",
    "oof",
    "ok",
    "k",
    "kk",
    "yes",
    "no",
    "yep",
    "nah",
    "yea",
    "yup",
    "nope",
    "hi",
    "sup",
    "yo",
    "wtf",
    "wth",
    "omg",
    "omfg",
    "hmm",
    "mhm",
    "ugh",
    "meh",
    "gn",
    "gm",
    "same",
    "true",
    "false",
    "maybe",
    "sure",
    "fr",
    "ong",
    "bet",
    "cap",
    "sus",
    "ratio",
    "l",
    "w",
    "+1",
    "-1",
]);

const URL_PATTERN =
    /(?:https?:\/\/|spotify:|soundcloud\.com|deezer\.com|music\.apple\.com|music\.youtube\.com|tidal\.com)/i;
const DISCORD_MENTION_PATTERN = /^<(@[!&]?|#\d+|@everyone|@here)/;
const CUSTOM_EMOJI_PATTERN = /^<a?:\w+:\d+>$/;
const UNICODE_EMOJI_PATTERN = /^(?:\p{Extended_Pictographic}|\u200d|\ufe0f|\u20e3|\s)+$/u;
const PUNCTUATION_ONLY_PATTERN = /^[\s\p{P}\p{S}]+$/u;

const SINGLE_TOKEN_MAX_LENGTH = 12;

export function normalizeChatToken(text: string): string {
    return text
        .toLowerCase()
        .replace(/[\s._\-!?,…]+/gu, "")
        .replace(/(.)\1+/gu, "$1");
}

export function isBlockedChatToken(text: string): boolean {
    const normalized = normalizeChatToken(text);
    return normalized.length <= SINGLE_TOKEN_MAX_LENGTH && CHAT_BLOCKLIST.has(normalized);
}

export function isLikelySongRequest(content: string): boolean {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
        return false;
    }

    // Link musik selalu diizinkan.
    if (URL_PATTERN.test(trimmed)) {
        return true;
    }

    if (UNICODE_EMOJI_PATTERN.test(trimmed) || CUSTOM_EMOJI_PATTERN.test(trimmed)) {
        return false;
    }

    if (PUNCTUATION_ONLY_PATTERN.test(trimmed)) {
        return false;
    }

    const stripped = trimmed.replaceAll(/<@&?\d+>/gu, "").trim();
    if (stripped.length === 0 && DISCORD_MENTION_PATTERN.test(trimmed)) {
        return false;
    }

    if (isBlockedChatToken(trimmed)) {
        return false;
    }

    return true;
}

import Bottleneck from "bottleneck";

/**
 * Rate limiting resolve berlapis, dipindah dari musicify:
 * - global : 25 concurent, jarak antar job 25 ms
 * - guild  : 10 concurent, jarak 100 ms
 * - user   : 3 concurent, jarak 500 ms
 * Semua lapisan dipakai bersama (chain) sehingga batas paling ketat yang menang.
 */
const globalLimiter = new Bottleneck({
    maxConcurrent: 25,
    minTime: 25,
});

const guildLimiters = new Map<string, Bottleneck>();
const userLimiters = new Map<string, Bottleneck>();

function getGuildLimiter(guildId: string): Bottleneck {
    let limiter = guildLimiters.get(guildId);
    if (!limiter) {
        limiter = new Bottleneck({ maxConcurrent: 10, minTime: 100 });
        guildLimiters.set(guildId, limiter);
    }
    return limiter;
}

function getUserLimiter(userId: string): Bottleneck {
    let limiter = userLimiters.get(userId);
    if (!limiter) {
        limiter = new Bottleneck({ maxConcurrent: 3, minTime: 500 });
        userLimiters.set(userId, limiter);
    }
    return limiter;
}

export interface ResolveLimitContext {
    guildId?: string;
    userId?: string;
}

export class ResolveRateLimitError extends Error {
    public constructor() {
        super("You are requesting songs too quickly. Please wait a moment and try again.");
        this.name = "ResolveRateLimitError";
    }
}

/**
 * Bungkus sebuah resolve (pencarian/URL) dengan seluruh lapisan limiter.
 * Melempar ResolveRateLimitError saat antrean pengguna penuh.
 */
export async function limitedResolve<T>(
    context: ResolveLimitContext,
    task: () => Promise<T>,
): Promise<T> {
    const chain = globalLimiter.chain();
    const wrapped = context.guildId ? chain.chain(getGuildLimiter(context.guildId)) : chain;
    const finalWrapped = context.userId ? wrapped.chain(getUserLimiter(context.userId)) : wrapped;

    const scheduled = finalWrapped.wrap(task);
    const onRejected = (error: unknown): never => {
        if (error instanceof Bottleneck.BottleneckError) {
            throw new ResolveRateLimitError();
        }
        throw error;
    };

    return scheduled().catch(onRejected);
}

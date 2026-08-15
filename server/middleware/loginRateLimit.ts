/** 登录失败限流：优先使用 Redis，多进程不可用时退回内存计数。 */
import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../utils/redis';

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX || 5);

// 扩展 Express Request 类型。
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      loginRateLimit: {
        markSuccess(): void;
        markFailure(): void;
      };
    }
  }
}

// 内存计数器（默认兜底）。

interface RateRecord {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, RateRecord>();

function getAttemptKey(req: Request): string {
  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  return `${req.ip || 'unknown'}:${username || 'anonymous'}`;
}

function getRecord(key: string, now: number): RateRecord {
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    return { count: 0, resetAt: now + WINDOW_MS };
  }
  return record;
}

// Redis 计数器（可选）。

interface RedisStore {
  getCount(key: string): Promise<number>;
  increment(key: string): Promise<number>;
  reset(key: string): Promise<void>;
  getRetryAfter(key: string): Promise<number>;
}

let redisStore: RedisStore | null | undefined = undefined;

function getRedisStore(): RedisStore | null {
  if (redisStore !== undefined) return redisStore;

  try {
    const redis = getRedis();
    if (!redis) {
      redisStore = null;
      return null;
    }

    redisStore = {
      async getCount(key) {
        const count = await redis!.get(`ratelimit:login:${key}`);
        return count ? Number(count) : 0;
      },
      async increment(key) {
        const redisKey = `ratelimit:login:${key}`;
        const ttlSeconds = Math.ceil(WINDOW_MS / 1000);
        const result = await redis!.multi().incr(redisKey).expire(redisKey, ttlSeconds).exec();
        return result ? Number(result[0]![1]) : 1;
      },
      async reset(key) {
        await redis!.del(`ratelimit:login:${key}`);
      },
      async getRetryAfter(key) {
        const ttl = await redis!.ttl(`ratelimit:login:${key}`);
        return ttl > 0 ? ttl : 0;
      },
    };
    return redisStore;
  } catch {
    redisStore = null;
    return null;
  }
}

// 登录限流中间件。

async function redisLimit(
  store: RedisStore,
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = getAttemptKey(req);
  const count = await store.getCount(key);

  if (count >= MAX_FAILED_ATTEMPTS) {
    const retryAfter = await store.getRetryAfter(key);
    res.set('Retry-After', String(retryAfter));
    res.fail('Too many login attempts. Please try again later.', 429, {
      retryAfterSeconds: retryAfter,
    });
    return;
  }

  req.loginRateLimit = {
    markSuccess() {
      store.reset(key).catch(() => {});
    },
    markFailure() {
      store.increment(key).catch(() => {});
    },
  };

  next();
}

function memoryLimit(req: Request, res: Response, next: NextFunction): void {
  const key = getAttemptKey(req);
  const now = Date.now();
  const record = getRecord(key, now);

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    res.fail('Too many login attempts. Please try again later.', 429, {
      retryAfterSeconds,
    });
    return;
  }

  req.loginRateLimit = {
    markSuccess() {
      attempts.delete(key);
    },
    markFailure() {
      const current = getRecord(key, Date.now());
      attempts.set(key, {
        count: current.count + 1,
        resetAt: current.resetAt,
      });
    },
  };

  next();
}

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const store = getRedisStore();

  if (store) {
    redisLimit(store, req, res, next);
    return;
  }

  memoryLimit(req, res, next);
}

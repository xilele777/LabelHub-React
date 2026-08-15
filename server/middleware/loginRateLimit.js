/** 登录失败限流：优先使用 Redis，多进程不可用时退回内存计数。 */
const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const MAX_FAILED_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX || 5);

// 内存计数器（默认兜底）。
const attempts = new Map();

function getAttemptKey(req) {
  const username =
    typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  return `${req.ip || 'unknown'}:${username || 'anonymous'}`;
}

function getRecord(key, now) {
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    return { count: 0, resetAt: now + WINDOW_MS };
  }
  return record;
}

// Redis 计数器（可选）。

let redisStore = null;

function getRedisStore() {
  if (redisStore !== undefined) return redisStore;

  try {
    const { getRedis } = require('../utils/redis');
    const redis = getRedis();
    if (!redis) {
      redisStore = null;
      return null;
    }

    redisStore = {
      async getCount(key) {
        const count = await redis.get(`ratelimit:login:${key}`);
        return count ? Number(count) : 0;
      },

      async increment(key) {
        const redisKey = `ratelimit:login:${key}`;
        const ttlSeconds = Math.ceil(WINDOW_MS / 1000);
        // 使用 multi 保证计数和过期时间一起写入。
        const count = await redis.multi().incr(redisKey).expire(redisKey, ttlSeconds).exec();
        return count ? Number(count[0][1]) : 1;
      },

      async reset(key) {
        await redis.del(`ratelimit:login:${key}`);
      },

      async getRetryAfter(key) {
        const ttl = await redis.ttl(`ratelimit:login:${key}`);
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

function loginRateLimit(req, res, next) {
  const store = getRedisStore();

  if (store) {
    // Redis 模式。
    return redisLimit(store, req, res, next);
  }

  // 内存模式。
  return memoryLimit(req, res, next);
}

async function redisLimit(store, req, res, next) {
  const key = getAttemptKey(req);
  const count = await store.getCount(key);

  if (count >= MAX_FAILED_ATTEMPTS) {
    const retryAfter = await store.getRetryAfter(key);
    res.set('Retry-After', String(retryAfter));
    return res.fail('Too many login attempts. Please try again later.', 429, {
      retryAfterSeconds: retryAfter,
    });
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

function memoryLimit(req, res, next) {
  const key = getAttemptKey(req);
  const now = Date.now();
  const record = getRecord(key, now);

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    return res.fail('Too many login attempts. Please try again later.', 429, {
      retryAfterSeconds,
    });
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

module.exports = {
  loginRateLimit,
};

/**
 * Redis 缓存工具。
 * Redis 不可用时静默降级，业务仍通过数据库正常运行。
 */

const { getRedis } = require('./redis');

const PREFIX = 'cache:';

function _fullKey(key) {
  return `${PREFIX}${key}`;
}

/** 读取并解析缓存，未命中时返回 null。 */
async function cacheGet(key) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(_fullKey(key));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

/** 将值序列化后写入缓存，并设置过期时间。 */
async function cacheSet(key, value, ttlSeconds = 300) {
  const redis = getRedis();
  if (!redis) return;
  try {
    const fullKey = _fullKey(key);
    if (ttlSeconds > 0) {
      await redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
    } else {
      await redis.set(fullKey, JSON.stringify(value));
    }
  } catch (err) {
    // 缓存失败不影响业务读取。
  }
}

/** 删除指定缓存。 */
async function cacheDel(key) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(_fullKey(key));
  } catch (err) {
    // 缓存失败不影响业务写入。
  }
}

/** 按通配模式批量删除缓存，并返回删除数量。 */
async function cacheDelPattern(pattern) {
  const redis = getRedis();
  if (!redis) return 0;
  try {
    const fullPattern = _fullKey(pattern);
    const keys = await redis.keys(fullPattern);
    if (keys.length > 0) {
      return await redis.del(...keys);
    }
    return 0;
  } catch (err) {
    return 0;
  }
}

/** 先读缓存，未命中时执行回调并缓存结果。 */
async function cacheWrap(key, ttlSeconds, fn) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  const result = await fn();
  if (result !== null && result !== undefined) {
    await cacheSet(key, result, ttlSeconds);
  }
  return result;
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPattern, cacheWrap };

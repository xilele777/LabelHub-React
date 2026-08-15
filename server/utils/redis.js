/**
 * Redis 懒加载单例，为缓存、限流和 WebSocket 多进程适配器提供连接。
 * 通过 REDIS_URL 控制是否启用，未配置时由调用方降级。
 */

let redis = undefined; // undefined = 未初始化, null = 不可用, object = 已连接
let connecting = false;

/**
 * 获取 Redis 客户端（懒初始化）
 * @returns {import('ioredis').Redis|null} Redis 实例或 null
 */
function getRedis() {
  if (redis !== undefined) return redis;

  const url = process.env.REDIS_URL;
  if (!url) {
    redis = null;
    return null;
  }

  // 避免并发调用时重复连接
  if (connecting) return null;
  connecting = true;

  try {
    // 延迟 require，避免未安装 ioredis 时启动报错
    const Redis = require('ioredis');
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) {
          console.error('[Redis] 重试次数已达上限，放弃连接');
          return null; // 停止重试
        }
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    client.on('error', (err) => {
      console.error('[Redis] 连接错误:', err.message);
    });

    client.on('connect', () => {
      console.log('[Redis] 已连接');
    });

    redis = client;
    return client;
  } catch (err) {
    console.error('[Redis] 初始化失败:', err.message);
    redis = null;
    return null;
  } finally {
    connecting = false;
  }
}

/**
 * 检查 Redis 是否可用
 * @returns {boolean}
 */
function isRedisAvailable() {
  return getRedis() !== null;
}

/**
 * 安全关闭 Redis 连接
 */
async function closeRedis() {
  if (redis && redis !== null) {
    try {
      await redis.quit();
      console.log('[Redis] 连接已关闭');
    } catch (err) {
      console.error('[Redis] 关闭连接失败:', err.message);
      redis.disconnect();
    }
  }
  redis = undefined;
}

module.exports = { getRedis, isRedisAvailable, closeRedis };

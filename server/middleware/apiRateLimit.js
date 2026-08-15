/**
 * API 分层限流中间件。
 * 全局按 IP 限流，敏感操作使用更严格配置；Redis 不可用时退回内存存储。
 */

const rateLimit = require('express-rate-limit');
const { getRedis } = require('../utils/redis');

let RedisStore;
try {
  RedisStore = require('rate-limit-redis').default;
} catch {
  // 未安装 Redis 存储插件时使用内存限流。
}

// 限流存储工厂。

function createStore() {
  if (RedisStore) {
    const redis = getRedis();
    if (redis) {
      try {
        // rate-limit-redis 新版通过 sendCommand 访问 Redis。
        return new RedisStore({
          sendCommand: (...args) => redis.call(...args),
        });
      } catch (err) {
        // Redis 不可用时回退到内存存储。
      }
    }
  }
  // 默认内存存储，仅适用于单进程。
  return undefined;
}

// 全局限流。

const globalLimiter = rateLimit({
  windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.API_RATE_LIMIT_MAX || 600),
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore(),
  skip: (req) => req.path === '/api/health',
  message: {
    code: 429,
    message: '请求过于频繁，请稍后再试',
    data: null,
  },
});

// 敏感端点限流。

const strictLimiter = (max = 30) =>
  rateLimit({
    windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000),
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: createStore(),
    message: {
      code: 429,
      message: '操作过于频繁，请稍后再试',
      data: null,
    },
  });

// 标注提交和驳回后重提：每分钟 30 次。
const annotationSubmitLimiter = strictLimiter(Number(process.env.API_RATE_LIMIT_ANNOTATION || 30));

// 审核操作：每分钟 30 次。
const reviewActionLimiter = strictLimiter(Number(process.env.API_RATE_LIMIT_REVIEW || 30));

// 用户创建：每分钟 10 次。
const userCreateLimiter = strictLimiter(Number(process.env.API_RATE_LIMIT_USER_CREATE || 10));

// 批量导入：每分钟 5 次。
const batchImportLimiter = strictLimiter(Number(process.env.API_RATE_LIMIT_BATCH_IMPORT || 5));

module.exports = {
  globalLimiter,
  annotationSubmitLimiter,
  reviewActionLimiter,
  userCreateLimiter,
  batchImportLimiter,
};

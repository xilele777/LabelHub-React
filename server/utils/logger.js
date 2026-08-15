/**
 * Pino 结构化日志单例，统一处理日志级别、开发输出和请求上下文。
 */

const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production';
const level = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');

const logger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * 为单个请求创建子日志器（自动注入 requestId）
 * @param {import('express').Request} req
 * @returns {import('pino').Logger}
 */
function childLogger(req) {
  return logger.child({
    requestId: req.requestId || '-',
    method: req.method,
    url: req.originalUrl,
  });
}

module.exports = { logger, childLogger };

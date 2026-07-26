/**
 * 统一日志工具 — 开发环境全量输出，生产构建 tree-shaking 移除 debug 级调用。
 *
 * 使用方式：
 *   import { logger } from '@/utils/logger';
 *   logger.log('[WS] 连接成功');    // 仅 DEV 输出
 *   logger.warn('[WS] 异常');        // 始终输出
 *   logger.error('[WS] 错误');       // 始终输出
 */
/* eslint-disable no-console */
const isDev = import.meta.env.DEV;

export const logger = {
  /** 调试日志：仅开发环境输出，生产构建被 tree-shaking 移除 */
  log(...args: unknown[]): void {
    if (isDev) {
      console.log(...args);
    }
  },

  /** 警告：始终输出（生产环境需保留用于排查） */
  warn(...args: unknown[]): void {
    console.warn(...args);
  },

  /** 错误：始终输出 */
  error(...args: unknown[]): void {
    console.error(...args);
  },
} as const;

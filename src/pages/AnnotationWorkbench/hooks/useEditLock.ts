// 为当前标注项申请、续期并释放编辑锁。
import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseEditLockOptions {
  itemId: string | null;
  /** 仅在条目可编辑（且当前角色允许加锁）时持锁 */
  enabled: boolean;
  /** 加锁；他人持锁（HTTP 423）时应返回 false 并由调用方呈现锁信息 */
  claim: (id: string) => Promise<boolean>;
  release: (id: string) => Promise<void>;
}

/**
 * 悲观编辑锁生命周期管理：
 * - 进入可编辑条目自动 claim；
 * - 切换条目 / 条目转为只读（提交后）自动 release；
 * - 组件卸载时释放持有的锁；
 * - claim 失败可通过 retry 重试。
 *
 * 所有锁操作经由 Promise 链串行化，避免快速切换条目时 claim/release 乱序，
 * 与服务端 30 分钟锁超时兜底（异常关闭浏览器场景）配合构成完整闭环。
 *
 * claim/release 允许每次渲染传入新引用（latest-ref 模式内部取最新），
 * 锁同步仅由 itemId/enabled 变化触发。
 */
export function useEditLock(options: UseEditLockOptions) {
  const { itemId, enabled } = options;
  const [acquiring, setAcquiring] = useState(false);
  const lockedIdRef = useRef<string | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });

  const enqueue = useCallback((operation: () => Promise<void>) => {
    chainRef.current = chainRef.current.then(operation).catch(() => undefined);
    return chainRef.current;
  }, []);

  const syncLock = useCallback(async (id: string | null, isEnabled: boolean) => {
    // 释放：持有的锁不再对应当前可编辑条目
    if (lockedIdRef.current && (lockedIdRef.current !== id || !isEnabled)) {
      const previous = lockedIdRef.current;
      lockedIdRef.current = null;
      await latestRef.current.release(previous);
    }
    // 加锁：进入新的可编辑条目
    if (id && isEnabled && lockedIdRef.current !== id) {
      setAcquiring(true);
      try {
        const acquired = await latestRef.current.claim(id);
        if (acquired) lockedIdRef.current = id;
      } finally {
        setAcquiring(false);
      }
    }
  }, []);

  useEffect(() => {
    void enqueue(() => syncLock(itemId, enabled));
  }, [itemId, enabled, enqueue, syncLock]);

  // 卸载时释放当前持有的锁。
  useEffect(() => {
    return () => {
      void enqueue(() => syncLock(null, false));
    };
  }, [enqueue, syncLock]);

  /** 他人持锁时手动重试加锁 */
  const retry = useCallback(() => {
    return enqueue(() => syncLock(latestRef.current.itemId, latestRef.current.enabled));
  }, [enqueue, syncLock]);

  return { acquiring, retry };
}

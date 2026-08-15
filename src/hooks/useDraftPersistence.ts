// 持久化编辑草稿，并在恢复前校验数据版本。
import { useCallback, useEffect, useRef } from 'react';

export interface DraftRecord<T> {
  /** 保存草稿时对应的服务端数据版本（乐观锁 version），恢复前校验 */
  version: number | string;
  savedAt: number;
  data: T;
}

const DRAFT_PREFIX = 'labelhub:draft:';

export function loadDraft<T>(key: string): DraftRecord<T> | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftRecord<T> | null;
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !('version' in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraftRecord<T>(key: string, record: DraftRecord<T>): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(record));
  } catch {
    // 隐私模式 / 存储配额满时静默失败，不影响主流程
  }
}

export function clearDraftRecord(key: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // 存储不可用时忽略清理失败。
  }
}

export interface UseDraftPersistenceOptions<T> {
  /** 草稿归属键（如数据条目 id）；空值时不做持久化 */
  key: string | null | undefined;
  /** 当前服务端数据版本，用于判断草稿是否过期 */
  version: number | string;
  /** 当前表单快照。 */
  snapshot: T;
  /** 当前条目的服务端快照，用于切换条目时建立保存基线。 */
  baselineSnapshot?: T;
  /** 将草稿写回表单 */
  restore: (data: T) => void;
  onRestored?: (record: DraftRecord<T>) => void;
  debounceMs?: number;
}

/**
 * 本地草稿自动保存与恢复：
 * - 表单变化后防抖写入 localStorage（断网 / 误关页面不丢内容）；
 * - 切换到某条数据时，若存在版本匹配且与当前内容不同的本地草稿则自动恢复；
 * - 服务端版本已前进（他人修改过）的过期草稿自动清理，避免恢复脏数据。
 *
 * 性能策略：
 * - 保存侧用浅比较替代 deep watch：标注表单值均为原始类型，浅比较已覆盖所有变更；
 *   序列化结果直接复用为变更判据，不额外做 deep clone。
 *
 * 注意：恢复依赖 key 变化触发（useEffect [key]）—— 调用方应保证切换条目时
 * 调用方应在切换条目时先完成表单重置，再交给本 Hook 恢复草稿。
 */
export function useDraftPersistence<T>(options: UseDraftPersistenceOptions<T>) {
  const { key, version, snapshot, debounceMs = 500 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSnapshotRef = useRef<string | null>(null);
  const baselineSnapshotRef = useRef<string | null>(null);
  // 首次快照只建立基线，不立即写入；清除草稿后下一次变化仍会正常保存。
  const hasBaselineRef = useRef(false);

  // 通过镜像读取最新参数，避免对象和回调引用变化导致 effect 重复执行。
  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });

  // 条目或服务端版本变化时，取消旧定时器并重新校验草稿。
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!key) {
      hasBaselineRef.current = false;
      lastSnapshotRef.current = null;
      baselineSnapshotRef.current = null;
      return;
    }

    const baseline = latestRef.current.baselineSnapshot ?? latestRef.current.snapshot;
    const serializedBaseline = JSON.stringify(baseline);
    hasBaselineRef.current = true;
    lastSnapshotRef.current = serializedBaseline;
    baselineSnapshotRef.current = serializedBaseline;

    const record = loadDraft<T>(key);
    if (!record) return;
    if (record.version !== latestRef.current.version) {
      clearDraftRecord(key);
      return;
    }
    if (JSON.stringify(record.data) === JSON.stringify(baseline)) return;
    latestRef.current.restore(record.data);
    latestRef.current.onRestored?.(record);
  }, [key, version]);

  // 表单快照变化后防抖写入本地草稿。
  const shallow = key ? JSON.stringify(snapshot) : null;
  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!key || shallow === null) return;
    if (shallow === baselineSnapshotRef.current) {
      lastSnapshotRef.current = shallow;
      clearDraftRecord(key);
      return;
    }
    if (shallow === lastSnapshotRef.current) return;
    lastSnapshotRef.current = shallow;
    if (!hasBaselineRef.current) {
      hasBaselineRef.current = true;
      return;
    }

    timerRef.current = setTimeout(() => {
      saveDraftRecord(key, {
        version: latestRef.current.version,
        savedAt: Date.now(),
        data: latestRef.current.snapshot,
      });
    }, debounceMs);
  }, [key, shallow, debounceMs]);

  // 卸载时取消尚未写入的定时器。
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  /** 服务端保存/提交成功后调用，清理当前条目的本地草稿 */
  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
    lastSnapshotRef.current = JSON.stringify(latestRef.current.snapshot);
    hasBaselineRef.current = true;
    const currentKey = latestRef.current.key;
    if (currentKey) clearDraftRecord(currentKey);
  }, []);

  return { clear };
}

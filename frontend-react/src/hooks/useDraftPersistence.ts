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
    // ignore
  }
}

export interface UseDraftPersistenceOptions<T> {
  /** 草稿归属键（如数据条目 id）；空值时不做持久化 */
  key: string | null | undefined;
  /** 当前服务端数据版本，用于判断草稿是否过期 */
  version: number | string;
  /** 当前表单快照（每次渲染传入最新值，Vue 版的 getter 在 React 中即渲染期求值） */
  snapshot: T;
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
 * 「重置表单」在渲染上游完成，与 Vue 版的 watch 注册顺序约束等价。
 */
export function useDraftPersistence<T>(options: UseDraftPersistenceOptions<T>) {
  const { key, snapshot, debounceMs = 500 } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSnapshotRef = useRef<string | null>(null);
  // 首次快照仅作基线不落盘（对齐 Vue watch 非 immediate）；clear() 只清 lastSnapshot，
  // 基线保持已建立 —— clear 后的下一次表单变化仍应正常保存
  const hasBaselineRef = useRef(false);

  // latest-ref：恢复/保存逻辑总是读取最新的 version/snapshot/回调，
  // 又不把它们放进 effect 依赖（对象/回调每渲染新引用会导致 effect 空转）
  const latestRef = useRef(options);
  useEffect(() => {
    latestRef.current = options;
  });

  // ── 恢复：key 变化（含首次挂载）时尝试恢复版本匹配的草稿 ──
  useEffect(() => {
    if (!key) return;
    // key 变化时重置基线，避免将切换后的首次表单重置误判为用户修改
    hasBaselineRef.current = false;
    lastSnapshotRef.current = null;

    const record = loadDraft<T>(key);
    if (!record) return;
    if (record.version !== latestRef.current.version) {
      clearDraftRecord(key);
      return;
    }
    if (JSON.stringify(record.data) === JSON.stringify(latestRef.current.snapshot)) return;
    latestRef.current.restore(record.data);
    latestRef.current.onRestored?.(record);
  }, [key]);

  // ── 保存：快照浅序列化变化时防抖写入（首次仅记录基线，对齐 Vue watch 非 immediate 语义） ──
  const shallow = key ? JSON.stringify(snapshot) : null;
  useEffect(() => {
    if (!key || shallow === null) return;
    if (shallow === lastSnapshotRef.current) return;
    lastSnapshotRef.current = shallow;
    if (!hasBaselineRef.current) {
      hasBaselineRef.current = true;
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveDraftRecord(key, {
        version: latestRef.current.version,
        savedAt: Date.now(),
        data: latestRef.current.snapshot,
      });
    }, debounceMs);
  }, [key, shallow, debounceMs]);

  // 卸载时取消未落盘的定时器（等价 Vue 版 onScopeDispose）
  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  /** 服务端保存/提交成功后调用，清理当前条目的本地草稿 */
  const clear = useCallback(() => {
    clearTimeout(timerRef.current);
    lastSnapshotRef.current = null;
    const currentKey = latestRef.current.key;
    if (currentKey) clearDraftRecord(currentKey);
  }, []);

  return { clear };
}

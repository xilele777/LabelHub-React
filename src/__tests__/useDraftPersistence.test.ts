// 草稿持久化 Hook 的保存、恢复和版本校验测试。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  clearDraftRecord,
  loadDraft,
  saveDraftRecord,
  useDraftPersistence,
  type DraftRecord,
} from '@/hooks/useDraftPersistence';

describe('draft 存取纯函数', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('save/load/clear 往返一致', () => {
    saveDraftRecord('item1', { version: 3, savedAt: 123, data: { a: 1 } });
    expect(loadDraft('item1')).toEqual({ version: 3, savedAt: 123, data: { a: 1 } });
    clearDraftRecord('item1');
    expect(loadDraft('item1')).toBeNull();
  });

  it('损坏的 JSON 与缺字段记录返回 null', () => {
    localStorage.setItem('labelhub:draft:bad', '{not json');
    expect(loadDraft('bad')).toBeNull();
    localStorage.setItem('labelhub:draft:partial', JSON.stringify({ data: {} }));
    expect(loadDraft('partial')).toBeNull();
  });
});

describe('useDraftPersistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  type Form = Record<string, unknown>;
  interface HookProps {
    draftKey: string | null;
    version: number;
    baseline?: Form;
  }

  function setup() {
    // 用可变对象模拟表单状态，restore 写回后通过重新渲染更新快照。
    const state: Form = {};
    const restoredRecords: DraftRecord<Form>[] = [];

    const hook = renderHook(
      ({ draftKey, version, baseline }: HookProps) =>
        useDraftPersistence<Form>({
          key: draftKey,
          version,
          snapshot: { ...state },
          baselineSnapshot: baseline,
          restore: (data) => Object.assign(state, data),
          onRestored: (record) => restoredRecords.push(record),
          debounceMs: 500,
        }),
      { initialProps: { draftKey: null, version: 1 } as HookProps },
    );

    return { ...hook, state, restoredRecords };
  }

  it('切换 key 时恢复版本匹配的草稿', () => {
    saveDraftRecord('item1', { version: 1, savedAt: 1, data: { label: '草稿内容' } });
    const { rerender, state, restoredRecords } = setup();

    rerender({ draftKey: 'item1', version: 1 });

    expect(state.label).toBe('草稿内容');
    expect(restoredRecords).toHaveLength(1);
  });

  it('版本不匹配的过期草稿被清理且不恢复', () => {
    saveDraftRecord('item2', { version: 99, savedAt: 1, data: { label: '过期草稿' } });
    const { rerender, state } = setup();

    rerender({ draftKey: 'item2', version: 1 });

    expect(state.label).toBeUndefined();
    expect(loadDraft('item2')).toBeNull();
  });

  it('同一条目服务端版本前进时清理旧草稿', () => {
    saveDraftRecord('item-versioned', {
      version: 1,
      savedAt: 1,
      data: { label: '旧草稿' },
    });
    const { rerender, restoredRecords } = setup();

    rerender({ draftKey: 'item-versioned', version: 2 });

    expect(restoredRecords).toHaveLength(0);
    expect(loadDraft('item-versioned')).toBeNull();
  });

  it('使用服务端快照建立基线，不把条目切换时的旧表单写成草稿', () => {
    const { rerender, state } = setup();

    rerender({ draftKey: 'item-baseline', version: 1, baseline: { label: '服务端内容' } });
    state.label = '服务端内容';
    rerender({ draftKey: 'item-baseline', version: 1, baseline: { label: '服务端内容' } });
    vi.advanceTimersByTime(500);

    expect(loadDraft('item-baseline')).toBeNull();
  });

  it('表单变化防抖写入本地草稿', () => {
    const { rerender, state } = setup();
    rerender({ draftKey: 'item3', version: 1 });

    state.label = '输入中';
    rerender({ draftKey: 'item3', version: 1 });
    expect(loadDraft('item3')).toBeNull();

    vi.advanceTimersByTime(500);
    expect(loadDraft<{ label: string }>('item3')?.data.label).toBe('输入中');
  });

  it('clear 清理当前草稿并取消未落盘的定时器', () => {
    const { rerender, result, state } = setup();
    rerender({ draftKey: 'item4', version: 1 });

    state.label = 'x';
    rerender({ draftKey: 'item4', version: 1 });
    result.current.clear();
    vi.advanceTimersByTime(1000);

    expect(loadDraft('item4')).toBeNull();
  });

  it('clear 之后的下一次表单变化仍会防抖保存（基线不回退）', () => {
    const { rerender, result, state } = setup();
    rerender({ draftKey: 'item5', version: 1 });

    state.label = 'a';
    rerender({ draftKey: 'item5', version: 1 });
    vi.advanceTimersByTime(500);
    expect(loadDraft('item5')).not.toBeNull();

    result.current.clear();
    expect(loadDraft('item5')).toBeNull();

    state.label = 'b';
    rerender({ draftKey: 'item5', version: 1 });
    vi.advanceTimersByTime(500);
    expect(loadDraft<{ label: string }>('item5')?.data.label).toBe('b');
  });
});

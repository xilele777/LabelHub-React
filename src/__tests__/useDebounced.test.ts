// 防抖 Hook 的延迟更新与清理测试。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebounced } from '@/hooks/useDebounced';

describe('useDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initialValue: string | undefined, delay: number) {
    return renderHook(({ value }: { value: string | undefined }) => useDebounced(value, delay), {
      initialProps: { value: initialValue },
    });
  }

  it('初始值与 source 一致', () => {
    const { result } = setup('init', 300);
    expect(result.current).toBe('init');
  });

  it('延迟到期前保持旧值，到期后更新', () => {
    const { result, rerender } = setup('', 300);

    rerender({ value: 'a' });
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('a');
  });

  it('延迟窗口内连续变更只保留最后一次', () => {
    const { result, rerender } = setup('', 300);

    rerender({ value: 'a' });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 距离最后一次变更仅 200ms，尚未生效
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('ab');
  });

  it('支持对象属性作为输入值', () => {
    const filters: { keyword?: string } = { keyword: 'x' };
    const { result, rerender } = setup(filters.keyword, 100);
    expect(result.current).toBe('x');

    rerender({ value: 'y' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('y');
  });
});

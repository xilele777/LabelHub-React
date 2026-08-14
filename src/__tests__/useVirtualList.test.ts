// useVirtualList 的可见范围和滚动行为测试。
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVirtualList } from '@/hooks/useVirtualList';

/** 模拟容器滚动事件：scrollTop 与 viewportHeight 均从事件目标读取 */
function fakeScrollEvent(scrollTop: number, clientHeight: number) {
  return { currentTarget: { scrollTop, clientHeight } as unknown as HTMLElement };
}

/** 带可控 clientHeight 的真实 DOM 元素（happy-dom 中 layout 高度恒为 0） */
function createFakeContainer(clientHeight: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  return el;
}

describe('useVirtualList', () => {
  it('固定行高：正确计算总高与可见窗口（含 overscan）', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const { result } = renderHook(() => useVirtualList(items, { itemHeight: 10, overscan: 2 }));

    expect(result.current.totalHeight).toBe(10_000);

    act(() => {
      result.current.onScroll(fakeScrollEvent(250, 100));
    });

    const rows = result.current.visibleRows;
    // 视口覆盖行 25-35，上下各扩 2 行
    expect(rows[0]!.index).toBe(23);
    expect(rows[rows.length - 1]!.index).toBe(37);
    expect(rows[0]!.offset).toBe(230);
  });

  it('变高行：前缀和偏移与行高正确', () => {
    const items = ['group', 'item', 'item', 'group', 'item'];
    const itemHeight = (row: string) => (row === 'group' ? 30 : 90);
    const { result } = renderHook(() => useVirtualList(items, { itemHeight, overscan: 0 }));

    expect(result.current.totalHeight).toBe(330);

    act(() => {
      result.current.onScroll(fakeScrollEvent(0, 100));
    });

    // 视口 [0,100)：行0（0-30）与行1（30-120）
    const rows = result.current.visibleRows;
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
    expect(rows[1]!.offset).toBe(30);
    expect(rows[1]!.height).toBe(90);
  });

  it('滚动到中段只渲染窗口内的行', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => useVirtualList(items, { itemHeight: 50, overscan: 1 }));

    act(() => {
      result.current.onScroll(fakeScrollEvent(1000, 200));
    });

    const indexes = result.current.visibleRows.map((r) => r.index);
    expect(indexes[0]).toBe(19);
    expect(indexes[indexes.length - 1]).toBe(25);
    expect(indexes).toHaveLength(7);
  });

  it('空列表返回空窗口', () => {
    const { result } = renderHook(() => useVirtualList([] as number[], { itemHeight: 50 }));
    expect(result.current.totalHeight).toBe(0);
    expect(result.current.visibleRows).toEqual([]);
  });

  it('数据变化后总高自动重算', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: number[] }) => useVirtualList(items, { itemHeight: 10 }),
      { initialProps: { items: [1, 2, 3] } },
    );
    expect(result.current.totalHeight).toBe(30);

    rerender({ items: [1, 2, 3, 4, 5] });
    expect(result.current.totalHeight).toBe(50);
  });

  it('scrollIntoView 仅在目标行不可见时滚动', () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const { result } = renderHook(() => useVirtualList(items, { itemHeight: 10 }));
    const fakeEl = createFakeContainer(100);

    act(() => {
      result.current.containerRef(fakeEl);
    });

    // 行 5（50-60）在视口内，不滚动
    act(() => {
      result.current.scrollIntoView(5);
    });
    expect(fakeEl.scrollTop).toBe(0);

    // 行 50 底部 510 超出视口 → 滚到 510 - 100
    act(() => {
      result.current.scrollIntoView(50);
    });
    expect(fakeEl.scrollTop).toBe(410);

    // 行 3 顶部 30 在当前滚动位置上方 → 滚到 30
    act(() => {
      result.current.scrollIntoView(3);
    });
    expect(fakeEl.scrollTop).toBe(30);
  });
});

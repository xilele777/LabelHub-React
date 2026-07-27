import { useCallback, useMemo, useRef, useState } from 'react';

export interface VirtualRow<T> {
  /** 行在源数组中的索引 */
  index: number;
  /** 行顶部相对列表起点的偏移（px） */
  offset: number;
  height: number;
  data: T;
}

export interface UseVirtualListOptions<T> {
  /** 行高（px）：定值，或按行计算（支持分组头等变高行）；函数需引用稳定（useCallback） */
  itemHeight: number | ((item: T, index: number) => number);
  /** 视口外上下各多渲染几行，滚动更平滑，默认 5 */
  overscan?: number;
}

/**
 * 虚拟滚动：只渲染视口内（含 overscan）的行，支持变高行。
 *
 * 实现要点：
 * - 前缀和数组缓存每行偏移，行高变化只在源数据变化时重算一次（useMemo）；
 * - 滚动时用二分查找定位首个可见行，复杂度 O(log n)；
 * - 渲染层用 absolute + translateY 定位，避免大量 DOM 重排。
 *
 * JSX 接法：外层容器绑定 ref={containerRef} 与 onScroll={onScroll}（容器需
 * overflow:auto 且有确定高度），内层撑高层高度绑定 totalHeight，
 * 行元素遍历 visibleRows 以 offset 绝对定位。
 * containerRef 是 callback ref：容器因条件渲染延迟出现或销毁重建时自动重新测量。
 */
export function useVirtualList<T>(items: T[], options: UseVirtualListOptions<T>) {
  const { itemHeight, overscan = 5 } = options;

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const elementRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // 前缀和：offsets[i] 为第 i 行顶部偏移，offsets[n] 为列表总高
  const offsets = useMemo<number[]>(() => {
    const result = new Array<number>(items.length + 1);
    result[0] = 0;
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      const height = typeof itemHeight === 'function' ? itemHeight(items[i] as T, i) : itemHeight;
      acc += height;
      result[i + 1] = acc;
    }
    return result;
  }, [items, itemHeight]);

  const totalHeight = offsets[items.length] ?? 0;

  /** 二分查找：返回覆盖 top 位置的行索引（首个满足 offsets[i+1] > top 的 i） */
  const findRowIndex = useCallback(
    (top: number): number => {
      const lastIndex = offsets.length - 2;
      if (lastIndex < 0) return 0;
      let lo = 0;
      let hi = lastIndex;
      let answer = lastIndex;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if ((offsets[mid + 1] ?? Infinity) > top) {
          answer = mid;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      return answer;
    },
    [offsets],
  );

  const visibleRows = useMemo<VirtualRow<T>[]>(() => {
    if (items.length === 0) return [];

    const startRaw = findRowIndex(scrollTop);
    const endRaw = findRowIndex(scrollTop + Math.max(viewportHeight, 1));
    const start = Math.max(0, startRaw - overscan);
    const end = Math.min(items.length - 1, endRaw + overscan);

    const rows: VirtualRow<T>[] = [];
    for (let i = start; i <= end; i++) {
      const offset = offsets[i] ?? 0;
      const next = offsets[i + 1] ?? offset;
      rows.push({
        index: i,
        offset,
        height: next - offset,
        data: items[i] as T,
      });
    }
    return rows;
  }, [items, offsets, findRowIndex, scrollTop, viewportHeight, overscan]);

  const onScroll = useCallback((event: { currentTarget: EventTarget | null }) => {
    const el = event.currentTarget as HTMLElement | null;
    if (!el) return;
    setScrollTop(el.scrollTop);
    setViewportHeight(el.clientHeight);
  }, []);

  /** 滚动到指定行顶部 */
  const scrollToIndex = useCallback(
    (index: number) => {
      const el = elementRef.current;
      if (!el) return;
      const top = offsets[Math.max(0, Math.min(index, offsets.length - 2))] ?? 0;
      el.scrollTop = top;
      setScrollTop(top);
    },
    [offsets],
  );

  /** 仅当目标行在视口外时滚动到可见位置（选中项定位用） */
  const scrollIntoView = useCallback(
    (index: number) => {
      const el = elementRef.current;
      if (!el || index < 0 || index >= offsets.length - 1) return;
      const top = offsets[index] ?? 0;
      const bottom = offsets[index + 1] ?? top;
      if (top < el.scrollTop) {
        el.scrollTop = top;
        setScrollTop(top);
      } else if (bottom > el.scrollTop + el.clientHeight) {
        const next = bottom - el.clientHeight;
        el.scrollTop = next;
        setScrollTop(next);
      }
    },
    [offsets],
  );

  // callback ref：容器挂载即测量视口高度并跟随尺寸变化，卸载时清理观察器。
  // 容器可能因条件渲染延迟出现或销毁重建（列表先 loading/empty 再有数据），
  // callback ref 天然覆盖这些时机（等价 Vue 版 watch(containerRef)）。
  const containerRef = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    elementRef.current = el;
    if (!el) return;
    setViewportHeight(el.clientHeight);
    setScrollTop(el.scrollTop);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        setViewportHeight(el.clientHeight);
      });
      observer.observe(el);
      observerRef.current = observer;
    }
  }, []);

  return {
    containerRef,
    scrollTop,
    viewportHeight,
    totalHeight,
    visibleRows,
    onScroll,
    scrollToIndex,
    scrollIntoView,
  };
}

// 管理审核工作台的筛选条件和筛选后的数据。
import { useCallback, useMemo, useState } from 'react';
import type { DataItem } from '../../../types';
import type { AIReviewResult } from '../../../types/aiReview';
import { useDebounced } from '../../../hooks/useDebounced';

export interface ReviewFilterState {
  status?: string;
  taskId?: string;
  annotator?: string;
  aiReviewResult?: string;
  keyword?: string;
}

export interface GroupedItems {
  taskId: string;
  items: DataItem[];
}

/**
 * 审核工作台筛选逻辑：筛选状态、派生选项、过滤与分组结果。
 * 关键词过滤使用防抖镜像，避免每次按键触发全量过滤重算。
 * 通过 setFilter 局部更新筛选条件。
 */
export function useReviewFilters(
  reviewableItems: DataItem[],
  aiResultMap: Map<string, AIReviewResult>,
) {
  const [filters, setFilters] = useState<ReviewFilterState>({});
  const debouncedKeyword = useDebounced(filters.keyword ?? '');

  const setFilter = useCallback((patch: Partial<ReviewFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  const annotatorOptions = useMemo(() => {
    const annotators = new Set<string>();
    reviewableItems.forEach((item) => {
      if (item.annotator) annotators.add(item.annotator);
    });
    return Array.from(annotators)
      .sort()
      .map((annotator) => ({ label: annotator, value: annotator }));
  }, [reviewableItems]);

  const filteredItems = useMemo(() => {
    let result = reviewableItems;
    if (filters.status) {
      result = result.filter((item) => item.status === filters.status);
    }
    if (filters.taskId) result = result.filter((item) => item.taskId === filters.taskId);
    if (filters.annotator) result = result.filter((item) => item.annotator === filters.annotator);
    if (filters.aiReviewResult) {
      result = result.filter(
        (item) => aiResultMap.get(item.id)?.reviewStatus === filters.aiReviewResult,
      );
    }
    if (filters.keyword) {
      const keyword = debouncedKeyword.toLowerCase();
      if (keyword) {
        result = result.filter((item) => {
          const fileName = String(item.rawData.fileName ?? '').toLowerCase();
          const description = String(item.rawData.description ?? '').toLowerCase();
          return (
            fileName.includes(keyword) ||
            description.includes(keyword) ||
            item.id.toLowerCase().includes(keyword)
          );
        });
      }
    }
    return result;
  }, [reviewableItems, aiResultMap, filters, debouncedKeyword]);

  const groupedItems = useMemo<GroupedItems[]>(() => {
    const groups = new Map<string, DataItem[]>();
    filteredItems.forEach((item) => {
      const list = groups.get(item.taskId) ?? [];
      list.push(item);
      groups.set(item.taskId, list);
    });
    return Array.from(groups.entries()).map(([taskId, items]) => ({ taskId, items }));
  }, [filteredItems]);

  const hasActiveFilters = Boolean(
    filters.status ||
    filters.taskId ||
    filters.annotator ||
    filters.aiReviewResult ||
    filters.keyword,
  );

  return {
    filters,
    setFilter,
    filteredItems,
    groupedItems,
    hasActiveFilters,
    annotatorOptions,
    clearFilters,
  };
}

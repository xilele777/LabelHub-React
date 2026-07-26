/**
 * 任务分配相关 API
 */
import { get, post } from './request';
import type { AssignmentStats, AnnotatorInfo } from '../types';

/** 获取所有标注员列表 */
export function getAnnotators() {
  return get<AnnotatorInfo[]>('/annotators');
}

/** 获取所有审核员列表 */
export function getReviewers() {
  return get<AnnotatorInfo[]>('/reviewers');
}

/** 获取任务分配统计 */
export function getAssignmentStats(taskId: string) {
  return get<AssignmentStats>(`/tasks/${taskId}/assign/stats`);
}

/** 获取待分配数据列表 */
export function getAssignableItems(
  taskId: string,
  params?: { status?: string; includeAssigned?: boolean },
) {
  return get<{
    items: Array<{
      id: string;
      taskId: string;
      status: string;
      annotator: string | null;
      rawDataPreview: string;
    }>;
    total: number;
  }>(`/tasks/${taskId}/assign/items`, params as Record<string, unknown>);
}

export function getReviewAssignableItems(
  taskId: string,
  params?: { status?: string; includeAssigned?: boolean },
) {
  return get<{
    items: Array<{
      id: string;
      taskId: string;
      status: string;
      annotator: string | null;
      reviewer: string | null;
      submittedAt: string | null;
      rawDataPreview: string;
    }>;
    total: number;
  }>(`/tasks/${taskId}/review-assign/items`, params as Record<string, unknown>);
}

/** 执行分配参数 */
export interface ExecuteAssignParams {
  strategy: 'even_split' | 'manual';
  annotators?: string[];
  options?: {
    perPerson?: number;
    assignments?: { itemId: string; annotator: string }[];
  };
}

/** 执行分配结果 */
export interface AssignResult {
  assigned: number;
  details?: Array<Record<string, unknown>>;
  remaining?: number;
  error?: string;
}

/** 清除分配结果 */
export interface ClearResult {
  cleared: number;
}

/** 执行任务分配 */
export function executeAssignment(taskId: string, params: ExecuteAssignParams) {
  return post<AssignResult>(`/tasks/${taskId}/assign`, params);
}

/** 清除任务分配 */
export function clearAssignment(taskId: string, itemIds?: string[]) {
  return post<ClearResult>(`/tasks/${taskId}/assign/clear`, { itemIds: itemIds || [] });
}

export function executeReviewAssignment(
  taskId: string,
  assignments: { itemId: string; reviewer: string }[],
) {
  return post<AssignResult>(`/tasks/${taskId}/review-assign`, { assignments });
}

/**
 * 标注项相关 API
 */
import { get, put, post, del } from './request';
import type { RequestConfig } from './request';
import type { DataItem, ConflictData, LockData } from '../types';

export interface AnnotationItemListResult {
  items: DataItem[];
  total: number;
}

/** 获取标注项列表 */
export function getAnnotationItemList(params?: Record<string, unknown>, config?: RequestConfig) {
  return get<AnnotationItemListResult>('/annotation-items', params, config);
}

/** 获取单个标注项 */
export function getAnnotationItem(id: string) {
  return get<DataItem>(`/annotation-items/${id}`);
}

/** 创建标注项 */
export function createAnnotationItem(data: Partial<DataItem>) {
  return post<DataItem>('/annotation-items', data);
}

/** 更新标注项（含乐观锁 version） */
export function updateAnnotationItem(id: string, data: Partial<DataItem> & { version?: number }) {
  return put<DataItem>(`/annotation-items/${id}`, data);
}

/** 删除标注项 */
export function deleteAnnotationItem(id: string) {
  return del<void>(`/annotation-items/${id}`);
}

/** 保存草稿（含乐观锁 version） */
export function saveDraft(id: string, annotationData: Record<string, unknown>, version: number) {
  return put<DataItem>(`/annotation-items/${id}/save-draft`, { annotationData, version });
}

/** 提交标注（含乐观锁 version，后端自动触发规则预审，返回 { item, review }） */
export function submitAnnotation(
  id: string,
  annotationData: Record<string, unknown>,
  version: number,
) {
  return put<SubmitWithAIReviewResponse>(`/annotation-items/${id}/submit`, {
    annotationData,
    version,
  });
}

/** 审核通过（含乐观锁 version） */
export function approveAnnotation(id: string, version: number, reason?: string) {
  return put<DataItem>(`/annotation-items/${id}/approve`, { reason, version });
}

/** 审核驳回（含乐观锁 version） */
export function rejectAnnotation(id: string, reason: string, version: number) {
  return put<DataItem>(`/annotation-items/${id}/reject`, { reason, version });
}

/** 驳回后重新提交（含乐观锁 version，后端自动触发规则预审，返回 { item, review }） */
export function resubmitAnnotation(
  id: string,
  annotationData: Record<string, unknown>,
  version: number,
) {
  return put<SubmitWithAIReviewResponse>(`/annotation-items/${id}/resubmit`, {
    annotationData,
    version,
  });
}

/** 获取可领取的未分配标注项列表 */
export interface AvailableItem {
  id: string;
  taskId: string;
  status: string;
  annotator: string | null;
  rawData: Record<string, unknown>;
  rawDataPreview: string;
}

export interface AvailableItemsResult {
  items: AvailableItem[];
  total: number;
}

export interface ClaimFailure {
  id: string;
  reason: string;
}

export interface BatchClaimResult {
  claimed: DataItem[];
  failed: ClaimFailure[];
  claimedCount: number;
  failedCount: number;
}

export function getAvailableItems(params?: { taskId?: string; status?: string }) {
  return get<AvailableItemsResult>(
    '/annotation-items/available',
    params as Record<string, unknown>,
  );
}

export function getReviewAvailableItems(params?: { taskId?: string; status?: string }) {
  return get<AvailableItemsResult>(
    '/annotation-items/review-available',
    params as Record<string, unknown>,
  );
}

/** 手动领取（认领分配）一个未分配的标注项，将其分配给自己 */
export function claimAssignment(id: string) {
  return put<DataItem>(`/annotation-items/${id}/claim-assignment`, {});
}

export function batchClaimAssignments(ids: string[]) {
  return put<BatchClaimResult>('/annotation-items/batch-claim-assignment', { ids });
}

/** 审核员领取一个未分配审核项 */
export function claimReview(id: string) {
  return put<DataItem>(`/annotation-items/${id}/claim-review`, {});
}

export function batchClaimReviews(ids: string[]) {
  return put<BatchClaimResult>('/annotation-items/batch-claim-review', { ids });
}

/** 认领（悲观锁）标注项，返回锁定的标注项 */
export function claimItem(id: string) {
  return put<DataItem>(`/annotation-items/${id}/claim`, {});
}

/** 释放（解锁）标注项 */
export function releaseItem(id: string) {
  return put<DataItem>(`/annotation-items/${id}/release`, {});
}

/** 释放当前用户持有的所有锁（登出时调用） */
export function releaseAllItems() {
  return post<{ releasedCount: number }>('/annotation-items/release-all', {});
}

/** 批量导入标注项 */
export interface BatchImportResult {
  imported: number;
  items: DataItem[];
}

export function batchImportItems(
  taskId: string,
  items: Array<{ rawData: Record<string, unknown> }>,
) {
  return post<BatchImportResult>('/annotation-items/batch-import', { taskId, items });
}

/** 提交/重新提交后后端自动触发规则预审，返回的联合结果 */
export interface SubmitWithAIReviewResponse {
  item: DataItem;
  review?: Record<string, unknown>;
}

/** 并发冲突时的错误响应（HTTP 409） */
export interface ConflictErrorResponse {
  code: 409;
  message: string;
  data: ConflictData;
}

/** 归档标注项（仅审核通过的项可归档） */
export function archiveAnnotationItem(id: string) {
  return put<DataItem>(`/annotation-items/${id}/archive`, {});
}

/** 取消归档标注项（仅 Owner 可操作） */
export function unarchiveAnnotationItem(id: string) {
  return put<DataItem>(`/annotation-items/${id}/unarchive`, {});
}

/** 认领冲突时的错误响应（HTTP 423） */
export interface LockedErrorResponse {
  code: 423;
  message: string;
  data: LockData;
}

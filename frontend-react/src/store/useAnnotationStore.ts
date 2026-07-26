import { create } from 'zustand';
import { logger } from '../utils/logger';
import {
  DataItemStatus,
  STATUS_TRANSITIONS,
  type ConflictData,
  type DataItem,
  type LockData,
} from '../types';
import type { AIReviewResult } from '../types/aiReview';
import * as annotationApi from '../api/annotation';
import type {
  AvailableItem,
  BatchClaimResult,
  SubmitWithAIReviewResponse,
} from '../api/annotation';
import * as reviewApi from '../api/review';

export { DataItemStatus };
export type { AIReviewResult, AvailableItem, BatchClaimResult, ConflictData, DataItem, LockData };

export type DataItemStatusTransitionMap = {
  readonly [Status in DataItemStatus]: readonly DataItemStatus[];
};

export const DATA_ITEM_STATUS_TRANSITIONS: DataItemStatusTransitionMap = STATUS_TRANSITIONS;

export interface AnnotationState {
  dataItems: DataItem[];
  archivedItems: DataItem[];
  aiReviewResults: AIReviewResult[];
  currentIndex: number;
  loading: boolean;
  error: string | null;
  conflictInfo: ConflictData | null;
  lockInfo: LockData | null;
  availableItems: AvailableItem[];
  availableLoading: boolean;
}

/** 派生字段：随 dataItems/currentIndex/conflictInfo/lockInfo 同步维护（Pinia 版为 computed） */
interface AnnotationDerived {
  currentItem: DataItem | null;
  hasConflict: boolean;
  itemTotal: number;
}

interface AnnotationActions {
  fetchDataItems(taskId?: string): Promise<void>;
  fetchAIReviews(taskId?: string): Promise<void>;
  setCurrentIndex(index: number): void;
  saveDraft(id: string, data: Record<string, unknown>, annotator: string): Promise<void>;
  submitAnnotation(id: string, data: Record<string, unknown>, annotator: string): Promise<void>;
  approveItem(id: string, reviewer: string): Promise<void>;
  rejectItem(id: string, reviewer: string, reason: string): Promise<void>;
  resubmitItem(id: string, data: Record<string, unknown>, annotator: string): Promise<void>;
  claimItem(id: string): Promise<boolean>;
  releaseItem(id: string): Promise<void>;
  releaseAllMyItems(): Promise<void>;
  resolveConflictWithServer(id: string): void;
  clearConflict(): void;
  getAIReviewByDataItemId(dataItemId: string): AIReviewResult | undefined;
  fetchArchivedItems(taskId?: string): Promise<void>;
  archiveItem(id: string): Promise<void>;
  unarchiveItem(id: string): Promise<void>;
  fetchAvailableItems(taskId?: string): Promise<void>;
  claimAssignment(id: string): Promise<boolean>;
  batchClaimAssignments(ids: string[]): Promise<BatchClaimResult | null>;
}

export type AnnotationStore = AnnotationState & AnnotationDerived & AnnotationActions;

function normalizeSubmitResponse(payload: SubmitWithAIReviewResponse | DataItem): {
  item: DataItem;
  review?: AIReviewResult;
} {
  if ('item' in payload && payload.item) {
    const review = payload.review as unknown as AIReviewResult | undefined;
    return review ? { item: payload.item, review } : { item: payload.item };
  }

  return { item: payload as DataItem };
}

export function canTransitDataItemStatus(from: DataItemStatus, to: DataItemStatus): boolean {
  return from === to || DATA_ITEM_STATUS_TRANSITIONS[from].includes(to);
}

function assertDataItemStatusTransition(
  from: DataItemStatus,
  to: DataItemStatus,
  action: string,
): void {
  if (canTransitDataItemStatus(from, to)) return;
  throw new Error(`Invalid data item status transition in ${action}: ${from} -> ${to}`);
}

function isApiErrorWithData<T>(
  error: unknown,
  code: number,
): error is { code: number; data: T; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === code &&
    'data' in error
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function createInitialAnnotationState(): AnnotationState & AnnotationDerived {
  return {
    dataItems: [],
    archivedItems: [],
    aiReviewResults: [],
    currentIndex: 0,
    loading: false,
    error: null,
    conflictInfo: null,
    lockInfo: null,
    availableItems: [],
    availableLoading: false,
    currentItem: null,
    hasConflict: false,
    itemTotal: 0,
  };
}

export const useAnnotationStore = create<AnnotationStore>()((set, get) => {
  /** 统一入口：合并 patch 并重算全部派生字段（等价 Pinia computed） */
  function patch(partial: Partial<AnnotationState>): void {
    const next = { ...get(), ...partial };
    set({
      ...partial,
      currentItem: next.dataItems[next.currentIndex] ?? null,
      hasConflict: Boolean(next.conflictInfo || next.lockInfo),
      itemTotal: next.dataItems.length,
    });
  }

  function replaceDataItem(updatedItem: DataItem, action: string): void {
    const { dataItems } = get();
    const current = dataItems.find((item) => item.id === updatedItem.id);
    if (current) {
      assertDataItemStatusTransition(current.status, updatedItem.status, action);
    }

    patch({
      dataItems: dataItems.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    });
  }

  function upsertAIReview(dataItemId: string, review?: AIReviewResult): void {
    if (!review) return;
    patch({
      aiReviewResults: [
        ...get().aiReviewResults.filter((item) => item.dataItemId !== dataItemId),
        review,
      ],
    });
  }

  // 竞态保护：新请求到达时取消前序在途请求，防止旧数据覆盖新结果
  let dataFetchController: AbortController | null = null;
  let reviewFetchController: AbortController | null = null;

  return {
    ...createInitialAnnotationState(),

    async fetchDataItems(taskId): Promise<void> {
      // 取消前序在途请求
      dataFetchController?.abort();
      dataFetchController = new AbortController();

      patch({ loading: true, error: null });
      try {
        const params: Record<string, unknown> = {};
        if (taskId) params.taskId = taskId;
        const res = await annotationApi.getAnnotationItemList(params, {
          signal: dataFetchController.signal,
        });
        patch({ dataItems: res.data.items });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        patch({ error: getErrorMessage(err, '获取标注数据失败') });
      } finally {
        patch({ loading: false });
      }
    },

    async fetchAIReviews(taskId): Promise<void> {
      reviewFetchController?.abort();
      reviewFetchController = new AbortController();

      patch({ error: null });
      try {
        const res = taskId
          ? await reviewApi.getReviewsByTaskId(taskId, { signal: reviewFetchController.signal })
          : await reviewApi.getReviewList({ signal: reviewFetchController.signal });
        patch({ aiReviewResults: res.data.items });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        patch({ error: getErrorMessage(err, '获取审核数据失败') });
      }
    },

    setCurrentIndex(index): void {
      patch({ currentIndex: index, conflictInfo: null, lockInfo: null });
    },

    async saveDraft(id, data, _annotator): Promise<void> {
      patch({ error: null, conflictInfo: null });
      try {
        const current = get().dataItems.find((item) => item.id === id);
        const version = current?.version ?? 1;
        const res = await annotationApi.saveDraft(id, data, version);
        replaceDataItem(res.data, 'saveDraft');
      } catch (err: unknown) {
        if (isApiErrorWithData<ConflictData>(err, 409)) {
          patch({ conflictInfo: err.data, error: null });
          throw err;
        }
        patch({ error: getErrorMessage(err, '保存草稿失败') });
        throw err;
      }
    },

    async submitAnnotation(id, data, _annotator): Promise<void> {
      patch({ error: null, conflictInfo: null });
      try {
        const current = get().dataItems.find((item) => item.id === id);
        const version = current?.version ?? 1;
        const res = await annotationApi.submitAnnotation(id, data, version);
        const { item, review } = normalizeSubmitResponse(res.data);
        replaceDataItem(item, 'submitAnnotation');
        upsertAIReview(id, review);
      } catch (err: unknown) {
        if (isApiErrorWithData<ConflictData>(err, 409)) {
          patch({ conflictInfo: err.data, error: null });
          throw err;
        }
        patch({ error: getErrorMessage(err, '提交标注失败') });
        throw err;
      }
    },

    async approveItem(id, _reviewer): Promise<void> {
      patch({ error: null });
      try {
        const current = get().dataItems.find((item) => item.id === id);
        const version = current?.version ?? 1;
        const res = await annotationApi.approveAnnotation(id, version);
        const updatedItem = res.data;

        if (updatedItem.archived) {
          assertDataItemStatusTransition(
            current?.status ?? updatedItem.status,
            updatedItem.status,
            'approveItem',
          );
          const { dataItems, archivedItems } = get();
          patch({
            dataItems: dataItems.filter((item) => item.id !== id),
            archivedItems: [updatedItem, ...archivedItems],
          });
        } else {
          replaceDataItem(updatedItem, 'approveItem');
        }
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '审核通过失败') });
        throw err;
      }
    },

    async rejectItem(id, _reviewer, reason): Promise<void> {
      patch({ error: null });
      try {
        const current = get().dataItems.find((item) => item.id === id);
        const version = current?.version ?? 1;
        const res = await annotationApi.rejectAnnotation(id, reason, version);
        replaceDataItem(res.data, 'rejectItem');
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '审核驳回失败') });
        throw err;
      }
    },

    async resubmitItem(id, data, _annotator): Promise<void> {
      patch({ error: null, conflictInfo: null });
      try {
        const current = get().dataItems.find((item) => item.id === id);
        const version = current?.version ?? 1;
        const res = await annotationApi.resubmitAnnotation(id, data, version);
        const { item, review } = normalizeSubmitResponse(res.data);
        replaceDataItem(item, 'resubmitItem');
        upsertAIReview(id, review);
      } catch (err: unknown) {
        if (isApiErrorWithData<ConflictData>(err, 409)) {
          patch({ conflictInfo: err.data, error: null });
          throw err;
        }
        patch({ error: getErrorMessage(err, '重新提交失败') });
        throw err;
      }
    },

    async claimItem(id): Promise<boolean> {
      patch({ lockInfo: null, error: null });
      try {
        const res = await annotationApi.claimItem(id);
        replaceDataItem(res.data, 'claimItem');
        return true;
      } catch (err: unknown) {
        if (isApiErrorWithData<LockData>(err, 423)) {
          patch({ lockInfo: err.data, error: err.message || '该数据正在被他人编辑' });
          return false;
        }
        patch({ error: getErrorMessage(err, '认领失败') });
        return false;
      }
    },

    async releaseItem(id): Promise<void> {
      patch({ error: null });
      try {
        const res = await annotationApi.releaseItem(id);
        replaceDataItem(res.data, 'releaseItem');
      } catch (err: unknown) {
        logger.warn('释放锁失败', getErrorMessage(err, 'unknown error'));
      }
    },

    async releaseAllMyItems(): Promise<void> {
      try {
        await annotationApi.releaseAllItems();
      } catch (err: unknown) {
        logger.warn('释放所有锁失败:', getErrorMessage(err, 'unknown error'));
      }
    },

    resolveConflictWithServer(id): void {
      const conflict = get().conflictInfo;
      if (conflict?.serverItem) {
        replaceDataItem(conflict.serverItem, `resolveConflictWithServer:${id}`);
        patch({ conflictInfo: null, error: null });
        return;
      }

      patch({ conflictInfo: null, error: null });
      void get().fetchDataItems();
    },

    clearConflict(): void {
      patch({ conflictInfo: null, lockInfo: null, error: null });
    },

    getAIReviewByDataItemId(dataItemId): AIReviewResult | undefined {
      return get().aiReviewResults.find((item) => item.dataItemId === dataItemId);
    },

    async fetchArchivedItems(taskId): Promise<void> {
      patch({ loading: true, error: null });
      try {
        const params: Record<string, unknown> = { archived: 'true' };
        if (taskId) params.taskId = taskId;
        const res = await annotationApi.getAnnotationItemList(params);
        patch({ archivedItems: res.data.items });
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '获取归档数据失败') });
      } finally {
        patch({ loading: false });
      }
    },

    async archiveItem(id): Promise<void> {
      patch({ error: null });
      try {
        const res = await annotationApi.archiveAnnotationItem(id);
        const { dataItems, archivedItems } = get();
        patch({
          dataItems: dataItems.filter((item) => item.id !== id),
          archivedItems: [res.data, ...archivedItems],
        });
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '归档失败') });
      }
    },

    async unarchiveItem(id): Promise<void> {
      patch({ error: null });
      try {
        const res = await annotationApi.unarchiveAnnotationItem(id);
        const { dataItems, archivedItems } = get();
        patch({
          archivedItems: archivedItems.filter((item) => item.id !== id),
          dataItems: [res.data, ...dataItems],
        });
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '取消归档失败') });
      }
    },

    async fetchAvailableItems(taskId): Promise<void> {
      patch({ availableLoading: true, error: null });
      try {
        const params: { taskId?: string } = {};
        if (taskId) params.taskId = taskId;
        const res = await annotationApi.getAvailableItems(params);
        patch({ availableItems: res.data.items });
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '获取可领取列表失败') });
      } finally {
        patch({ availableLoading: false });
      }
    },

    async claimAssignment(id): Promise<boolean> {
      patch({ error: null });
      try {
        const res = await annotationApi.claimAssignment(id);
        const { dataItems, availableItems } = get();
        patch({
          dataItems: [res.data, ...dataItems],
          availableItems: availableItems.filter((item) => item.id !== id),
        });
        return true;
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '领取失败') });
        return false;
      }
    },

    async batchClaimAssignments(ids): Promise<BatchClaimResult | null> {
      patch({ error: null });
      try {
        const res = await annotationApi.batchClaimAssignments(ids);
        const result = res.data;
        const claimedIds = new Set(result.claimed.map((item) => item.id));

        const { dataItems, availableItems } = get();
        patch({
          dataItems: [...result.claimed, ...dataItems.filter((item) => !claimedIds.has(item.id))],
          availableItems: availableItems.filter((item) => !claimedIds.has(item.id)),
        });

        return result;
      } catch (err: unknown) {
        patch({ error: getErrorMessage(err, '批量领取失败') });
        return null;
      }
    },
  };
});

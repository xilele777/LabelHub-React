import { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { App } from 'antd';
import * as annotationApi from '../../../api/annotation';
import type { AvailableItem } from '../../../api/annotation';

export interface UseReviewClaimPoolOptions {
  /** 领取池按任务过滤（跟随页面筛选） */
  taskIdFilter: string | undefined;
  /** 领取成功后的回调：刷新数据并选中该条 */
  onClaimed: (firstClaimedId: string) => Promise<void> | void;
}

/**
 * 审核领取池：弹窗状态、池数据加载、单条/批量/连续领取。
 * 状态放在页面层共享，「连续领取」在审核动作完成后也能继续从池中取数。
 * taskIdFilter/onClaimed/选中集允许每次渲染变化（latest-ref 内部取最新）。
 */
export function useReviewClaimPool(options: UseReviewClaimPoolOptions) {
  const { message, modal } = App.useApp();
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [reviewPoolItems, setReviewPoolItems] = useState<AvailableItem[]>([]);
  const [reviewPoolLoading, setReviewPoolLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [batchClaiming, setBatchClaiming] = useState(false);
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const [continuousClaimEnabled, setContinuousClaimEnabled] = useState(false);

  const latestRef = useRef({ options, selectedClaimIds, continuousClaimEnabled });
  useEffect(() => {
    latestRef.current = { options, selectedClaimIds, continuousClaimEnabled };
  });

  const loadReviewPool = useCallback(async (): Promise<AvailableItem[]> => {
    setReviewPoolLoading(true);
    try {
      const taskId = latestRef.current.options.taskIdFilter;
      const res = await annotationApi.getReviewAvailableItems(taskId ? { taskId } : undefined);
      const items = res.data.items || [];
      setReviewPoolItems(items);
      return items;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载审核任务池失败');
      return [];
    } finally {
      setReviewPoolLoading(false);
    }
  }, [message]);

  const openClaimModal = useCallback(async () => {
    setClaimModalOpen(true);
    setSelectedClaimIds([]);
    await loadReviewPool();
  }, [loadReviewPool]);

  const onClaimSelectionChange = useCallback((keys: Key[]) => {
    setSelectedClaimIds(keys.map(String));
  }, []);

  const claimReview = useCallback(
    async (id: string) => {
      setClaimingId(id);
      try {
        await annotationApi.claimReview(id);
        message.success('审核项领取成功');
        await latestRef.current.options.onClaimed(id);
        await loadReviewPool();
        setClaimModalOpen(false);
      } catch (error) {
        modal.warning({
          title: '领取失败',
          content: error instanceof Error ? error.message : '领取审核项失败',
        });
      } finally {
        setClaimingId(null);
      }
    },
    [loadReviewPool, message, modal],
  );

  const batchClaimReviews = useCallback(
    async (ids?: string[]) => {
      const targetIds = ids ?? latestRef.current.selectedClaimIds;
      if (targetIds.length === 0) {
        message.warning('请先选择要领取的审核任务');
        return;
      }

      setBatchClaiming(true);
      try {
        const res = await annotationApi.batchClaimReviews(targetIds);
        const result = res.data;
        setSelectedClaimIds((prev) =>
          prev.filter((id) => !result.claimed.some((item) => item.id === id)),
        );
        const first = result.claimed[0];
        if (first) {
          message.success(`已领取 ${result.claimedCount} 条审核任务`);
          await latestRef.current.options.onClaimed(first.id);
          await loadReviewPool();
          setClaimModalOpen(false);
        }
        if (result.failedCount > 0) {
          message.warning(`${result.failedCount} 条领取失败，可能已被分配或不在可领取状态`);
        }
      } catch (error) {
        modal.warning({
          title: '批量领取失败',
          content: error instanceof Error ? error.message : '批量领取审核项失败',
        });
      } finally {
        setBatchClaiming(false);
      }
    },
    [loadReviewPool, message, modal],
  );

  /** 连续领取：审核完成后自动从池中领取下一条 */
  const tryContinuousClaim = useCallback(async () => {
    if (!latestRef.current.continuousClaimEnabled) return;
    const pool = await loadReviewPool();
    const next = pool[0];
    if (!next) {
      message.info('当前任务暂无可连续领取的审核数据');
      return;
    }
    await batchClaimReviews([next.id]);
  }, [batchClaimReviews, loadReviewPool, message]);

  return {
    claimModalOpen,
    setClaimModalOpen,
    reviewPoolItems,
    reviewPoolLoading,
    claimingId,
    batchClaiming,
    selectedClaimIds,
    continuousClaimEnabled,
    setContinuousClaimEnabled,
    openClaimModal,
    loadReviewPool,
    onClaimSelectionChange,
    claimReview,
    batchClaimReviews,
    tryContinuousClaim,
  };
}

// 审核工作台，处理待审数据、审核意见和流转操作。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  FilterOutlined,
  HistoryOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import {
  DataItemStatus,
  TaskStatus,
  type DataItem,
  type TaskItem,
  type TemplateField,
} from '../../types';
import type { AIReviewResult } from '../../types/aiReview';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { getTemplateSchemaAsync } from '../../utils/templateSchemaHelper';
import * as taskApi from '../../api/task';
import {
  connectNotificationWS,
  getSocket,
  joinTaskRoom,
  leaveTaskRoom,
  type Notification,
} from '../../services/notificationWebSocket';
import { useVirtualList } from '../../hooks/useVirtualList';
import { useReviewFilters } from './hooks/useReviewFilters';
import { useReviewClaimPool } from './hooks/useReviewClaimPool';
import ClaimReviewModal from './components/ClaimReviewModal';
import AuditFlowModal from './components/AuditFlowModal';
import RejectModal from './components/RejectModal';
import {
  REVIEW_ACTIONABLE_STATUSES,
  aiReviewFilterOptions,
  aiStatusMeta,
  formatShortTime,
  formatTime,
  statusFilterOptions,
  statusLabel,
} from './reviewDisplay';
import './ReviewWorkbench.css';

// 虚拟滚动列表：分组头和条目统一为可变高行。
type ReviewListRow =
  { type: 'group'; key: string; taskId: string } | { type: 'item'; key: string; item: DataItem };

const GROUP_ROW_HEIGHT = 38;
const ITEM_ROW_HEIGHT = 92;

function getRowHeight(row: ReviewListRow): number {
  return row.type === 'group' ? GROUP_ROW_HEIGHT : ITEM_ROW_HEIGHT;
}

const REFRESH_NOTIFICATION_TYPES = new Set<string>([
  'task_submitted',
  'task_resubmitted',
  'ai_review_complete',
  'review_approved',
  'review_rejected',
]);

const LOCAL_ACTION_DEBOUNCE_MS = 2000;

export default function ReviewWorkbench() {
  const { message, modal } = App.useApp();
  const [searchParams] = useSearchParams();
  const queryTaskId = searchParams.get('taskId') ?? undefined;
  const queryDataItemId = searchParams.get('dataItemId') ?? undefined;

  const dataItems = useAnnotationStore((state) => state.dataItems);
  const storeLoading = useAnnotationStore((state) => state.loading);
  const storeError = useAnnotationStore((state) => state.error);
  const aiReviewResults = useAnnotationStore((state) => state.aiReviewResults);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [templateMap, setTemplateMap] = useState<Record<string, TemplateField[]>>({});
  const joinedTaskIdsRef = useRef(new Set<string>());
  // 最近本地处理过的审核项 id → 时间戳：吸收后端对自己操作的 WS 回推，避免全量刷新导致列表跳跃
  const recentLocalActionIdsRef = useRef(new Map<string, number>());

  const reviewableItems = useMemo(
    () =>
      dataItems.filter(
        (item) =>
          !item.archived &&
          [
            DataItemStatus.SUBMITTED,
            DataItemStatus.PENDING_REVIEW,
            DataItemStatus.REVIEWED,
            DataItemStatus.REJECTED,
          ].includes(item.status),
      ),
    [dataItems],
  );

  const aiResultMap = useMemo(() => {
    const map = new Map<string, AIReviewResult>();
    aiReviewResults.forEach((result) => map.set(result.dataItemId, result));
    return map;
  }, [aiReviewResults]);

  const taskOptions = useMemo(
    () =>
      tasks
        .filter((task) => task.status === TaskStatus.IN_PROGRESS)
        .map((task) => ({ label: task.name, value: task.id })),
    [tasks],
  );

  const taskNameMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    tasks.forEach((task) => {
      map[task.id] = task.name;
    });
    return map;
  }, [tasks]);

  // 筛选逻辑。
  const {
    filters,
    setFilter,
    filteredItems,
    groupedItems,
    hasActiveFilters,
    annotatorOptions,
    clearFilters,
  } = useReviewFilters(reviewableItems, aiResultMap);

  const selectedItem = selectedId
    ? (dataItems.find((item) => item.id === selectedId) ?? null)
    : null;
  const selectedAIReview = selectedItem ? aiResultMap.get(selectedItem.id) : undefined;
  const canReviewSelected = selectedItem
    ? REVIEW_ACTIONABLE_STATUSES.has(selectedItem.status)
    : false;

  const refreshData = useCallback(async () => {
    const store = useAnnotationStore.getState();
    await Promise.all([store.fetchDataItems(queryTaskId), store.fetchAIReviews(queryTaskId)]);
  }, [queryTaskId]);

  // 领取审核池。
  const {
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
  } = useReviewClaimPool({
    taskIdFilter: filters.taskId,
    onClaimed: async (firstClaimedId) => {
      await refreshData();
      setSelectedId(firstClaimedId);
    },
  });

  const listRows = useMemo<ReviewListRow[]>(() => {
    const rows: ReviewListRow[] = [];
    groupedItems.forEach((group) => {
      rows.push({ type: 'group', key: `group:${group.taskId}`, taskId: group.taskId });
      group.items.forEach((item) => rows.push({ type: 'item', key: item.id, item }));
    });
    return rows;
  }, [groupedItems]);

  const {
    containerRef: listContainerRef,
    onScroll: onListScroll,
    totalHeight: listTotalHeight,
    visibleRows: visibleListRows,
    scrollIntoView: scrollListRowIntoView,
  } = useVirtualList(listRows, { itemHeight: getRowHeight, overscan: 6 });

  // 初始加载或任务筛选变化时拉取数据和任务列表。
  useEffect(() => {
    if (queryTaskId) setFilter({ taskId: queryTaskId });
  }, [queryTaskId, setFilter]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    taskApi
      .getTaskList()
      .then((res) => setTasks(res.data.items || []))
      .catch(() => setTasks([]));
  }, []);

  // WebSocket 生命周期；事件处理器通过镜像引用读取最新上下文。
  const socketCtxRef = useRef({ refreshData, claimModalOpen, loadReviewPool });
  useEffect(() => {
    socketCtxRef.current = { refreshData, claimModalOpen, loadReviewPool };
  });

  useEffect(() => {
    const token = useAuthStore.getState().token || localStorage.getItem('token');
    if (token) connectNotificationWS(token);

    const socket = getSocket();
    if (!socket) return;
    setSocketConnected(socket.connected);

    const joined = joinedTaskIdsRef.current;
    const recentIds = recentLocalActionIdsRef.current;
    const handleConnect = () => {
      setSocketConnected(true);
      joined.forEach((taskId) => joinTaskRoom(taskId));
    };
    const handleDisconnect = () => {
      setSocketConnected(false);
    };
    const handleNotification = (notification: Notification) => {
      if (!REFRESH_NOTIFICATION_TYPES.has(notification.type)) return;
      // 自己刚操作过的条目已由 store 更新，跳过刷新以保持列表位置。
      const payloadItemId = (notification.data as { dataItemId?: unknown } | undefined)?.dataItemId;
      if (payloadItemId && recentIds.has(String(payloadItemId))) {
        if (socketCtxRef.current.claimModalOpen) void socketCtxRef.current.loadReviewPool();
        return;
      }
      void socketCtxRef.current.refreshData();
      if (socketCtxRef.current.claimModalOpen) void socketCtxRef.current.loadReviewPool();
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('notification', handleNotification);
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('notification', handleNotification);
      joined.forEach((taskId) => leaveTaskRoom(taskId));
      joined.clear();
    };
  }, []);

  // 数据涉及的任务加入 WS 房间（增量）
  useEffect(() => {
    const uniqueTaskIds = new Set(dataItems.map((item) => item.taskId));
    uniqueTaskIds.forEach((taskId) => {
      if (!joinedTaskIdsRef.current.has(taskId)) {
        joinTaskRoom(taskId);
        joinedTaskIdsRef.current.add(taskId);
      }
    });
  }, [dataItems]);

  // 自动选中：选中项被筛掉或尚无选中时，取第一个可审核项（或第一项）
  useEffect(() => {
    const ids = filteredItems.map((item) => item.id);
    const preferredId =
      filteredItems.find((item) => REVIEW_ACTIONABLE_STATUSES.has(item.status))?.id ??
      ids[0] ??
      null;
    setSelectedId((prev) => {
      if (prev && !ids.includes(prev)) return preferredId;
      if (!prev && ids.length > 0) return preferredId;
      return prev;
    });
  }, [filteredItems]);

  // query 指定的条目在数据加载完成后定位一次。
  const queryLocatedRef = useRef(false);
  useEffect(() => {
    queryLocatedRef.current = false;
  }, [queryDataItemId]);
  useEffect(() => {
    if (queryLocatedRef.current || !queryDataItemId) return;
    if (dataItems.some((item) => item.id === queryDataItemId)) {
      setSelectedId(queryDataItemId);
      queryLocatedRef.current = true;
    }
  }, [queryDataItemId, dataItems]);

  // 预加载任务模板，用于显示标注字段名称。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, TemplateField[]> = {};
      await Promise.all(
        tasks.map(async (task) => {
          const schema = await getTemplateSchemaAsync(task.templateId);
          if (schema) next[task.templateId] = schema.fields;
        }),
      );
      if (!cancelled) setTemplateMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  // 选中项真正变化时滚动到可见位置，列表刷新不触发滚动。
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = selectedId;
    if (!selectedId) return;
    const index = listRows.findIndex((row) => row.type === 'item' && row.item.id === selectedId);
    if (index >= 0) scrollListRowIntoView(index);
  }, [selectedId, listRows, scrollListRowIntoView]);

  function taskName(taskId: string) {
    return tasks.find((task) => task.id === taskId)?.name || taskId;
  }

  function fieldLabel(fieldKey: string) {
    const task = selectedItem ? tasks.find((item) => item.id === selectedItem.taskId) : undefined;
    const field = task
      ? templateMap[task.templateId]?.find((item) => item.fieldKey === fieldKey)
      : undefined;
    return field?.label || fieldKey;
  }

  function itemStatusTag(item: DataItem) {
    if (item.status === DataItemStatus.PENDING_REVIEW) {
      const ai = aiResultMap.get(item.id);
      return ai
        ? {
            color: aiStatusMeta(ai.reviewStatus).tagColor,
            label: `${aiStatusMeta(ai.reviewStatus).label} · ${ai.score}分`,
          }
        : { color: 'processing', label: '待审核' };
    }
    if (item.status === DataItemStatus.SUBMITTED) return { color: 'processing', label: '已提交' };
    if (item.status === DataItemStatus.REVIEWED) return { color: 'success', label: '已通过' };
    if (item.status === DataItemStatus.REJECTED) return { color: 'error', label: '已驳回' };
    return { color: 'default', label: statusLabel(item.status) };
  }

  function rememberLocalAction(id: string) {
    const map = recentLocalActionIdsRef.current;
    map.set(id, Date.now());
    const threshold = Date.now() - LOCAL_ACTION_DEBOUNCE_MS;
    for (const [key, ts] of map) {
      if (ts < threshold) map.delete(key);
    }
  }

  // 键盘上下切换条目，Enter 聚焦操作区。
  function onListKeydown(event: React.KeyboardEvent) {
    const ids = filteredItems.map((item) => item.id);
    if (ids.length === 0) return;

    const currentIdx = selectedId ? ids.indexOf(selectedId) : -1;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      let nextIdx: number;
      if (event.key === 'ArrowDown') {
        nextIdx = currentIdx < ids.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : ids.length - 1;
      }
      const nextId = ids[nextIdx]!;
      setSelectedId(nextId);
      const rowIndex = listRows.findIndex((row) => row.type === 'item' && row.item.id === nextId);
      if (rowIndex >= 0) scrollListRowIntoView(rowIndex);
    } else if (event.key === 'Enter' && selectedId) {
      event.preventDefault();
      const approveBtn = document.querySelector<HTMLElement>('.action-card .ant-btn-primary');
      approveBtn?.focus();
    }
  }

  /** 当前实际渲染顺序（listRows 拍平）中的条目行 */
  function getItemRows() {
    return listRows.filter(
      (row): row is { type: 'item'; key: string; item: DataItem } => row.type === 'item',
    );
  }

  function getItemRowIndex(id: string): number {
    return getItemRows().findIndex((row) => row.item.id === id);
  }

  /**
   * 审核完一条后，选中「刚刚处理那条的下一条可审核项」。
   * - 在筛选后的扁平列表里定位刚处理的项，取其后第一个仍可审核的项；
   * - 若该项已从列表消失（归档移除、或状态变化后不再匹配当前筛选），
   *   用操作前记录的 anchorIndex 定位：此时原位置上的行就是视觉上的"下一条"；
   * - 向后没有了，就近向前找最近的可审核项，避免跳回列表开头造成大幅滚动；
   * - 都没有则保持当前选中（交给自动选中 effect 兜底）。
   * 注：基于操作发起时渲染的 listRows 计算——除刚处理的条目外其余行未变化，
   * 结论与最新列表一致（查找显式跳过 currentId）。
   * @returns 是否找到并选中了下一条可审核项（false 表示当前列表已无可审核项）
   */
  function selectNextActionable(currentId: string, anchorIndex: number): boolean {
    const itemRows = getItemRows();
    const idx = itemRows.findIndex((row) => row.item.id === currentId);
    const start = idx >= 0 ? idx + 1 : Math.max(0, Math.min(anchorIndex, itemRows.length - 1));
    for (let i = start; i < itemRows.length; i++) {
      const row = itemRows[i];
      if (row && row.item.id !== currentId && REVIEW_ACTIONABLE_STATUSES.has(row.item.status)) {
        setSelectedId(row.item.id);
        return true;
      }
    }
    for (let i = Math.min(start, itemRows.length) - 1; i >= 0; i--) {
      const row = itemRows[i];
      if (row && row.item.id !== currentId && REVIEW_ACTIONABLE_STATUSES.has(row.item.status)) {
        setSelectedId(row.item.id);
        return true;
      }
    }
    return false;
  }

  async function approveSelected() {
    if (!selectedItem) return;
    setApproving(true);
    // 接口返回后条目可能被归档移除或因筛选不再显示，先记录其当前列表位置作为锚点
    const currentId = selectedItem.id;
    const anchorIndex = getItemRowIndex(currentId);
    try {
      await useAnnotationStore
        .getState()
        .approveItem(currentId, useAuthStore.getState().user?.username ?? '');
      message.success('审核通过');
      rememberLocalAction(currentId);
      // 依赖 store 的本地更新，避免重建数组导致列表位置跳动。
      // 列表里还有可审核项时按显示顺序依次走；全部审完才连续领取下一条。
      const hasNext = selectNextActionable(currentId, anchorIndex);
      if (!hasNext) await tryContinuousClaim();
    } catch (error) {
      modal.warning({
        title: '审核失败',
        content: error instanceof Error ? error.message : '审核通过失败',
      });
    } finally {
      setApproving(false);
    }
  }

  async function rejectSelected(reason: string) {
    if (!selectedItem) return;
    setRejecting(true);
    const currentId = selectedItem.id;
    const anchorIndex = getItemRowIndex(currentId);
    try {
      await useAnnotationStore
        .getState()
        .rejectItem(currentId, useAuthStore.getState().user?.username ?? '', reason);
      message.success('已驳回');
      setRejectModalOpen(false);
      rememberLocalAction(currentId);
      const hasNext = selectNextActionable(currentId, anchorIndex);
      if (!hasNext) await tryContinuousClaim();
    } catch (error) {
      modal.warning({
        title: '审核失败',
        content: error instanceof Error ? error.message : '驳回失败',
      });
    } finally {
      setRejecting(false);
    }
  }

  return (
    <section className="review-workbench">
      <header className="review-header">
        <Space>
          <Typography.Title level={4} className="page-title">
            审核工作台
          </Typography.Title>
          <Tag color="blue">
            {filteredItems.length} / {reviewableItems.length} 条
          </Tag>
          <Tag color={socketConnected ? 'green' : 'default'}>
            {socketConnected ? '实时已连接' : '实时未连接'}
          </Tag>
        </Space>
        <Space wrap>
          <Button size="small" icon={<InboxOutlined />} onClick={() => void openClaimModal()}>
            领取审核
          </Button>
          <Checkbox
            checked={continuousClaimEnabled}
            onChange={(event) => setContinuousClaimEnabled(event.target.checked)}
          >
            连续领取
          </Checkbox>
          <Button
            size="small"
            disabled={!selectedItem}
            icon={<HistoryOutlined />}
            onClick={() => setFlowModalOpen(true)}
          >
            流转记录
          </Button>
          {storeLoading && <Spin size="small" />}
        </Space>
      </header>

      {storeError && (
        <Alert
          type="error"
          showIcon
          closable
          message={storeError}
          className="page-alert"
          onClose={() => useAnnotationStore.setState({ error: null })}
        />
      )}

      <Card size="small" className={`filter-card${hasActiveFilters ? ' filter-card--active' : ''}`}>
        <div className="filter-card-content">
          <Space wrap className="filter-controls">
            <Space size="small" className={hasActiveFilters ? 'filter-label--active' : undefined}>
              <FilterOutlined />
              <span>筛选</span>
            </Space>
            <Select
              value={filters.status}
              allowClear
              placeholder="审核状态"
              size="small"
              className="filter-select"
              options={statusFilterOptions}
              onChange={(value) => setFilter({ status: value })}
            />
            <Select
              value={filters.taskId}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="所属任务"
              size="small"
              className="filter-select filter-select--wide"
              options={taskOptions}
              onChange={(value) => setFilter({ taskId: value })}
            />
            <Select
              value={filters.annotator}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="标注员"
              size="small"
              className="filter-select"
              options={annotatorOptions}
              onChange={(value) => setFilter({ annotator: value })}
            />
            <Select
              value={filters.aiReviewResult}
              allowClear
              placeholder="预审结论"
              size="small"
              className="filter-select"
              options={aiReviewFilterOptions}
              onChange={(value) => setFilter({ aiReviewResult: value })}
            />
            <Input
              value={filters.keyword}
              allowClear
              placeholder="搜索文件名/描述/ID"
              size="small"
              className="keyword-input"
              onChange={(event) => setFilter({ keyword: event.target.value })}
            />
            {hasActiveFilters && (
              <Button
                type="link"
                size="small"
                danger
                icon={<ClearOutlined />}
                onClick={clearFilters}
              >
                清除
              </Button>
            )}
          </Space>

          {canReviewSelected && (
            <Space className="filter-review-actions">
              <Button
                type="primary"
                loading={approving}
                icon={<CheckCircleOutlined />}
                onClick={() => void approveSelected()}
              >
                审核通过
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => setRejectModalOpen(true)}
              >
                驳回
              </Button>
            </Space>
          )}
        </div>
      </Card>

      <Spin
        spinning={storeLoading && reviewableItems.length === 0}
        wrapperClassName="review-spin-wrapper"
      >
        {reviewableItems.length === 0 ? (
          <Card className="empty-card">
            <Empty description="暂无已领取的审核数据">
              <Space direction="vertical" align="center">
                <Typography.Text type="secondary">
                  可点击“领取审核”从任务池领取待审数据。
                </Typography.Text>
                <Button
                  type="primary"
                  icon={<InboxOutlined />}
                  onClick={() => void openClaimModal()}
                >
                  领取审核
                </Button>
              </Space>
            </Empty>
          </Card>
        ) : (
          <div className="review-main">
            <Card
              title="审核列表"
              size="small"
              className="review-list-card"
              styles={{ body: { padding: 0 } }}
            >
              {filteredItems.length === 0 ? (
                <Empty description="没有匹配筛选条件的数据" className="list-empty" />
              ) : (
                <div
                  ref={listContainerRef}
                  className="review-list"
                  role="listbox"
                  aria-label="审核数据列表"
                  tabIndex={0}
                  onScroll={onListScroll}
                  onKeyDown={onListKeydown}
                >
                  {/* 用占位层撑起总高度，只渲染视口附近的行。 */}
                  <div className="review-list-phantom" style={{ height: `${listTotalHeight}px` }}>
                    {visibleListRows.map((row) => (
                      <div
                        key={row.data.key}
                        className="review-list-row"
                        style={{
                          transform: `translateY(${row.offset}px)`,
                          height: `${row.height}px`,
                        }}
                      >
                        {row.data.type === 'group' ? (
                          <div className="group-title">任务：{taskName(row.data.taskId)}</div>
                        ) : (
                          <button
                            type="button"
                            className={`review-list-item${
                              row.data.item.id === selectedId ? ' review-list-item--selected' : ''
                            }`}
                            role="option"
                            aria-selected={row.data.item.id === selectedId}
                            aria-label={`数据 ${String(row.data.item.rawData.fileName ?? row.data.item.id)}`}
                            onClick={() =>
                              setSelectedId(row.data.type === 'item' ? row.data.item.id : null)
                            }
                          >
                            <div className="item-title-row">
                              <Typography.Text strong ellipsis className="item-title">
                                {String(row.data.item.rawData.fileName ?? row.data.item.id)}
                              </Typography.Text>
                              <Tag color={itemStatusTag(row.data.item).color} className="item-tag">
                                {itemStatusTag(row.data.item).label}
                              </Tag>
                            </div>
                            <Typography.Paragraph
                              type="secondary"
                              ellipsis={{ rows: 1 }}
                              className="item-desc"
                            >
                              {String(row.data.item.rawData.description ?? '')}
                            </Typography.Paragraph>
                            <div className="item-meta">
                              {row.data.item.annotator ?? '未分配标注员'} ·{' '}
                              {formatShortTime(row.data.item.submittedAt)}
                            </div>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <Card title="审核内容" size="small" className="content-card">
              {!selectedItem ? (
                <Empty description="请选择待审核数据" />
              ) : (
                <>
                  <Descriptions
                    title="原始数据"
                    size="small"
                    bordered
                    column={1}
                    className="content-section"
                  >
                    {Object.entries(selectedItem.rawData).map(([key, value]) => (
                      <Descriptions.Item key={key} label={key}>
                        {key === 'imageUrl' ? (
                          <a
                            href={String(value)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="raw-link"
                          >
                            {String(value)}
                          </a>
                        ) : (
                          <span>{String(value)}</span>
                        )}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>

                  <Divider />

                  <Descriptions title="标注结果" size="small" bordered column={1}>
                    {!selectedItem.annotationData ? (
                      <Descriptions.Item label="标注数据">暂无标注数据</Descriptions.Item>
                    ) : (
                      Object.entries(selectedItem.annotationData).map(([key, value]) => (
                        <Descriptions.Item key={key} label={fieldLabel(key)}>
                          {Array.isArray(value) ? (
                            <span>{value.join(', ')}</span>
                          ) : (
                            <span>{String(value)}</span>
                          )}
                        </Descriptions.Item>
                      ))
                    )}
                  </Descriptions>
                </>
              )}
            </Card>

            <Card title="审核操作" size="small" className="action-card">
              {!selectedItem ? (
                <Empty description="请选择待审核数据">
                  <Space direction="vertical" align="center">
                    <Typography.Text type="secondary">
                      若列表为空，请先领取待审数据。
                    </Typography.Text>
                    <Button
                      type="primary"
                      icon={<InboxOutlined />}
                      onClick={() => void openClaimModal()}
                    >
                      领取审核
                    </Button>
                  </Space>
                </Empty>
              ) : (
                <>
                  {selectedAIReview && (
                    <Alert
                      type={aiStatusMeta(selectedAIReview.reviewStatus).alertType}
                      showIcon
                      className="ai-alert"
                      message={`${aiStatusMeta(selectedAIReview.reviewStatus).label} · ${selectedAIReview.score} 分`}
                      description={selectedAIReview.summary}
                    />
                  )}

                  {Boolean(selectedAIReview?.fieldWarnings?.length) && (
                    <Space direction="vertical" className="warning-stack">
                      {selectedAIReview?.fieldWarnings.map((warning, index) => (
                        <Alert
                          key={`${warning.fieldKey}-${index}`}
                          type={
                            warning.severity === 'error'
                              ? 'error'
                              : warning.severity === 'warning'
                                ? 'warning'
                                : 'info'
                          }
                          showIcon
                          message={warning.fieldLabel}
                          description={warning.message}
                        />
                      ))}
                    </Space>
                  )}

                  <Divider />

                  {selectedItem.status === DataItemStatus.REVIEWED && (
                    <Alert
                      type="success"
                      showIcon
                      message="该数据已审核通过"
                      description={`审核员：${selectedItem.reviewer ?? '未知'}；审核时间：${formatTime(selectedItem.reviewedAt)}`}
                    />
                  )}
                  {selectedItem.status === DataItemStatus.REJECTED && (
                    <Alert
                      type="error"
                      showIcon
                      message="该数据已被驳回"
                      description={selectedItem.rejectReason || '未填写驳回原因'}
                    />
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </Spin>

      <ClaimReviewModal
        open={claimModalOpen}
        loading={reviewPoolLoading}
        items={reviewPoolItems}
        claimingId={claimingId}
        batchClaiming={batchClaiming}
        selectedIds={selectedClaimIds}
        continuous={continuousClaimEnabled}
        taskNames={taskNameMap}
        onClose={() => setClaimModalOpen(false)}
        onContinuousChange={setContinuousClaimEnabled}
        onRefresh={() => void loadReviewPool()}
        onClaim={(id) => void claimReview(id)}
        onBatchClaim={() => void batchClaimReviews()}
        onSelectionChange={onClaimSelectionChange}
      />

      <AuditFlowModal
        open={flowModalOpen}
        records={selectedItem?.auditHistory ?? []}
        onClose={() => setFlowModalOpen(false)}
      />

      <RejectModal
        open={rejectModalOpen}
        loading={rejecting}
        onClose={() => setRejectModalOpen(false)}
        onConfirm={(reason) => void rejectSelected(reason)}
      />
    </section>
  );
}

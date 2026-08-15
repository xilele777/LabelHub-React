// 标注工作台，编辑标注内容并提交处理结果。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Progress,
  Radio,
  Rate,
  Result,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import {
  DataItemStatus,
  FieldType,
  Role,
  TaskStatus,
  type AnnotationTemplate,
  type DataItem,
  type TemplateField,
} from '../../types';
import { ReviewStatus, type Severity } from '../../types/aiReview';
import { useAnnotationStore, type AvailableItem } from '../../store/useAnnotationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useTaskStore } from '../../store/useTaskStore';
import { getTemplateSchemaAsync } from '../../utils/templateSchemaHelper';
import { SEMANTIC_COLORS } from '../../utils/statusMeta';
import { clearDraftRecord, useDraftPersistence } from '../../hooks/useDraftPersistence';
import { useCrossTabLock } from '../../hooks/useCrossTabLock';
import { useEditLock } from './hooks/useEditLock';
import { useLivePreReview } from './hooks/useLivePreReview';
import {
  getBooleanField,
  getDirection,
  getNumberField,
  getOptions,
  getStringField,
  getTitleLevel,
} from './fieldHelpers';
import {
  connectNotificationWS,
  getSocket,
  joinTaskRoom,
  leaveTaskRoom,
  type Notification,
} from '../../services/notificationWebSocket';
import './AnnotationWorkbench.css';

const dataStatusMeta: Record<DataItemStatus, { label: string; color: string }> = {
  [DataItemStatus.PENDING]: { label: '待标注', color: 'default' },
  [DataItemStatus.DRAFT]: { label: '草稿', color: 'processing' },
  [DataItemStatus.SUBMITTED]: { label: '已提交', color: 'success' },
  [DataItemStatus.PENDING_REVIEW]: { label: '待人工审核', color: 'orange' },
  [DataItemStatus.REVIEWED]: { label: '审核通过', color: 'green' },
  [DataItemStatus.REJECTED]: { label: '已驳回', color: 'red' },
};

const reviewStatusMeta: Record<
  ReviewStatus,
  {
    label: string;
    tagColor: string;
    strokeColor: string;
    alertType: 'success' | 'warning' | 'error';
  }
> = {
  [ReviewStatus.PASS]: {
    label: '通过',
    tagColor: 'success',
    strokeColor: SEMANTIC_COLORS.success,
    alertType: 'success',
  },
  [ReviewStatus.RISK]: {
    label: '风险',
    tagColor: 'warning',
    strokeColor: SEMANTIC_COLORS.warning,
    alertType: 'warning',
  },
  [ReviewStatus.FAIL]: {
    label: '不通过',
    tagColor: 'error',
    strokeColor: SEMANTIC_COLORS.danger,
    alertType: 'error',
  },
};

const REFRESH_NOTIFICATION_TYPES = new Set<string>([
  'task_assigned',
  'task_unassigned',
  'task_status_changed',
  'task_due_soon',
  'ai_review_complete',
  'review_rejected',
  'review_approved',
]);

function severityColor(severity: Severity) {
  return severity === 'error' ? 'red' : severity === 'warning' ? 'orange' : 'blue';
}

function severityLabel(severity: Severity) {
  return severity === 'error' ? '严重' : severity === 'warning' ? '警告' : '提示';
}

function formatLockTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未知';
}

function scrollToField(fieldKey: string) {
  document
    .querySelector(`[data-field-key="${fieldKey}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function isConflictError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === 409
  );
}

function SchemaTitleBlock({ field }: { field: TemplateField }) {
  const Tag = `h${getTitleLevel(field)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5';
  const content = getStringField(field, 'content');
  return (
    <section className="schema-title-block">
      <Tag className="schema-title">{field.label}</Tag>
      {content && <p className="schema-copy">{content}</p>}
      {field.description && <p className="schema-description">{field.description}</p>}
    </section>
  );
}

export default function AnnotationWorkbench() {
  const { message, modal } = App.useApp();
  const [searchParams] = useSearchParams();
  const queryTaskId = searchParams.get('taskId') ?? undefined;
  const queryDataItemId = searchParams.get('dataItemId') ?? undefined;

  const dataItems = useAnnotationStore((state) => state.dataItems);
  const currentIndex = useAnnotationStore((state) => state.currentIndex);
  const storeLoading = useAnnotationStore((state) => state.loading);
  const storeError = useAnnotationStore((state) => state.error);
  const conflictInfo = useAnnotationStore((state) => state.conflictInfo);
  const lockInfo = useAnnotationStore((state) => state.lockInfo);
  const availableItems = useAnnotationStore((state) => state.availableItems);
  const availableLoading = useAnnotationStore((state) => state.availableLoading);
  const tasks = useTaskStore((state) => state.tasks);
  const taskLoading = useTaskStore((state) => state.loading);
  const taskError = useTaskStore((state) => state.error);
  const user = useAuthStore((state) => state.user);

  const [templateSchema, setTemplateSchema] = useState<AnnotationTemplate | null>(null);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const templateRequestTokenRef = useRef(0);
  const [formState, setFormState] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimTaskId, setClaimTaskId] = useState<string>();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [batchClaiming, setBatchClaiming] = useState(false);
  const [selectedClaimIds, setSelectedClaimIds] = useState<string[]>([]);
  const joinedTaskIdsRef = useRef(new Set<string>());

  const currentItem: DataItem | undefined = dataItems[currentIndex];
  const currentItemId = currentItem?.id;
  const currentTask = currentItem
    ? tasks.find((task) => task.id === currentItem.taskId)
    : undefined;
  const sameTaskItems = useMemo(
    () => (currentItem ? dataItems.filter((item) => item.taskId === currentItem.taskId) : []),
    [dataItems, currentItem],
  );
  const currentIndexInTask = currentItem
    ? sameTaskItems.findIndex((item) => item.id === currentItem.id)
    : -1;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < dataItems.length - 1;
  const isReadOnly = (() => {
    const status = currentItem?.status;
    return (
      status === DataItemStatus.SUBMITTED ||
      status === DataItemStatus.PENDING_REVIEW ||
      status === DataItemStatus.REVIEWED
    );
  })();

  // 跨标签页锁检测（按条目区分）。
  const crossTab = useCrossTabLock(user?.id ?? '');
  const isCrossTabLocked = Boolean(currentItem && crossTab.lockedItemId === currentItem.id);
  const isEditable = !isReadOnly && !conflictInfo && !lockInfo && !isCrossTabLocked;
  const canSaveDraft = !isReadOnly && currentItem?.status !== DataItemStatus.REJECTED;

  // 实时预审。
  const { liveReviewResult, riskStats, sortedWarnings, fieldValidateStatus, fieldHelp } =
    useLivePreReview({
      templateSchema,
      currentItem: currentItem ?? null,
      formState,
    });

  // 可编辑条目进入时加锁，切换、提交或离开时释放。
  const { acquiring: lockAcquiring, retry: retryAcquireLock } = useEditLock({
    itemId: currentItem?.id ?? null,
    enabled:
      Boolean(currentItem) && !isReadOnly && user?.role === Role.ANNOTATOR && !isCrossTabLocked,
    claim: async (id) => {
      const result = await useAnnotationStore.getState().claimItem(id);
      const userId = useAuthStore.getState().user?.id;
      if (result && userId) {
        crossTab.broadcastLock(id, userId);
      }
      return result;
    },
    release: async (id) => {
      crossTab.broadcastRelease(id);
      await useAnnotationStore.getState().releaseItem(id);
    },
  });

  const refreshWorkbenchData = useCallback(async () => {
    const store = useAnnotationStore.getState();
    await Promise.all([store.fetchDataItems(queryTaskId), store.fetchAIReviews(queryTaskId)]);
  }, [queryTaskId]);

  // 初始加载：任务列表 + 标注数据 + 预审结果
  useEffect(() => {
    void useTaskStore.getState().fetchTasks();
    void refreshWorkbenchData();
  }, [refreshWorkbenchData]);

  // WebSocket 负责连接恢复、任务房间重进和相关通知刷新数据。
  const socketCtxRef = useRef({ refreshWorkbenchData, claimModalOpen, claimTaskId });
  useEffect(() => {
    socketCtxRef.current = { refreshWorkbenchData, claimModalOpen, claimTaskId };
  });

  useEffect(() => {
    const token = useAuthStore.getState().token || localStorage.getItem('token');
    if (token) connectNotificationWS(token);

    const socket = getSocket();
    if (!socket) return;

    const joined = joinedTaskIdsRef.current;
    const handleConnect = () => {
      joined.forEach((taskId) => joinTaskRoom(taskId));
    };
    const handleNotification = (notification: Notification) => {
      if (!REFRESH_NOTIFICATION_TYPES.has(notification.type)) return;
      const dataItemId = notification.data?.dataItemId;
      if (notification.type === 'review_approved' && typeof dataItemId === 'string') {
        clearDraftRecord(dataItemId);
        void useAnnotationStore.getState().fetchArchivedItems();
      }
      void useTaskStore.getState().fetchTasks();
      void socketCtxRef.current.refreshWorkbenchData();
      if (socketCtxRef.current.claimModalOpen) {
        void useAnnotationStore.getState().fetchAvailableItems(socketCtxRef.current.claimTaskId);
      }
    };

    socket.on('connect', handleConnect);
    socket.on('notification', handleNotification);
    return () => {
      socket.off('connect', handleConnect);
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

  // 根据查询参数定位条目，并将越界索引归零。
  useEffect(() => {
    if (dataItems.length === 0) return;
    if (queryDataItemId) {
      const targetIndex = dataItems.findIndex((item) => item.id === queryDataItemId);
      if (targetIndex >= 0 && targetIndex !== currentIndex) {
        useAnnotationStore.getState().setCurrentIndex(targetIndex);
      }
      return;
    }
    if (currentIndex >= dataItems.length) {
      useAnnotationStore.getState().setCurrentIndex(0);
    }
  }, [dataItems, queryDataItemId, currentIndex]);

  // 随当前任务加载模板结构，并丢弃过期请求的响应。
  const currentTemplateId = currentTask?.templateId;
  useEffect(() => {
    const requestToken = ++templateRequestTokenRef.current;
    setTemplateSchema(null);
    setTemplateError(null);

    if (!currentTemplateId) {
      setTemplateLoading(false);
      return;
    }

    setTemplateLoading(true);
    getTemplateSchemaAsync(currentTemplateId)
      .then((schema) => {
        if (templateRequestTokenRef.current !== requestToken) return;
        setTemplateSchema(schema ?? null);
      })
      .catch((error: unknown) => {
        if (templateRequestTokenRef.current !== requestToken) return;
        const messageText = error instanceof Error ? error.message : '加载标注模板失败';
        setTemplateError(`模板 ${currentTemplateId} 加载失败：${messageText}`);
      })
      .finally(() => {
        if (templateRequestTokenRef.current === requestToken) {
          setTemplateLoading(false);
        }
      });
  }, [currentTemplateId]);

  function retryLoadTemplate() {
    const templateId = currentTemplateId;
    const requestToken = ++templateRequestTokenRef.current;
    setTemplateSchema(null);
    setTemplateError(null);
    if (!templateId) return;
    setTemplateLoading(true);
    getTemplateSchemaAsync(templateId)
      .then((schema) => {
        if (templateRequestTokenRef.current !== requestToken) return;
        setTemplateSchema(schema ?? null);
      })
      .catch((error: unknown) => {
        if (templateRequestTokenRef.current !== requestToken) return;
        const messageText = error instanceof Error ? error.message : '加载标注模板失败';
        setTemplateError(`模板 ${templateId} 加载失败：${messageText}`);
      })
      .finally(() => {
        if (templateRequestTokenRef.current === requestToken) {
          setTemplateLoading(false);
        }
      });
  }

  async function retryLoadDependencies() {
    await useTaskStore.getState().fetchTasks();
    await refreshWorkbenchData();
  }

  // 切换条目 → 以服务端 annotationData 重置表单。
  // 声明顺序必须在 useDraftPersistence 之前：先重置，草稿恢复后覆盖
  useEffect(() => {
    const item = useAnnotationStore
      .getState()
      .dataItems.find((dataItem) => dataItem.id === currentItemId);
    setFormState({ ...(item?.annotationData ?? {}) });
  }, [currentItemId]);

  // 自动保存草稿，并在恢复时校验服务端版本。
  const draft = useDraftPersistence({
    key: !isReadOnly ? (currentItem?.id ?? null) : null,
    version: currentItem?.version ?? 1,
    snapshot: formState,
    baselineSnapshot: { ...(currentItem?.annotationData ?? {}) },
    restore: (data) => setFormState({ ...data }),
    onRestored: () => message.info('已恢复本地未提交的草稿修改'),
  });

  function setFieldValue(key: string, value: unknown) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  function goPrev() {
    if (canPrev) useAnnotationStore.getState().setCurrentIndex(currentIndex - 1);
  }

  function goNext() {
    if (canNext) useAnnotationStore.getState().setCurrentIndex(currentIndex + 1);
  }

  async function saveDraft() {
    if (!currentItem || !user) return;
    try {
      await useAnnotationStore
        .getState()
        .saveDraft(currentItem.id, { ...formState }, user.username);
      message.success('草稿已保存');
      draft.clear();
    } catch (error) {
      if (!isConflictError(error)) message.error('保存草稿失败');
    }
  }

  async function submitCurrent() {
    if (!currentItem || !user) return;
    try {
      setSubmitting(true);
      if (currentItem.status === DataItemStatus.REJECTED) {
        await useAnnotationStore
          .getState()
          .resubmitItem(currentItem.id, { ...formState }, user.username);
        message.success('标注已重新提交，规则预审已完成');
      } else {
        await useAnnotationStore
          .getState()
          .submitAnnotation(currentItem.id, { ...formState }, user.username);
        message.success('标注已提交，规则预审已完成');
      }
      draft.clear();
    } catch (error) {
      if (!isConflictError(error)) {
        modal.warning({
          title: '提交失败',
          content: error instanceof Error ? error.message : '提交失败，请稍后重试',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resolveConflict() {
    if (!currentItem) return;
    useAnnotationStore.getState().resolveConflictWithServer(currentItem.id);
    message.success('已同步为服务端最新数据');
  }

  function openClaimModal() {
    setClaimModalOpen(true);
    setSelectedClaimIds([]);
    const initialTaskId = queryTaskId ?? currentItem?.taskId;
    setClaimTaskId(initialTaskId);
    void useAnnotationStore.getState().fetchAvailableItems(initialTaskId);
  }

  async function claimOneItem(id: string) {
    setClaimingId(id);
    const ok = await useAnnotationStore.getState().claimAssignment(id);
    setClaimingId(null);
    if (!ok) {
      message.error('领取失败');
      return;
    }
    setClaimModalOpen(false);
    focusItem(id);
    message.success('领取成功');
  }

  async function claimSelectedItems() {
    if (selectedClaimIds.length === 0) return;
    setBatchClaiming(true);
    const result = await useAnnotationStore.getState().batchClaimAssignments(selectedClaimIds);
    setBatchClaiming(false);
    if (!result) {
      message.error('批量领取失败');
      return;
    }
    const first = result.claimed[0];
    if (first) {
      setClaimModalOpen(false);
      focusItem(first.id);
    }
    message.success(`已领取 ${result.claimedCount} 条标注任务`);
  }

  function focusItem(id: string) {
    const store = useAnnotationStore.getState();
    const index = store.dataItems.findIndex((item) => item.id === id);
    if (index >= 0) store.setCurrentIndex(index);
  }

  function taskName(taskId: string) {
    return tasks.find((task) => task.id === taskId)?.name || taskId;
  }

  const statusMeta = dataStatusMeta[currentItem?.status ?? DataItemStatus.PENDING];
  const progressCurrent = (() => {
    const status = currentItem?.status;
    if (
      status === DataItemStatus.PENDING ||
      status === DataItemStatus.DRAFT ||
      status === DataItemStatus.REJECTED
    )
      return 0;
    if (status === DataItemStatus.SUBMITTED) return 1;
    if (status === DataItemStatus.PENDING_REVIEW) return 2;
    return 3;
  })();
  const progressItems = [
    { title: currentItem?.status === DataItemStatus.DRAFT ? '草稿' : '标注' },
    { title: '预审' },
    { title: '审核' },
    { title: '完成' },
  ];
  const prettyRawData = JSON.stringify(currentItem?.rawData ?? {}, null, 2);

  const liveReviewMeta = reviewStatusMeta[liveReviewResult.reviewStatus];
  const reviewDescription =
    liveReviewResult.fieldWarnings.length === 0
      ? '当前表单数据未触发必填、评分范围或文本长度等预审规则。'
      : `发现 ${riskStats.error} 个严重问题、${riskStats.warning} 个警告、${riskStats.info} 个提示。`;

  const runningTaskOptions = tasks
    .filter((task) => task.status === TaskStatus.IN_PROGRESS)
    .map((task) => ({ label: task.name, value: task.id }));

  const claimColumns: TableColumnsType<AvailableItem> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 116, ellipsis: true },
    {
      title: '任务',
      dataIndex: 'taskId',
      key: 'taskId',
      width: 132,
      ellipsis: true,
      responsive: ['md'],
      render: (value: string) => taskName(value),
    },
    { title: '数据预览', dataIndex: 'rawDataPreview', key: 'rawDataPreview', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 76,
      render: (_: unknown, record: AvailableItem) => (
        <Button
          size="small"
          type="primary"
          loading={claimingId === record.id}
          onClick={() => void claimOneItem(record.id)}
        >
          领取
        </Button>
      ),
    },
  ];

  function renderFieldControl(field: TemplateField) {
    const key = field.fieldKey;
    const value = formState[key];

    switch (field.type) {
      case FieldType.INPUT: {
        const maxLength = getNumberField(field, 'maxLength');
        return (
          <Input
            value={(value as string) ?? ''}
            placeholder={field.placeholder}
            maxLength={maxLength}
            showCount={Boolean(maxLength)}
            onChange={(event) => setFieldValue(key, event.target.value)}
          />
        );
      }
      case FieldType.TEXTAREA: {
        const maxLength = getNumberField(field, 'maxLength');
        return (
          <Input.TextArea
            value={(value as string) ?? ''}
            placeholder={field.placeholder}
            maxLength={maxLength}
            showCount={Boolean(maxLength)}
            autoSize={getBooleanField(field, 'autoSize') ? { minRows: 3, maxRows: 8 } : false}
            onChange={(event) => setFieldValue(key, event.target.value)}
          />
        );
      }
      case FieldType.RADIO:
        return (
          <Radio.Group
            value={value}
            options={getOptions(field)}
            className={getDirection(field) === 'vertical' ? 'choice-group--vertical' : undefined}
            onChange={(event) => setFieldValue(key, event.target.value)}
          />
        );
      case FieldType.CHECKBOX:
        return (
          <Checkbox.Group
            value={(value as Array<string | number>) ?? []}
            options={getOptions(field)}
            className={getDirection(field) === 'vertical' ? 'choice-group--vertical' : undefined}
            onChange={(values) => setFieldValue(key, values)}
          />
        );
      case FieldType.SELECT:
        return (
          <Select
            value={value as string | number | Array<string | number> | undefined}
            placeholder={field.placeholder}
            showSearch={getBooleanField(field, 'searchable')}
            mode={getBooleanField(field, 'multiple') ? 'multiple' : undefined}
            options={getOptions(field)}
            allowClear
            onChange={(selected) => setFieldValue(key, selected)}
          />
        );
      case FieldType.RATING:
        return (
          <Rate
            value={(value as number) ?? 0}
            count={getNumberField(field, 'maxScore', 5)}
            allowHalf={getBooleanField(field, 'allowHalf')}
            onChange={(rating) => setFieldValue(key, rating)}
          />
        );
      case FieldType.SWITCH:
        return (
          <Switch
            checked={Boolean(value)}
            checkedChildren={getStringField(field, 'checkedChildren', '是')}
            unCheckedChildren={getStringField(field, 'unCheckedChildren', '否')}
            onChange={(checked) => setFieldValue(key, checked)}
          />
        );
      default:
        return null;
    }
  }

  function renderContent() {
    if (!storeLoading && dataItems.length === 0) {
      return (
        <Empty description="暂无分配给您的标注数据">
          <Space direction="vertical" align="center">
            <Typography.Text type="secondary">
              可以等待负责人分配，或从任务池领取待标注数据。
            </Typography.Text>
            <Button type="primary" onClick={openClaimModal}>
              领取标注任务
            </Button>
          </Space>
        </Empty>
      );
    }

    if (currentItem && currentTask && templateSchema) {
      return (
        <>
          <Card size="small" className="workbench-header">
            <div className="header-row">
              <Space wrap>
                <Typography.Title level={5} className="task-title">
                  {currentTask.name || '标注任务'}
                </Typography.Title>
                <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
                <Typography.Text type="secondary">
                  {currentIndexInTask + 1} / {sameTaskItems.length}
                </Typography.Text>
              </Space>
              <Steps
                size="small"
                current={progressCurrent}
                className="progress-steps"
                items={progressItems}
              />
            </div>
            {currentTask.instructions && (
              <Typography.Text type="secondary" className="task-instructions">
                {currentTask.instructions}
              </Typography.Text>
            )}
          </Card>

          {conflictInfo && (
            <Alert
              type="error"
              showIcon
              className="page-alert"
              message="并发冲突：数据已被其他操作修改"
              description={`服务器版本为 ${conflictInfo.currentVersion}，请先同步服务端数据后再继续提交。`}
              action={
                <Space>
                  <Button size="small" danger onClick={resolveConflict}>
                    使用服务端数据
                  </Button>
                  <Button
                    size="small"
                    onClick={() => useAnnotationStore.getState().clearConflict()}
                  >
                    稍后处理
                  </Button>
                </Space>
              }
            />
          )}

          {lockInfo && (
            <Alert
              type="warning"
              showIcon
              className="page-alert"
              message="该数据正在被其他人编辑（悲观锁生效）"
              description={`持锁人：${lockInfo.lockedBy || '未知'}；加锁时间：${formatLockTime(lockInfo.lockedAt)}。锁超时 30 分钟后自动释放。`}
              action={
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    loading={lockAcquiring}
                    onClick={() => void retryAcquireLock()}
                  >
                    重试加锁
                  </Button>
                  <Button
                    size="small"
                    onClick={() => useAnnotationStore.getState().clearConflict()}
                  >
                    稍后处理
                  </Button>
                </Space>
              }
            />
          )}

          {isCrossTabLocked && (
            <Alert
              type="warning"
              showIcon
              className="page-alert"
              message="该数据正在本浏览器的另一个标签页中编辑"
              description="同一账号同时只能在一个标签页编辑同一条数据，请切回原标签页继续，或在原标签页离开该条目后再编辑。"
            />
          )}

          <div className="workbench-main">
            <Card title="原始数据" size="small" className="panel-card raw-panel">
              <pre className="raw-json">{prettyRawData}</pre>
            </Card>

            <Card
              size="small"
              className="panel-card form-panel"
              title={
                <Space>
                  <span>标注表单</span>
                  <Tag color={liveReviewMeta.tagColor}>{liveReviewMeta.label}</Tag>
                  <Tag>{liveReviewResult.score} 分</Tag>
                </Space>
              }
            >
              <Alert
                type={liveReviewMeta.alertType}
                showIcon
                className="review-alert"
                message={liveReviewResult.summary}
                description={reviewDescription}
              />

              <Form layout="vertical" className="dynamic-form" disabled={!isEditable}>
                {templateSchema.fields.map((field) =>
                  field.type === FieldType.TITLE ? (
                    <SchemaTitleBlock key={field.id} field={field} />
                  ) : (
                    <div key={field.id} data-field-key={field.fieldKey}>
                      <Form.Item
                        required={field.required}
                        label={
                          <span className="field-label">
                            {field.label}
                            {field.description && (
                              <Tooltip title={field.description}>
                                <QuestionCircleOutlined className="field-help-icon" />
                              </Tooltip>
                            )}
                          </span>
                        }
                        validateStatus={fieldValidateStatus(field.fieldKey)}
                        help={fieldHelp(field.fieldKey)}
                      >
                        {renderFieldControl(field)}
                      </Form.Item>
                    </div>
                  ),
                )}
              </Form>
            </Card>

            <Card title="实时预审" size="small" className="panel-card review-panel">
              <div className="score-box">
                <Progress
                  type="dashboard"
                  percent={liveReviewResult.score}
                  strokeColor={liveReviewMeta.strokeColor}
                />
                <Typography.Text strong style={{ color: liveReviewMeta.strokeColor }}>
                  {liveReviewMeta.label}
                </Typography.Text>
              </div>

              <Space wrap className="risk-tags">
                <Tag color="red">严重 {riskStats.error}</Tag>
                <Tag color="orange">警告 {riskStats.warning}</Tag>
                <Tag color="blue">提示 {riskStats.info}</Tag>
              </Space>

              {liveReviewResult.fieldWarnings.length === 0 ? (
                <Empty description="未发现预审风险" />
              ) : (
                <List
                  size="small"
                  dataSource={sortedWarnings}
                  className="warning-list"
                  renderItem={(item) => (
                    <List.Item
                      className="warning-item"
                      onClick={() => scrollToField(item.fieldKey)}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <Tag color={severityColor(item.severity)}>
                              {severityLabel(item.severity)}
                            </Tag>
                            <Typography.Text strong>{item.fieldLabel}</Typography.Text>
                          </Space>
                        }
                        description={<span>{item.message}</span>}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </div>

          <Card size="small" className="footer-actions">
            <div className="footer-row">
              <Space>
                <Button disabled={!canPrev} onClick={goPrev}>
                  上一条
                </Button>
                <Button disabled={!canNext} onClick={goNext}>
                  下一条
                </Button>
                <Button onClick={openClaimModal}>领取更多</Button>
              </Space>
              <Space>
                {canSaveDraft && (
                  <Button disabled={Boolean(conflictInfo)} onClick={() => void saveDraft()}>
                    保存草稿
                  </Button>
                )}
                {!isReadOnly ? (
                  <Button
                    type="primary"
                    loading={submitting}
                    disabled={Boolean(conflictInfo) || riskStats.error > 0}
                    onClick={() => void submitCurrent()}
                  >
                    {currentItem.status === DataItemStatus.REJECTED ? '重新提交' : '提交'}
                  </Button>
                ) : (
                  <Tag color="success">已提交</Tag>
                )}
              </Space>
            </div>
          </Card>
        </>
      );
    }

    if (currentItem && taskLoading) {
      return <Spin className="page-loading" tip="正在加载关联任务…" />;
    }

    if (currentItem && taskError) {
      return (
        <Result
          status="error"
          title="任务信息加载失败"
          subTitle={taskError}
          extra={
            <Button type="primary" onClick={() => void retryLoadDependencies()}>
              重试
            </Button>
          }
        />
      );
    }

    if (currentItem && !currentTask) {
      return (
        <Result
          status="warning"
          title="关联任务不存在或不可用"
          subTitle="当前标注数据关联的任务未能加载，可能已被删除或配置异常。"
          extra={
            <Button type="primary" onClick={() => void retryLoadDependencies()}>
              重新加载
            </Button>
          }
        />
      );
    }

    if (currentTask && !currentTask.templateId) {
      return (
        <Result
          status="warning"
          title="任务未配置模板"
          subTitle="请联系负责人为该任务绑定标注模板后再继续。"
          extra={
            <Button type="primary" onClick={() => void retryLoadDependencies()}>
              重新加载
            </Button>
          }
        />
      );
    }

    if (currentItem && currentTask && templateLoading) {
      return <Spin className="page-loading" tip="正在加载标注模板…" />;
    }

    if (currentItem && currentTask && templateError) {
      return (
        <Result
          status="error"
          title="标注模板加载失败"
          subTitle={templateError}
          extra={
            <Space>
              <Button type="primary" onClick={retryLoadTemplate}>
                重试加载模板
              </Button>
              <Button onClick={() => void retryLoadDependencies()}>刷新全部依赖</Button>
            </Space>
          }
        />
      );
    }

    if (currentItem && currentTask && !templateSchema) {
      return (
        <Result
          status="warning"
          title="未找到标注模板"
          subTitle={`模板 ${currentTask.templateId} 不存在或已被删除。`}
          extra={
            <Space>
              <Button type="primary" onClick={retryLoadTemplate}>
                重试加载模板
              </Button>
              <Button onClick={() => void retryLoadDependencies()}>刷新全部依赖</Button>
            </Space>
          }
        />
      );
    }

    return <Spin className="page-loading" />;
  }

  return (
    <Spin spinning={storeLoading && dataItems.length === 0}>
      <section className="annotation-workbench">
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

        {renderContent()}
      </section>

      <Modal
        open={claimModalOpen}
        title="领取标注任务"
        width={760}
        footer={null}
        destroyOnClose
        onCancel={() => setClaimModalOpen(false)}
      >
        <div className="lh-modal-stack">
          <Space wrap className="aw-claim-toolbar lh-modal-toolbar">
            <Select
              value={claimTaskId}
              allowClear
              placeholder="全部任务"
              className="aw-claim-select"
              options={runningTaskOptions}
              onChange={(value) => setClaimTaskId(value)}
            />
            <Button
              onClick={() => void useAnnotationStore.getState().fetchAvailableItems(claimTaskId)}
            >
              刷新
            </Button>
            <Button
              type="primary"
              loading={batchClaiming}
              disabled={selectedClaimIds.length === 0}
              onClick={() => void claimSelectedItems()}
            >
              批量领取 {selectedClaimIds.length || ''}
            </Button>
          </Space>
          <Table<AvailableItem>
            rowKey="id"
            size="small"
            className="lh-modal-table"
            loading={availableLoading}
            dataSource={availableItems}
            pagination={{ pageSize: 8 }}
            rowSelection={{
              selectedRowKeys: selectedClaimIds,
              onChange: (keys) => setSelectedClaimIds(keys.map(String)),
            }}
            columns={claimColumns}
          />
        </div>
      </Modal>
    </Spin>
  );
}

// 任务详情页面，展示任务信息并管理成员与状态。
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType, TabsProps } from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  ImportOutlined,
  InboxOutlined,
  RocketOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router';
import { batchImportItems } from '../../api/annotation';
import { Role, TaskStatus, type DataItem } from '../../types';
import { getDataStatusMeta, getTaskStatusMeta, getTaskTypeMeta } from '../../utils/statusMeta';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useTaskStore } from '../../store/useTaskStore';
import AnnotationAssignmentPanel from './components/AnnotationAssignmentPanel';
import ReviewAssignmentPanel from './components/ReviewAssignmentPanel';
import './TaskDetail.css';

const PREVIEW_COLUMNS = [
  { title: '序号', dataIndex: 'key', key: 'key', width: 80 },
  { title: 'rawData 摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
];

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function formatRange(start: string | null, end: string | null) {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function stringify(value: unknown) {
  return value === null || value === undefined ? '-' : JSON.stringify(value);
}

export default function TaskDetail() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const taskId = searchParams.get('id') ?? '';

  const role = useAuthStore((state) => state.role);
  const tasks = useTaskStore((state) => state.tasks);
  const archivedTasks = useTaskStore((state) => state.archivedTasks);
  const dataItems = useAnnotationStore((state) => state.dataItems);
  const itemsLoading = useAnnotationStore((state) => state.loading);

  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [previewData, setPreviewData] = useState<Array<{ rawData: Record<string, unknown> }>>([]);
  const [activeTab, setActiveTab] = useState('data');

  const task =
    tasks.find((item) => item.id === taskId) ?? archivedTasks.find((item) => item.id === taskId);
  const isArchived = archivedTasks.some((item) => item.id === taskId);
  const isManager = role === Role.ADMIN || role === Role.OWNER;

  const canEditTask = Boolean(
    task && !isArchived && [TaskStatus.DRAFT, TaskStatus.PENDING].includes(task.status),
  );
  const canPublishTask = canEditTask;
  const canArchiveTask = Boolean(
    task &&
    isManager &&
    !isArchived &&
    [TaskStatus.COMPLETED, TaskStatus.ENDED].includes(task.status),
  );

  const loadItems = useCallback(() => {
    if (taskId) void useAnnotationStore.getState().fetchDataItems(taskId);
  }, [taskId]);

  useEffect(() => {
    void useTaskStore.getState().fetchTasks();
    void useTaskStore.getState().fetchArchivedTasks();
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const previewRows = useMemo(
    () => previewData.map((item, index) => ({ key: index + 1, summary: stringify(item.rawData) })),
    [previewData],
  );

  const itemColumns = useMemo<TableColumnsType<DataItem>>(
    () => [
      { title: 'ID', dataIndex: 'id', key: 'id', width: 120, ellipsis: true },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 104,
        render: (_: unknown, record: DataItem) => {
          const meta = getDataStatusMeta(record.status);
          return <Tag color={meta.color}>{meta.label}</Tag>;
        },
      },
      { title: '标注员', dataIndex: 'annotator', key: 'annotator', width: 104, responsive: ['md'] },
      { title: '审核员', dataIndex: 'reviewer', key: 'reviewer', width: 104, responsive: ['xl'] },
      {
        title: '原始数据',
        dataIndex: 'rawData',
        key: 'rawData',
        ellipsis: true,
        render: (_: unknown, record: DataItem) => {
          const text = stringify(record.rawData);
          return (
            <Tooltip title={text}>
              <span className="ellipsis-text">{text}</span>
            </Tooltip>
          );
        },
      },
      {
        title: '提交时间',
        dataIndex: 'submittedAt',
        key: 'submittedAt',
        width: 148,
        responsive: ['lg'],
        render: (value: string | null) => formatDate(value),
      },
    ],
    [],
  );

  async function publishTask() {
    if (!task) return;
    await useTaskStore.getState().updateTask(task.id, { status: TaskStatus.IN_PROGRESS });
    message.success('任务已发布');
  }

  async function archiveCurrentTask() {
    if (!task) return;
    await useTaskStore.getState().archiveTask(task.id);
    message.success('任务已归档');
    await navigate('/archive');
  }

  async function unarchiveCurrentTask() {
    if (!task) return;
    await useTaskStore.getState().unarchiveTask(task.id);
    message.success('已取消归档');
    await navigate('/archive');
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result ?? ''));
        const items: unknown[] = Array.isArray(parsed)
          ? parsed
          : ((parsed as { items?: unknown[] } | null)?.items ?? []);
        if (!Array.isArray(items) || items.length === 0) {
          message.error('JSON 文件格式错误：需要数组或 { items: [...] } 格式');
          return;
        }
        const rows = items.map((item) => ({
          rawData:
            item && typeof item === 'object' ? (item as Record<string, unknown>) : { value: item },
        }));
        setPreviewData(rows);
        message.success(`已解析 ${rows.length} 条数据`);
      } catch {
        message.error('JSON 解析失败，请检查文件格式');
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!taskId || previewData.length === 0) return;
    setImportLoading(true);
    try {
      const res = await batchImportItems(taskId, previewData);
      message.success(`成功导入 ${res.data.imported} 条数据`);
      setImportOpen(false);
      setPreviewData([]);
      loadItems();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImportLoading(false);
    }
  }

  const tabItems: TabsProps['items'] = [
    {
      key: 'data',
      label: '数据概览',
      children: (
        <Table<DataItem>
          rowKey="id"
          size="small"
          columns={itemColumns}
          dataSource={dataItems}
          loading={itemsLoading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      ),
    },
    ...(isManager
      ? [
          {
            key: 'assign',
            label: '标注分配',
            children: <AnnotationAssignmentPanel taskId={taskId} />,
          },
          {
            key: 'review-assign',
            label: '审核分配',
            children: <ReviewAssignmentPanel taskId={taskId} />,
          },
        ]
      : []),
  ];

  return (
    <section className="task-detail-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            任务详情
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            查看任务配置、数据明细与分配进度。
          </Typography.Text>
        </div>
      </header>

      {!task ? (
        <Empty description="未找到该任务">
          <Button onClick={() => void navigate('/tasks')}>返回列表</Button>
        </Empty>
      ) : (
        <>
          <Card>
            <Descriptions bordered column={2}>
              <Descriptions.Item label="任务名称">{task.name}</Descriptions.Item>
              <Descriptions.Item label="任务类型">
                <Tag color={getTaskTypeMeta(task.type).color}>
                  {getTaskTypeMeta(task.type).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="负责人">{task.owner}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={getTaskStatusMeta(task.status).color}>
                  {getTaskStatusMeta(task.status).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="绑定模板">{task.templateName}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDate(task.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="任务时间窗口">
                {formatRange(task.startsAt, task.dueAt)}
              </Descriptions.Item>
              <Descriptions.Item label="单项时限">
                标注 {task.annotationTimeoutHours ?? 24} 小时 / 审核 {task.reviewTimeoutHours ?? 24}{' '}
                小时
              </Descriptions.Item>
              <Descriptions.Item label="任务描述" span={2}>
                {task.description || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="任务说明" span={2}>
                <div className="pre-wrap">{task.instructions || '-'}</div>
              </Descriptions.Item>
            </Descriptions>

            <Space className="actions" wrap>
              <Button
                icon={<ArrowLeftOutlined />}
                onClick={() => void navigate(isArchived ? '/archive' : '/tasks')}
              >
                {isArchived ? '返回归档' : '返回列表'}
              </Button>
              {canEditTask && (
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => void navigate(`/tasks/edit?id=${task.id}`)}
                >
                  编辑任务
                </Button>
              )}
              {!isArchived && (
                <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
                  导入数据
                </Button>
              )}
              {canPublishTask && (
                <Button type="primary" icon={<RocketOutlined />} onClick={() => void publishTask()}>
                  发布任务
                </Button>
              )}
              {canArchiveTask && (
                <Popconfirm title="确认归档该任务？" onConfirm={() => void archiveCurrentTask()}>
                  <Button icon={<InboxOutlined />}>归档</Button>
                </Popconfirm>
              )}
              {isArchived && isManager && (
                <Popconfirm title="确认取消归档？" onConfirm={() => void unarchiveCurrentTask()}>
                  <Button icon={<UndoOutlined />}>取消归档</Button>
                </Popconfirm>
              )}
            </Space>
          </Card>

          <Card size="small" styles={{ body: { padding: '0 16px 16px' } }}>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
          </Card>
        </>
      )}

      <Modal
        open={importOpen}
        title="导入标注数据"
        width={720}
        okText={`确认导入（${previewData.length} 条）`}
        okButtonProps={{ disabled: previewData.length === 0 }}
        confirmLoading={importLoading}
        onOk={() => void handleImport()}
        onCancel={() => {
          setImportOpen(false);
          setPreviewData([]);
        }}
      >
        <div className="lh-modal-stack">
          <Alert
            type="info"
            showIcon
            message="请上传 JSON 文件，支持数组或 { items: [...] } 格式。每个元素会作为 rawData 导入。"
            className="import-alert"
          />
          <input type="file" accept=".json,application/json" onChange={handleFileChange} />

          {previewData.length > 0 && (
            <Table
              rowKey="key"
              size="small"
              className="preview-table lh-modal-table"
              columns={PREVIEW_COLUMNS}
              dataSource={previewRows}
              pagination={{ pageSize: 5, showSizeChanger: false }}
            />
          )}
        </div>
      </Modal>
    </section>
  );
}

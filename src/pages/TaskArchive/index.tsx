// 任务归档页面，查询已归档任务并查看归档信息。
import { useEffect, useState } from 'react';
import {
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
  Typography,
} from 'antd';
import type { TableColumnsType, TabsProps } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { Role, type DataItem, type TaskItem } from '../../types';
import { getDataStatusMeta, getTaskStatusMeta, getTaskTypeMeta } from '../../utils/statusMeta';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useTaskStore } from '../../store/useTaskStore';
import './TaskArchive.css';

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function stringify(value: unknown) {
  return value === null || value === undefined ? '-' : JSON.stringify(value, null, 2);
}

interface ArchivedTaskTableProps {
  isManager: boolean;
  onView(record: TaskItem): void;
  onUnarchive(id: string): void;
}

function ArchivedTaskTable({ isManager, onView, onUnarchive }: ArchivedTaskTableProps) {
  const archivedTasks = useTaskStore((state) => state.archivedTasks);

  const columns: TableColumnsType<TaskItem> = [
    { title: '任务名称', dataIndex: 'name', key: 'name', ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 112,
      render: (_: unknown, record: TaskItem) => {
        const meta = getTaskTypeMeta(record.type);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '原状态',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (_: unknown, record: TaskItem) => {
        const meta = getTaskStatusMeta(record.status);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: '负责人', dataIndex: 'owner', key: 'owner', width: 88, responsive: ['xl'] },
    {
      title: '归档时间',
      dataIndex: 'archivedAt',
      key: 'archivedAt',
      width: 148,
      responsive: ['lg'],
      render: (value: string | null) => formatDate(value),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: unknown, record: TaskItem) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => onView(record)}>
            查看
          </Button>
          {isManager && (
            <Popconfirm
              title="确认取消归档？任务将恢复到任务列表。"
              onConfirm={() => onUnarchive(record.id)}
            >
              <Button type="link" size="small">
                取消归档
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (archivedTasks.length === 0) return <Empty description="暂无归档任务" />;
  return (
    <Table<TaskItem>
      rowKey="id"
      columns={columns}
      dataSource={archivedTasks}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      scroll={{ x: 640 }}
    />
  );
}

interface ArchivedItemTableProps {
  isManager: boolean;
  onView(record: DataItem): void;
  onUnarchive(id: string): void;
}

function ArchivedItemTable({ isManager, onView, onUnarchive }: ArchivedItemTableProps) {
  const archivedItems = useAnnotationStore((state) => state.archivedItems);

  const columns: TableColumnsType<DataItem> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 120, ellipsis: true },
    { title: '所属任务', dataIndex: 'taskId', key: 'taskId', ellipsis: true },
    {
      title: '标注员',
      dataIndex: 'annotator',
      key: 'annotator',
      width: 92,
      responsive: ['md'],
      render: (value: string | null) => value || '-',
    },
    {
      title: '审核员',
      dataIndex: 'reviewer',
      key: 'reviewer',
      width: 92,
      responsive: ['xl'],
      render: (value: string | null) => value || '-',
    },
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
    {
      title: '归档时间',
      dataIndex: 'archivedAt',
      key: 'archivedAt',
      width: 148,
      responsive: ['xxl'],
      render: (value: string | null) => formatDate(value),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: unknown, record: DataItem) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => onView(record)}>
            查看
          </Button>
          {isManager && (
            <Popconfirm
              title="确认取消归档？标注项将恢复到标注列表。"
              onConfirm={() => onUnarchive(record.id)}
            >
              <Button type="link" size="small">
                取消归档
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (archivedItems.length === 0) return <Empty description="暂无归档标注项" />;
  return (
    <Table<DataItem>
      rowKey="id"
      columns={columns}
      dataSource={archivedItems}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      scroll={{ x: 660 }}
    />
  );
}

export default function TaskArchive() {
  const { message } = App.useApp();
  const role = useAuthStore((state) => state.role);
  const archivedTaskCount = useTaskStore((state) => state.archivedTasks.length);
  const archivedItemCount = useAnnotationStore((state) => state.archivedItems.length);

  const [activeTab, setActiveTab] = useState('tasks');
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [itemDetailOpen, setItemDetailOpen] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskItem | null>(null);
  const [currentItem, setCurrentItem] = useState<DataItem | null>(null);

  const isManager = role === Role.ADMIN || role === Role.OWNER;

  useEffect(() => {
    if (isManager) void useTaskStore.getState().fetchArchivedTasks();
    void useAnnotationStore.getState().fetchArchivedItems();
  }, [isManager]);

  function openTaskDetail(record: TaskItem) {
    setCurrentTask(record);
    setTaskDetailOpen(true);
  }

  function openItemDetail(record: DataItem) {
    setCurrentItem(record);
    setItemDetailOpen(true);
  }

  async function handleUnarchiveTask(id: string) {
    await useTaskStore.getState().unarchiveTask(id);
    message.success('已取消归档');
  }

  async function handleUnarchiveItem(id: string) {
    await useAnnotationStore.getState().unarchiveItem(id);
    message.success('已取消归档');
  }

  const itemTable = (
    <ArchivedItemTable
      isManager={isManager}
      onView={openItemDetail}
      onUnarchive={(id) => void handleUnarchiveItem(id)}
    />
  );

  const tabItems: TabsProps['items'] = [
    {
      key: 'tasks',
      label: `归档任务 (${archivedTaskCount})`,
      children: (
        <ArchivedTaskTable
          isManager={isManager}
          onView={openTaskDetail}
          onUnarchive={(id) => void handleUnarchiveTask(id)}
        />
      ),
    },
    { key: 'items', label: `归档标注项 (${archivedItemCount})`, children: itemTable },
  ];

  return (
    <section className="archive-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            <InboxOutlined />
            任务归档
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            查看历史任务和已归档标注项。
          </Typography.Text>
        </div>
        <div className="app-page-tools">
          {isManager && <Tag color="blue">归档任务 {archivedTaskCount}</Tag>}
          <Tag color="cyan">归档标注项 {archivedItemCount}</Tag>
        </div>
      </header>

      <Card className="archive-card">
        {isManager ? (
          <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
        ) : (
          itemTable
        )}
      </Card>

      <Modal
        open={taskDetailOpen}
        title="归档任务详情"
        width={680}
        footer={null}
        onCancel={() => setTaskDetailOpen(false)}
      >
        <div className="lh-modal-detail">
          {currentTask && (
            <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
              <Descriptions.Item label="任务名称">{currentTask.name}</Descriptions.Item>
              <Descriptions.Item label="类型">
                <Tag color={getTaskTypeMeta(currentTask.type).color}>
                  {getTaskTypeMeta(currentTask.type).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="原状态">
                <Tag color={getTaskStatusMeta(currentTask.status).color}>
                  {getTaskStatusMeta(currentTask.status).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="负责人">{currentTask.owner || '-'}</Descriptions.Item>
              <Descriptions.Item label="绑定模板">
                {currentTask.templateName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="归档时间">
                {formatDate(currentTask.archivedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="任务描述" span={2}>
                {currentTask.description || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="任务说明" span={2}>
                <div className="pre-wrap">{currentTask.instructions || '-'}</div>
              </Descriptions.Item>
            </Descriptions>
          )}
        </div>
      </Modal>

      <Modal
        open={itemDetailOpen}
        title="标注项详情"
        width={860}
        footer={null}
        onCancel={() => setItemDetailOpen(false)}
      >
        {currentItem && (
          <Space direction="vertical" size="middle" className="detail-body lh-modal-detail">
            <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
              <Descriptions.Item label="标注项ID">{currentItem.id}</Descriptions.Item>
              <Descriptions.Item label="所属任务">{currentItem.taskId}</Descriptions.Item>
              <Descriptions.Item label="标注员">{currentItem.annotator || '-'}</Descriptions.Item>
              <Descriptions.Item label="审核员">{currentItem.reviewer || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={getDataStatusMeta(currentItem.status).color}>
                  {getDataStatusMeta(currentItem.status).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="归档时间">
                {formatDate(currentItem.archivedAt)}
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="原始数据">
              <pre className="json-block">{stringify(currentItem.rawData)}</pre>
            </Card>
            <Card size="small" title="标注结果">
              <pre className="json-block">{stringify(currentItem.annotationData)}</pre>
            </Card>
          </Space>
        )}
      </Modal>
    </section>
  );
}

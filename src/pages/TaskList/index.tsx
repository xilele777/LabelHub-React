import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType, TablePaginationConfig } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { Role, TaskStatus, type TaskItem } from '../../types';
import { getTaskStatusMeta, getTaskTypeMeta } from '../../utils/statusMeta';
import { useAuthStore } from '../../store/useAuthStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useListCacheStore } from '../../store/useListCacheStore';
import { getTaskList } from '../../api/task';
import { getReviewTimeliness, getTaskTimeliness } from '../../utils/taskTimeliness';
import { useDebounced } from '../../hooks/useDebounced';
import './TaskList.css';

const PAGE_SIZE = 5;

const STATUS_OPTIONS = Object.values(TaskStatus).map((value) => ({
  value,
  label: getTaskStatusMeta(value).label,
}));

function canEdit(status: TaskStatus) {
  return status === TaskStatus.DRAFT || status === TaskStatus.PENDING;
}

function canPublish(status: TaskStatus) {
  return status === TaskStatus.DRAFT || status === TaskStatus.PENDING;
}

function canEnd(status: TaskStatus) {
  return status === TaskStatus.IN_PROGRESS;
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default function TaskList() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.role);

  // keep-alive 的替代：初值取自会话级缓存，回到列表页时恢复上次筛选与页码
  const cached = useListCacheStore.getState().taskList;
  const [keyword, setKeyword] = useState(cached.keyword);
  const [statusFilter, setStatusFilter] = useState<TaskStatus | null>(cached.status);
  const [page, setPage] = useState(cached.page);
  const debouncedKeyword = useDebounced(keyword);

  // 服务端分页：列表数据与总数来自后端，筛选/翻页都发起请求
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 筛选条件变化时回到第一页。渲染期同步（而非 effect），避免先用旧页码发一次请求
  const filtersKey = `${debouncedKeyword.trim()}|${statusFilter ?? ''}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  useEffect(() => {
    useListCacheStore.getState().setTaskListCache({ keyword, status: statusFilter, page });
  }, [keyword, statusFilter, page]);

  // 请求序号：翻页/筛选快速切换时丢弃过期响应（Vue 版无此问题，React 下 effect 触发更密）
  const requestSeq = useRef(0);
  const fetchPage = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await getTaskList({
        _page: page,
        _limit: PAGE_SIZE,
        _sort: 'createdAt',
        _order: 'desc',
        keyword: debouncedKeyword.trim() || undefined,
        status: statusFilter || undefined,
      });
      if (seq !== requestSeq.current) return;
      setTasks(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : '加载任务列表失败');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [page, debouncedKeyword, statusFilter]);

  useEffect(() => {
    void fetchPage();
  }, [fetchPage]);

  const canCreateTask = role === Role.ADMIN || role === Role.OWNER;

  const handlePublish = useCallback(
    async (id: string) => {
      try {
        await useTaskStore.getState().publishTask(id);
        message.success('任务已发布');
        void fetchPage();
      } catch (err) {
        message.error(err instanceof Error ? err.message : '发布任务失败');
      }
    },
    [fetchPage, message],
  );

  const handleEnd = useCallback(
    async (id: string) => {
      try {
        await useTaskStore.getState().endTask(id);
        message.success('任务已结束');
        void fetchPage();
      } catch (err) {
        message.error(err instanceof Error ? err.message : '结束任务失败');
      }
    },
    [fetchPage, message],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      try {
        await useTaskStore.getState().archiveTask(id);
        message.success('任务已归档');
        void fetchPage();
      } catch (err) {
        message.error(err instanceof Error ? err.message : '归档任务失败');
      }
    },
    [fetchPage, message],
  );

  const columns = useMemo<TableColumnsType<TaskItem>>(
    () => [
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
        title: '状态',
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
        title: '模板',
        dataIndex: 'templateName',
        key: 'templateName',
        ellipsis: true,
        width: 132,
        responsive: ['lg'],
      },
      {
        title: '时效',
        key: 'timeliness',
        width: 148,
        responsive: ['xl'],
        render: (_: unknown, record: TaskItem) => {
          const annotation = getTaskTimeliness(record);
          const review = getReviewTimeliness(record);
          return (
            <Tooltip
              title={
                <>
                  <div>标注：{annotation.description}</div>
                  <div>审核：{review.description}</div>
                </>
              }
            >
              <Space direction="vertical" size={4}>
                <Tag className="timeliness-tag" color={annotation.color}>
                  标注 {annotation.label}
                </Tag>
                <Tag className="timeliness-tag" color={review.color}>
                  审核 {review.label}
                </Tag>
              </Space>
            </Tooltip>
          );
        },
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 148,
        responsive: ['xxl'],
        render: (value: string) => formatDate(value),
      },
      {
        title: '操作',
        key: 'action',
        width: 184,
        render: (_: unknown, record: TaskItem) => (
          <Space size="small" wrap>
            <Button
              type="link"
              size="small"
              onClick={() => void navigate(`/tasks/detail?id=${record.id}`)}
            >
              详情
            </Button>
            {canEdit(record.status) && (
              <Button
                type="link"
                size="small"
                onClick={() => void navigate(`/tasks/edit?id=${record.id}`)}
              >
                编辑
              </Button>
            )}
            {canPublish(record.status) && (
              <Popconfirm title="确认发布该任务？" onConfirm={() => void handlePublish(record.id)}>
                <Button type="link" size="small">
                  发布
                </Button>
              </Popconfirm>
            )}
            {canEnd(record.status) && (
              <Popconfirm
                title="确认结束该任务？结束后无法恢复。"
                onConfirm={() => void handleEnd(record.id)}
              >
                <Button type="link" size="small" danger>
                  结束
                </Button>
              </Popconfirm>
            )}
            {(record.status === TaskStatus.COMPLETED || record.status === TaskStatus.ENDED) && (
              <Popconfirm
                title="确认归档该任务？归档后可到任务归档中查看。"
                onConfirm={() => void handleArchive(record.id)}
              >
                <Button type="link" size="small">
                  归档
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [navigate, handlePublish, handleEnd, handleArchive],
  );

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: PAGE_SIZE,
    total,
    showSizeChanger: false,
    showTotal: (count) => `共 ${count} 条`,
  };

  return (
    <section className="task-list-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            任务列表
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            管理任务生命周期、时效和归档动作。
          </Typography.Text>
        </div>
        <div className="app-toolbar">
          <Input.Search
            value={keyword}
            allowClear
            placeholder="搜索任务名称"
            className="search-input"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select<TaskStatus | null>
            value={statusFilter}
            allowClear
            placeholder="按状态筛选"
            className="status-select"
            options={STATUS_OPTIONS}
            onChange={(value) => setStatusFilter(value ?? null)}
          />
          {canCreateTask && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => void navigate('/tasks/create')}
            >
              创建任务
            </Button>
          )}
        </div>
      </header>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          className="page-alert"
          onClose={() => setError(null)}
        />
      )}

      <Card
        className="app-table-card"
        styles={{ body: { padding: 0 } }}
        title={
          <Space>
            <span>任务数据</span>
            <Tag color="blue">共 {total} 条</Tag>
          </Space>
        }
      >
        <Table<TaskItem>
          rowKey="id"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          pagination={pagination}
          scroll={{ x: 680 }}
          onChange={(nextPagination) => setPage(Number(nextPagination.current || 1))}
        />
      </Card>
    </section>
  );
}

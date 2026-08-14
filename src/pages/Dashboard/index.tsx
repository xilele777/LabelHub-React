// 首页仪表盘，汇总任务、进度和近期活动。
import { useCallback, useEffect, useMemo } from 'react';
import { Button, Card, Col, List, Row, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { TaskStatus, TaskType, type TaskItem } from '../../types';
import { getRoleMeta, getTaskStatusMeta, getTaskTypeMeta } from '../../utils/statusMeta';
import { useAuthStore } from '../../store/useAuthStore';
import { useTaskStore } from '../../store/useTaskStore';
import { useTemplateStore } from '../../store/useTemplateStore';
import './Dashboard.css';

const TASK_COLUMNS: TableColumnsType<TaskItem> = [
  { title: '任务名称', dataIndex: 'name', key: 'name', ellipsis: true },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 110,
    render: (status: TaskStatus) => {
      const meta = getTaskStatusMeta(status);
      return <Tag color={meta.color}>{meta.label}</Tag>;
    },
  },
  { title: '负责人', dataIndex: 'owner', key: 'owner', width: 110, responsive: ['md'] },
  {
    title: '创建时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    width: 150,
    responsive: ['lg'],
    render: (value: string) => formatDate(value),
  },
];

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const tasks = useTaskStore((state) => state.tasks);
  const taskLoading = useTaskStore((state) => state.loading);
  const templates = useTemplateStore((state) => state.templates);
  const templateLoading = useTemplateStore((state) => state.loading);

  const loading = taskLoading || templateLoading;
  const runningTaskCount = useMemo(
    () => tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS).length,
    [tasks],
  );
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 6),
    [tasks],
  );
  const roleMeta = getRoleMeta(user?.role);

  const templateTypeStats = useMemo(() => {
    const counts = new Map<TaskType, number>();
    templates.forEach((template) => {
      counts.set(template.type, (counts.get(template.type) ?? 0) + 1);
    });
    return Array.from(counts, ([type, count]) => ({ type, count }));
  }, [templates]);

  const refresh = useCallback(async () => {
    await Promise.all([
      useTaskStore.getState().fetchTasks(),
      useTemplateStore.getState().fetchTemplates(),
    ]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="dashboard-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            仪表盘
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            欢迎回来，<Typography.Text strong>{user?.username ?? '-'}</Typography.Text>
            <Tag color={roleMeta.color} className="role-tag">
              {roleMeta.label}
            </Tag>
          </Typography.Text>
        </div>
        <div className="app-page-tools">
          <Tag color="blue">任务 {tasks.length}</Tag>
          <Tag color="cyan">模板 {templates.length}</Tag>
          <Tag color="green">进行中 {runningTaskCount}</Tag>
          <Button loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        </div>
      </header>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-card--blue" hoverable>
            <Statistic title="任务总数" value={tasks.length} />
            <Typography.Text type="secondary" className="metric-card__hint">
              平台任务总量
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-card--green" hoverable>
            <Statistic title="进行中任务" value={runningTaskCount} />
            <Typography.Text type="secondary" className="metric-card__hint">
              当前需要跟进
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-card--purple" hoverable>
            <Statistic title="模板总数" value={templates.length} />
            <Typography.Text type="secondary" className="metric-card__hint">
              可复用标注配置
            </Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="metric-card metric-card--orange" hoverable>
            <Statistic title="当前角色" value={roleMeta.label} />
            <Typography.Text type="secondary" className="metric-card__hint">
              已按角色过滤菜单
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="dashboard-page__content">
        <Col xs={24} lg={14}>
          <Card title="最近任务" className="panel-card">
            <Table<TaskItem>
              rowKey="id"
              columns={TASK_COLUMNS}
              dataSource={recentTasks}
              pagination={false}
              loading={taskLoading}
              size="small"
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="模板类型分布" className="panel-card">
            <List
              dataSource={templateTypeStats}
              locale={{ emptyText: '暂无模板' }}
              renderItem={(item) => {
                const meta = getTaskTypeMeta(item.type);
                return (
                  <List.Item>
                    <div className="template-stat">
                      <Tag color={meta.color}>{meta.label}</Tag>
                      <Typography.Text strong>{item.count}</Typography.Text>
                    </div>
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
      </Row>
    </section>
  );
}

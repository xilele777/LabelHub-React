import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { NotificationOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import {
  getPublishedNotification,
  getPublishedNotifications,
  revokePublishedNotification,
  type PublishedNotificationItem,
  type PublishedNotificationRecipient,
} from '../../api/notification';
import { Role } from '../../types';
import { useDebounced } from '../../hooks/useDebounced';
import './NotificationManage.css';

const ROLE_LABEL_MAP: Record<string, string> = {
  [Role.OWNER]: '负责人',
  [Role.ANNOTATOR]: '标注员',
  [Role.REVIEWER]: '审核员',
};

const PRIORITY_META_MAP: Record<
  PublishedNotificationItem['priority'],
  { label: string; color: string }
> = {
  high: { label: '重要', color: 'red' },
  medium: { label: '普通', color: 'blue' },
  low: { label: '低优先级', color: 'default' },
};

function getTargetLabels(record: PublishedNotificationItem) {
  return [
    ...record.targetRoles.map((role) => ROLE_LABEL_MAP[role] || role),
    ...record.targetUsernames,
  ];
}

function getReadPercent(record: PublishedNotificationItem) {
  return record.totalRecipients > 0
    ? Math.round((record.readCount / record.totalRecipients) * 100)
    : 0;
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

const RECIPIENT_COLUMNS: TableColumnsType<PublishedNotificationRecipient> = [
  { title: '接收人', dataIndex: 'username', key: 'username', ellipsis: true },
  {
    title: '状态',
    key: 'status',
    width: 88,
    render: (_: unknown, record: PublishedNotificationRecipient) => {
      if (record.deleted) return <Tag color="default">已撤回</Tag>;
      if (record.read) return <Tag color="green">已读</Tag>;
      return <Tag color="orange">未读</Tag>;
    },
  },
  {
    title: '阅读时间',
    dataIndex: 'readAt',
    key: 'readAt',
    width: 148,
    responsive: ['lg'],
    render: (value: string | null) => (value ? formatDate(value) : '-'),
  },
];

export default function NotificationManage() {
  const { message } = App.useApp();
  const navigate = useNavigate();

  const [items, setItems] = useState<PublishedNotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounced(keyword);
  const [selected, setSelected] = useState<PublishedNotificationItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPublishedNotifications({ limit: 500 });
      setItems(res.data.items || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取发布记录失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const filteredItems = useMemo(() => {
    const value = debouncedKeyword.trim().toLowerCase();
    if (!value) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(value) ||
        item.message.toLowerCase().includes(value) ||
        item.recipients.some((recipient) => recipient.username.toLowerCase().includes(value)),
    );
  }, [items, debouncedKeyword]);

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await getPublishedNotification(id);
      setSelected(res.data);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取通知详情失败');
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await revokePublishedNotification(id);
      message.success('通知已撤回');
      await fetchList();
      if (selected?.id === id) {
        const res = await getPublishedNotification(id);
        setSelected(res.data);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '撤回通知失败');
    } finally {
      setRevokingId(null);
    }
  }

  function copyPublish(record: PublishedNotificationItem) {
    const query = new URLSearchParams({ title: record.title, message: record.message });
    void navigate(`/notifications/publish?${query.toString()}`);
  }

  const columns: TableColumnsType<PublishedNotificationItem> = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '状态',
      key: 'status',
      width: 88,
      render: (_: unknown, record: PublishedNotificationItem) => (
        <Tag color={record.revokedAt ? 'default' : 'green'}>
          {record.revokedAt ? '已撤回' : '已发布'}
        </Tag>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 92,
      responsive: ['xl'],
      render: (_: unknown, record: PublishedNotificationItem) => {
        const meta = PRIORITY_META_MAP[record.priority];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '目标范围',
      key: 'targets',
      width: 168,
      responsive: ['xxl'],
      render: (_: unknown, record: PublishedNotificationItem) => {
        const labels = getTargetLabels(record);
        return (
          <Space size={4} wrap>
            {labels.slice(0, 4).map((target) => (
              <Tag key={target}>{target}</Tag>
            ))}
            {labels.length > 4 && <Tag>+{labels.length - 4}</Tag>}
            {labels.length === 0 && <Typography.Text type="secondary">未记录</Typography.Text>}
          </Space>
        );
      },
    },
    {
      title: '阅读',
      key: 'readRate',
      width: 136,
      render: (_: unknown, record: PublishedNotificationItem) => (
        <>
          <Progress percent={getReadPercent(record)} size="small" />
          <Typography.Text type="secondary" className="read-rate">
            {record.readCount}/{record.totalRecipients} 已读
          </Typography.Text>
        </>
      ),
    },
    {
      title: '发布时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 148,
      responsive: ['xl'],
      render: (value: string) => formatDate(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 224,
      render: (_: unknown, record: PublishedNotificationItem) => (
        <Space size="small" wrap>
          <Button type="link" size="small" onClick={() => void openDetail(record.id)}>
            详情
          </Button>
          <Button type="link" size="small" onClick={() => copyPublish(record)}>
            复制再发
          </Button>
          {!record.revokedAt && (
            <Popconfirm title="确认撤回该通知？" onConfirm={() => void handleRevoke(record.id)}>
              <Button type="link" size="small" danger loading={revokingId === record.id}>
                撤回
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <section className="notification-manage-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            <NotificationOutlined className="page-icon" />
            通知管理
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            查看、撤回和复用已发布的站内通知。
          </Typography.Text>
        </div>
        <div className="app-toolbar">
          <Input.Search
            value={keyword}
            allowClear
            placeholder="搜索标题、内容或接收人"
            className="search-input"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchList()}>
            刷新
          </Button>
        </div>
      </header>

      <Card size="small" className="app-table-card" styles={{ body: { padding: 0 } }}>
        <Table<PublishedNotificationItem>
          rowKey="id"
          columns={columns}
          dataSource={filteredItems}
          loading={loading}
          scroll={{ x: 720 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: false,
            showTotal: (total: number) => `共 ${total} 条`,
          }}
        />
      </Card>

      <Modal
        open={detailOpen}
        title="通知详情"
        width={860}
        footer={null}
        onCancel={() => setDetailOpen(false)}
      >
        <Spin spinning={detailLoading}>
          {selected && (
            <Space direction="vertical" size="middle" className="detail-body lh-modal-detail">
              <Descriptions bordered size="small" column={{ xs: 1, sm: 1, md: 2 }}>
                <Descriptions.Item label="标题" span={2}>
                  {selected.title}
                </Descriptions.Item>
                <Descriptions.Item label="内容" span={2}>
                  <div className="message-content">{selected.message}</div>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={selected.revokedAt ? 'default' : 'green'}>
                    {selected.revokedAt ? '已撤回' : '已发布'}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="优先级">
                  <Tag color={PRIORITY_META_MAP[selected.priority].color}>
                    {PRIORITY_META_MAP[selected.priority].label}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="发布时间">
                  {formatDate(selected.timestamp)}
                </Descriptions.Item>
                <Descriptions.Item label="接收人数">{selected.totalRecipients}</Descriptions.Item>
                <Descriptions.Item label="已读">{selected.readCount}</Descriptions.Item>
                <Descriptions.Item label="未读">{selected.unreadCount}</Descriptions.Item>
              </Descriptions>

              <Table<PublishedNotificationRecipient>
                rowKey="id"
                size="small"
                className="lh-modal-table"
                columns={RECIPIENT_COLUMNS}
                dataSource={selected.recipients}
                pagination={{ pageSize: 8, showSizeChanger: false }}
              />
            </Space>
          )}
        </Spin>
      </Modal>
    </section>
  );
}

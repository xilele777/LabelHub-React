import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType, TablePaginationConfig } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { type AnnotationTemplate, type TemplateItem } from '../../types';
import { getTaskTypeMeta } from '../../utils/statusMeta';
import { useTemplateStore } from '../../store/useTemplateStore';
import { useListCacheStore } from '../../store/useListCacheStore';
import { getTemplateSchemaAsync } from '../../utils/templateSchemaHelper';
import { useDebounced } from '../../hooks/useDebounced';
import './TemplateManage.css';

const PAGE_SIZE = 5;

function formatDate(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default function TemplateManage() {
  const { message } = App.useApp();
  const navigate = useNavigate();

  const templates = useTemplateStore((state) => state.templates);
  const loading = useTemplateStore((state) => state.loading);
  const error = useTemplateStore((state) => state.error);

  // keep-alive 的替代：初值取自会话级缓存，回到列表页时恢复上次筛选与页码
  const cached = useListCacheStore.getState().templateManage;
  const [keyword, setKeyword] = useState(cached.keyword);
  const [page, setPage] = useState(cached.page);
  const debouncedKeyword = useDebounced(keyword);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<AnnotationTemplate | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);

  // 防抖关键词生效时回到第一页，避免筛选结果变化后页码越界（渲染期同步，等价 Vue watch）
  const [prevKeyword, setPrevKeyword] = useState(debouncedKeyword);
  if (prevKeyword !== debouncedKeyword) {
    setPrevKeyword(debouncedKeyword);
    setPage(1);
  }

  useEffect(() => {
    useListCacheStore.getState().setTemplateManageCache({ keyword, page });
  }, [keyword, page]);

  useEffect(() => {
    void useTemplateStore.getState().fetchTemplates();
  }, []);

  const filteredTemplates = useMemo(() => {
    const normalizedKeyword = debouncedKeyword.trim().toLowerCase();
    return templates.filter(
      (template) => !normalizedKeyword || template.name.toLowerCase().includes(normalizedKeyword),
    );
  }, [templates, debouncedKeyword]);

  async function handleDelete(id: string) {
    try {
      await useTemplateStore.getState().deleteTemplate(id);
      message.success('模板已删除');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除模板失败');
    }
  }

  async function openPreview(record: TemplateItem) {
    setPreviewLoadingId(record.id);
    try {
      const schema = await getTemplateSchemaAsync(record.id);
      setPreviewData(
        schema ?? {
          id: record.id,
          name: record.name,
          type: record.type,
          fields: [],
          version: 1,
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
        },
      );
      setPreviewOpen(true);
    } catch {
      message.warning('获取模板 Schema 失败');
    } finally {
      setPreviewLoadingId(null);
    }
  }

  const columns: TableColumnsType<TemplateItem> = [
    { title: '模板名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '模板描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 112,
      render: (_: unknown, record: TemplateItem) => {
        const meta = getTaskTypeMeta(record.type);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: '字段', dataIndex: 'fieldCount', key: 'fieldCount', width: 72, align: 'center' },
    { title: '创建人', dataIndex: 'creator', key: 'creator', width: 90, responsive: ['xl'] },
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
      width: 200,
      render: (_: unknown, record: TemplateItem) => (
        <Space size="small" wrap>
          <Button
            type="link"
            size="small"
            loading={previewLoadingId === record.id}
            onClick={() => void openPreview(record)}
          >
            预览
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => void navigate(`/templates/builder?id=${record.id}`)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该模板？删除后无法恢复。"
            onConfirm={() => void handleDelete(record.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize: PAGE_SIZE,
    total: filteredTemplates.length,
    showSizeChanger: false,
    showTotal: (total) => `共 ${total} 条`,
  };

  return (
    <section className="template-manage-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            模板列表
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            维护可复用的标注字段和任务 Schema。
          </Typography.Text>
        </div>
        <div className="app-toolbar">
          <Input.Search
            value={keyword}
            allowClear
            placeholder="搜索模板名称"
            className="search-input"
            onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }}
            onSearch={() => setPage(1)}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => void navigate('/templates/builder?mode=create')}
          >
            新建模板
          </Button>
        </div>
      </header>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          className="page-alert"
          onClose={() => useTemplateStore.setState({ error: null })}
        />
      )}

      <Card
        className="app-table-card"
        styles={{ body: { padding: 0 } }}
        title={
          <Space>
            <span>模板数据</span>
            <Tag color="blue">共 {filteredTemplates.length} 条</Tag>
          </Space>
        }
      >
        <Table<TemplateItem>
          rowKey="id"
          columns={columns}
          dataSource={filteredTemplates}
          loading={loading}
          pagination={pagination}
          onChange={(nextPagination) => setPage(Number(nextPagination.current || 1))}
        />
      </Card>

      <Modal
        open={previewOpen}
        title="模板 Schema 预览"
        width={680}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
      >
        <div className="lh-modal-detail">
          {previewData && (
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="模板ID">{previewData.id}</Descriptions.Item>
              <Descriptions.Item label="模板名称">{previewData.name}</Descriptions.Item>
              <Descriptions.Item label="任务类型">
                <Tag color={getTaskTypeMeta(previewData.type).color}>
                  {getTaskTypeMeta(previewData.type).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="版本">v{previewData.version}</Descriptions.Item>
              <Descriptions.Item label="字段数量">{previewData.fields.length}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {formatDate(previewData.createdAt)}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {formatDate(previewData.updatedAt)}
              </Descriptions.Item>
              <Descriptions.Item label="字段列表">
                <Space wrap>
                  {previewData.fields.map((field) => (
                    <Tag key={field.id}>
                      {field.label}（{field.type}）
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="完整 Schema">
                <pre className="schema-preview">{JSON.stringify(previewData, null, 2)}</pre>
              </Descriptions.Item>
            </Descriptions>
          )}
        </div>
      </Modal>
    </section>
  );
}

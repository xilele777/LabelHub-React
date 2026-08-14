// 数据导出页面，筛选数据并生成下载文件。
import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { DataItemStatus, type DataItem } from '../../types';
import { getDataStatusMeta } from '../../utils/statusMeta';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useTaskStore } from '../../store/useTaskStore';
import {
  ExportFormat,
  ExportRange,
  buildExportRecords,
  filterByRange,
  type ExportRecord,
} from '../../utils/exportUtils';
import { performExportInWorker } from '../../utils/exportWorkerClient';
import './DataExport.css';

const RANGE_OPTIONS = [
  { label: '全部数据', value: ExportRange.ALL },
  { label: '仅审核通过', value: ExportRange.APPROVED },
  { label: '仅驳回数据', value: ExportRange.REJECTED },
];

const FORMAT_OPTIONS = [
  { label: 'JSON', value: ExportFormat.JSON },
  { label: 'CSV', value: ExportFormat.CSV },
];

function stringify(value: unknown) {
  if (value === null || value === undefined) return '无';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const COLUMNS: TableColumnsType<ExportRecord> = [
  { title: '数据ID', dataIndex: 'id', key: 'id', width: 112, ellipsis: true },
  {
    title: '任务ID',
    dataIndex: 'taskId',
    key: 'taskId',
    width: 112,
    ellipsis: true,
    responsive: ['xl'],
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 96,
    render: (_: unknown, record: ExportRecord) => {
      const meta = getDataStatusMeta(record.status);
      return <Tag color={meta.color}>{meta.label}</Tag>;
    },
  },
  {
    title: '原始数据',
    dataIndex: 'rawData',
    key: 'rawData',
    ellipsis: true,
    render: (_: unknown, record: ExportRecord) => {
      const text = stringify(record.rawData);
      return (
        <Tooltip title={text}>
          <span className="preview-text">{text}</span>
        </Tooltip>
      );
    },
  },
  {
    title: '标注结果',
    dataIndex: 'annotationResult',
    key: 'annotationResult',
    ellipsis: true,
    render: (_: unknown, record: ExportRecord) => {
      const text = stringify(record.annotationResult);
      return (
        <Tooltip title={text}>
          <span className="preview-text">{text}</span>
        </Tooltip>
      );
    },
  },
  {
    title: 'AI',
    key: 'aiReview',
    width: 84,
    responsive: ['lg'],
    render: (_: unknown, record: ExportRecord) =>
      record.aiReviewResult ? <Tag>{record.aiReviewResult.reviewStatus}</Tag> : <Tag>无</Tag>,
  },
  {
    title: '审核',
    key: 'humanReview',
    width: 84,
    render: (_: unknown, record: ExportRecord) =>
      record.humanReviewResult?.result ? (
        <Tag color={record.humanReviewResult.result === 'approved' ? 'success' : 'error'}>
          {record.humanReviewResult.result === 'approved' ? '通过' : '驳回'}
        </Tag>
      ) : (
        <Tag>无</Tag>
      ),
  },
];

export default function DataExport() {
  const { message } = App.useApp();

  const tasks = useTaskStore((state) => state.tasks);
  const dataItems = useAnnotationStore((state) => state.dataItems);
  const archivedItems = useAnnotationStore((state) => state.archivedItems);
  const aiReviewResults = useAnnotationStore((state) => state.aiReviewResults);

  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [exportRange, setExportRange] = useState<ExportRange>(ExportRange.ALL);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.JSON);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void useTaskStore.getState().fetchTasks();
    const annotationStore = useAnnotationStore.getState();
    void annotationStore.fetchDataItems();
    void annotationStore.fetchArchivedItems();
    void annotationStore.fetchAIReviews();
  }, []);

  const taskOptions = useMemo(
    () => tasks.map((task) => ({ label: `${task.name} (${task.id})`, value: task.id })),
    [tasks],
  );

  const allExportRecords = useMemo(() => {
    const itemMap = new Map<string, DataItem>();
    dataItems.forEach((item) => itemMap.set(item.id, item));
    archivedItems.forEach((item) => itemMap.set(item.id, item));

    const items = Array.from(itemMap.values()).filter(
      (item) => !selectedTaskId || item.taskId === selectedTaskId,
    );
    return buildExportRecords(items, aiReviewResults);
  }, [dataItems, archivedItems, aiReviewResults, selectedTaskId]);

  const exportRecords = useMemo(
    () => filterByRange(allExportRecords, exportRange),
    [allExportRecords, exportRange],
  );

  const stats = useMemo(
    () => ({
      total: allExportRecords.length,
      approved: allExportRecords.filter((record) => record.status === DataItemStatus.REVIEWED)
        .length,
      rejected: allExportRecords.filter((record) => record.status === DataItemStatus.REJECTED)
        .length,
    }),
    [allExportRecords],
  );

  async function handleExport() {
    if (exportRecords.length === 0) {
      message.warning('没有可导出的数据');
      return;
    }

    const task = tasks.find((item) => item.id === selectedTaskId);
    const baseFilename = task ? `LabelHub_${task.name}` : 'LabelHub_全部任务';
    setExporting(true);
    try {
      // 序列化在 Web Worker 中执行，大数据量导出不阻塞主线程
      await performExportInWorker(exportRecords, exportFormat, baseFilename);
      message.success(`已导出 ${exportRecords.length} 条数据`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="data-export-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            数据导出
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            选择任务、范围和格式后导出标注数据。
          </Typography.Text>
        </div>
        <div className="app-page-tools">
          <Tag color="blue">总数据 {stats.total}</Tag>
          <Tag color="green">通过 {stats.approved}</Tag>
          <Tag color="red">驳回 {stats.rejected}</Tag>
        </div>
      </header>

      <Card title="导出配置" className="panel-card export-config-card">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} md={8}>
            <div className="field-label">选择任务</div>
            <Select
              value={selectedTaskId}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="留空导出全部任务"
              className="full-control"
              options={taskOptions}
              onChange={(value) => setSelectedTaskId(value)}
            />
          </Col>
          <Col xs={24} md={8}>
            <div className="field-label">导出范围</div>
            <Radio.Group
              value={exportRange}
              optionType="button"
              buttonStyle="solid"
              options={RANGE_OPTIONS}
              className="segmented-group"
              onChange={(event) => setExportRange(event.target.value as ExportRange)}
            />
          </Col>
          <Col xs={24} md={8}>
            <div className="field-label">导出格式</div>
            <Radio.Group
              value={exportFormat}
              optionType="button"
              buttonStyle="solid"
              options={FORMAT_OPTIONS}
              className="segmented-group"
              onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
            />
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <Card className="metric-card metric-card--blue">
            <Statistic title="总数据" value={stats.total} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="metric-card metric-card--green">
            <Statistic title="审核通过" value={stats.approved} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="metric-card metric-card--red">
            <Statistic title="已驳回" value={stats.rejected} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card className="export-card">
            <Button
              type="primary"
              block
              icon={<DownloadOutlined />}
              loading={exporting}
              disabled={exportRecords.length === 0}
              onClick={() => void handleExport()}
            >
              导出 {exportFormat.toUpperCase()}
            </Button>
          </Card>
        </Col>
      </Row>

      <Card
        className="app-table-card"
        styles={{ body: { padding: 0 } }}
        title={
          <Space>
            <span>数据预览</span>
            <Tag color="blue">{exportRecords.length} 条</Tag>
          </Space>
        }
      >
        {exportRecords.length === 0 ? (
          <Empty description="暂无符合条件的数据" />
        ) : (
          <Table<ExportRecord>
            rowKey="id"
            size="small"
            columns={COLUMNS}
            dataSource={exportRecords}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        )}
      </Card>
    </section>
  );
}

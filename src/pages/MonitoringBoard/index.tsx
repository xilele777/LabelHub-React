// 监控看板，展示任务运行状态和实时指标。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Radio,
  Segmented,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { get } from '../../api/request';
import { useECharts } from '../../hooks/useECharts';
import './MonitoringBoard.css';

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface MetricSummary {
  count: number;
  p75: number | null;
  ratings: Record<'good' | 'needs-improvement' | 'poor', number>;
}

interface WebVitalsSummary {
  days: number;
  total: number;
  metrics: Record<string, MetricSummary>;
  trend: Array<Record<string, number | string | null>>;
  updatedAt: string;
}

// 指标固定顺序（分类色按实体固定分配，不随数据变化重排）
const METRIC_ORDER = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
type MetricName = (typeof METRIC_ORDER)[number];

const METRIC_INFO: Record<MetricName, { description: string; thresholds: [number, number] }> = {
  LCP: { description: '最大内容绘制（加载性能）', thresholds: [2500, 4000] },
  INP: { description: '交互到下一次绘制（响应性能）', thresholds: [200, 500] },
  CLS: { description: '累积布局偏移（视觉稳定性，存储值 ×1000）', thresholds: [100, 250] },
  FCP: { description: '首次内容绘制', thresholds: [1800, 3000] },
  TTFB: { description: '首字节时间', thresholds: [800, 1800] },
};

// 已通过 dataviz 六项校验（浅色底）：主色 + 三档状态色
const PRIMARY_COLOR = '#1a73e8';
const STATUS_COLORS = {
  good: '#188038',
  'needs-improvement': '#e37400',
  poor: '#a50e0e',
} as const;
const STATUS_LABELS = {
  good: '良好',
  'needs-improvement': '待改进',
  poor: '较差',
} as const;

const INK_SECONDARY = '#5f6368';
const GRID_LINE = '#f0f0f0';
const AXIS_LINE = '#e0e3eb';

const METRIC_OPTIONS = METRIC_ORDER.map((name) => ({ label: name, value: name }));

function formatMetricValue(name: string, value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (name === 'CLS') return (value / 1000).toFixed(3);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function ratingOf(name: MetricName, p75: number | null): keyof typeof STATUS_COLORS | null {
  if (p75 === null) return null;
  const [good, poor] = METRIC_INFO[name].thresholds;
  if (p75 <= good) return 'good';
  if (p75 <= poor) return 'needs-improvement';
  return 'poor';
}

function getPresentMetrics(summary: WebVitalsSummary | null) {
  return METRIC_ORDER.filter((name) => (summary?.metrics[name]?.count ?? 0) > 0);
}

function buildTrendOption(
  summary: WebVitalsSummary,
  metric: MetricName,
): echarts.EChartsCoreOption {
  const trend = summary.trend ?? [];
  const dates = trend.map((point) => String(point.date));
  const values = trend.map((point) => {
    const raw = point[metric];
    if (typeof raw !== 'number') return null;
    return metric === 'CLS' ? Number((raw / 1000).toFixed(3)) : Math.round(raw);
  });

  return {
    grid: { left: 12, right: 20, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: AXIS_LINE } },
      valueFormatter: (value: unknown) =>
        typeof value === 'number' ? (metric === 'CLS' ? value.toFixed(3) : `${value} ms`) : '—',
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: { color: INK_SECONDARY },
    },
    yAxis: {
      type: 'value',
      name: metric === 'CLS' ? 'CLS' : 'ms',
      nameTextStyle: { color: INK_SECONDARY },
      splitLine: { lineStyle: { color: GRID_LINE } },
      axisLabel: { color: INK_SECONDARY },
    },
    series: [
      {
        name: `${metric} p75`,
        type: 'line',
        data: values,
        connectNulls: true,
        lineStyle: { width: 2, color: PRIMARY_COLOR },
        itemStyle: { color: PRIMARY_COLOR },
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: dates.length <= 14,
      },
    ],
  };
}

function buildRatingOption(summary: WebVitalsSummary): echarts.EChartsCoreOption {
  const names = getPresentMetrics(summary);
  const ratingKeys = ['good', 'needs-improvement', 'poor'] as const;
  const series = ratingKeys.map((key) => ({
    name: STATUS_LABELS[key],
    type: 'bar' as const,
    stack: 'rating',
    barWidth: 18,
    // 2px 表面色间隔：堆叠段之间的白色描边
    itemStyle: { color: STATUS_COLORS[key], borderColor: '#ffffff', borderWidth: 1 },
    label: {
      show: true,
      color: '#ffffff',
      fontSize: 12,
      formatter: (params: { value?: unknown }) =>
        typeof params.value === 'number' && params.value >= 10 ? `${params.value}%` : '',
    },
    data: names.map((name) => {
      const ratings = summary.metrics[name]!.ratings;
      const sum = Math.max(1, ratings.good + ratings['needs-improvement'] + ratings.poor);
      return Math.round((ratings[key] / sum) * 100);
    }),
  }));

  return {
    grid: { left: 12, right: 24, top: 36, bottom: 8, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: INK_SECONDARY },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: unknown) => (typeof value === 'number' ? `${value}%` : '—'),
    },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { color: INK_SECONDARY, formatter: '{value}%' },
      splitLine: { lineStyle: { color: GRID_LINE } },
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: { color: INK_SECONDARY },
    },
    series,
  };
}

interface SummaryTableRow {
  name: string;
  p75: string;
  count: number;
  good: string;
  ni: string;
  poor: string;
}

const TABLE_COLUMNS: TableColumnsType<SummaryTableRow> = [
  { title: '指标', dataIndex: 'name', key: 'name', width: 88 },
  { title: 'p75', dataIndex: 'p75', key: 'p75', width: 108 },
  { title: '采样数', dataIndex: 'count', key: 'count', width: 88 },
  { title: '良好', dataIndex: 'good', key: 'good' },
  { title: '待改进', dataIndex: 'ni', key: 'ni' },
  { title: '较差', dataIndex: 'poor', key: 'poor' },
];

export default function MonitoringBoard() {
  const { message } = App.useApp();

  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<WebVitalsSummary | null>(null);
  const [trendMetric, setTrendMetric] = useState<MetricName>('LCP');

  const { containerRef: trendChartRef, setOption: setTrendOption } = useECharts();
  const { containerRef: ratingChartRef, setOption: setRatingOption } = useECharts();

  const total = summary?.total ?? 0;
  const presentMetrics = getPresentMetrics(summary);

  const fetchSummary = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    setError(null);
    try {
      const res = await get<WebVitalsSummary>('/web-vitals/summary', { days });
      setSummary(res.data);
      return null;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '加载监控数据失败';
      setError(errorMessage);
      return errorMessage;
    } finally {
      setLoading(false);
    }
  }, [days]);

  // 首次加载和时间范围变化时拉取数据；首次失败时提示用户。
  const firstLoadRef = useRef(true);
  useEffect(() => {
    const isFirst = firstLoadRef.current;
    firstLoadRef.current = false;
    void fetchSummary().then((errorMessage) => {
      if (isFirst && errorMessage) message.warning('监控数据加载失败，可稍后重试');
    });
  }, [fetchSummary, message]);

  // 数据/指标切换后重渲染图表；容器由条件分支挂载，setOption 会在 init 时自动补投
  useEffect(() => {
    if (!summary || summary.total === 0) return;
    setTrendOption(buildTrendOption(summary, trendMetric));
  }, [summary, trendMetric, setTrendOption]);

  useEffect(() => {
    if (!summary || summary.total === 0) return;
    setRatingOption(buildRatingOption(summary));
  }, [summary, setRatingOption]);

  const statTiles = METRIC_ORDER.map((name) => {
    const metric = summary?.metrics[name];
    const rating = ratingOf(name, metric?.p75 ?? null);
    return {
      name,
      description: METRIC_INFO[name].description,
      display: formatMetricValue(name, metric?.p75 ?? null),
      count: metric?.count ?? 0,
      ratingColor: rating ? STATUS_COLORS[rating] : '#dadce0',
      ratingLabel: rating ? STATUS_LABELS[rating] : '无数据',
    };
  });

  const tableRows: SummaryTableRow[] = presentMetrics.map((name) => {
    const metric = summary!.metrics[name]!;
    const sum = Math.max(
      1,
      metric.ratings.good + metric.ratings['needs-improvement'] + metric.ratings.poor,
    );
    const pct = (n: number) => `${Math.round((n / sum) * 100)}%（${n}）`;
    return {
      name,
      p75: formatMetricValue(name, metric.p75),
      count: metric.count,
      good: pct(metric.ratings.good),
      ni: pct(metric.ratings['needs-improvement']),
      poor: pct(metric.ratings.poor),
    };
  });

  return (
    <section className="monitoring-board app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            性能监控
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            生产环境真实用户的 Core Web Vitals（sendBeacon 上报，按 p75 聚合）。
          </Typography.Text>
        </div>
        <div className="app-toolbar">
          <Radio.Group
            value={days}
            buttonStyle="solid"
            size="small"
            onChange={(event) => setDays(event.target.value as number)}
          >
            <Radio.Button value={7}>近 7 天</Radio.Button>
            <Radio.Button value={14}>近 14 天</Radio.Button>
            <Radio.Button value={30}>近 30 天</Radio.Button>
          </Radio.Group>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void fetchSummary()}
          >
            刷新
          </Button>
        </div>
      </header>

      {error && (
        <Alert
          type="error"
          showIcon
          closable
          message={error}
          className="page-alert"
          onClose={() => setError(null)}
        />
      )}

      {!loading && total === 0 ? (
        <Card className="empty-card">
          <Empty description="暂无性能上报数据">
            <Typography.Text type="secondary">
              web-vitals 仅在生产构建（npm run build + preview/部署）中采集上报，开发模式不上报。
            </Typography.Text>
          </Empty>
        </Card>
      ) : (
        <>
          {/* 指标统计卡：数值用文本色，rating 用色点 + 文字（不依赖颜色单独传达） */}
          <div className="stat-row">
            {statTiles.map((tile) => (
              <Card key={tile.name} size="small" className="stat-tile">
                <div className="stat-name">
                  {tile.name}
                  <Tooltip title={tile.description}>
                    <QuestionCircleOutlined className="stat-help" />
                  </Tooltip>
                </div>
                <div className="stat-value">{tile.display}</div>
                <div className="stat-meta">
                  <span className="rating-dot" style={{ background: tile.ratingColor }} />
                  <span>{tile.ratingLabel}</span>
                  <span className="stat-count">{tile.count} 次采样</span>
                </div>
              </Card>
            ))}
          </div>

          <div className="chart-grid">
            <Card
              size="small"
              className="chart-card"
              title={
                <Space>
                  <span>p75 按天趋势</span>
                  <Segmented
                    value={trendMetric}
                    options={METRIC_OPTIONS}
                    size="small"
                    onChange={(value) => setTrendMetric(value as MetricName)}
                  />
                </Space>
              }
            >
              <div ref={trendChartRef} className="chart-box" />
            </Card>

            <Card
              size="small"
              title="Rating 分布（good / needs-improvement / poor）"
              className="chart-card"
            >
              <div ref={ratingChartRef} className="chart-box" />
            </Card>
          </div>

          {/* 表格视图：图表的无障碍兜底 */}
          <Card
            size="small"
            title="汇总明细"
            className="app-table-card"
            styles={{ body: { padding: 0 } }}
          >
            <Table<SummaryTableRow>
              rowKey="name"
              size="small"
              columns={TABLE_COLUMNS}
              dataSource={tableRows}
              pagination={false}
            />
          </Card>
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo } from 'react';
import {
  Alert,
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { computeStatistics } from './utils/computeStatistics';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { useTaskStore } from '../../store/useTaskStore';
import './StatisticsBoard.css';

export default function StatisticsBoard() {
  const tasks = useTaskStore((state) => state.tasks);
  const taskLoading = useTaskStore((state) => state.loading);
  const taskError = useTaskStore((state) => state.error);
  const dataItems = useAnnotationStore((state) => state.dataItems);
  const archivedItems = useAnnotationStore((state) => state.archivedItems);
  const aiReviewResults = useAnnotationStore((state) => state.aiReviewResults);
  const annotationLoading = useAnnotationStore((state) => state.loading);
  const annotationError = useAnnotationStore((state) => state.error);

  const loading = taskLoading || annotationLoading;
  const error = taskError || annotationError;

  useEffect(() => {
    void useTaskStore.getState().fetchTasks();
    const annotationStore = useAnnotationStore.getState();
    void annotationStore.fetchDataItems();
    void annotationStore.fetchArchivedItems();
    void annotationStore.fetchAIReviews();
  }, []);

  const allDataItems = useMemo(() => {
    const itemMap = new Map(dataItems.map((item) => [item.id, item]));
    archivedItems.forEach((item) => itemMap.set(item.id, item));
    return Array.from(itemMap.values());
  }, [dataItems, archivedItems]);

  const stats = useMemo(() => {
    const visibleItemIds = new Set(allDataItems.map((item) => item.id));
    const visibleAIReviews = aiReviewResults.filter((review) =>
      visibleItemIds.has(review.dataItemId),
    );
    return computeStatistics(tasks, allDataItems, visibleAIReviews);
  }, [tasks, allDataItems, aiReviewResults]);

  const passRatePercent = Math.round(stats.reviewPassRate.rate * 100);
  const maxSubmitCount = Math.max(...stats.annotatorRank.map((item) => item.submitCount), 1);

  const statCards = [
    {
      title: '任务总数',
      value: stats.totalTasks,
      description: `${stats.inProgressTasks} 个进行中`,
      tone: 'blue',
    },
    {
      title: '数据总量',
      value: stats.totalDataItems,
      description: `${stats.archivedDataItems} 条已归档`,
      tone: 'purple',
    },
    {
      title: '待人工审核',
      value: stats.reviewPendingCount,
      description: '规则预审后等待处理',
      tone: 'orange',
    },
    {
      title: '审核通过',
      value: stats.passedDataCount,
      description: `${stats.reviewPassRate.passed} / ${stats.reviewPassRate.total || 0} 条`,
      tone: 'green',
    },
    {
      title: '审核驳回',
      value: stats.rejectedDataCount,
      description: '需要返工或重新提交',
      tone: 'red',
    },
    {
      title: '审核通过率',
      value: passRatePercent,
      suffix: '%',
      description: `规则预审命中 ${stats.aiRiskHitCount} 条风险规则`,
      tone: 'blue',
    },
  ];

  function getRankPercent(count: number) {
    return Math.round((count / maxSubmitCount) * 100);
  }

  function getStatusPercent(count: number) {
    return stats.totalDataItems > 0 ? Math.round((count / stats.totalDataItems) * 100) : 0;
  }

  function getAIRiskPercent(count: number) {
    const total = stats.aiRiskDistribution.reduce((sum, item) => sum + item.count, 0);
    return total > 0 ? Math.round((count / total) * 100) : 0;
  }

  return (
    <Spin spinning={loading}>
      <section className="statistics-page app-page">
        <header className="app-page-header">
          <div className="app-page-title">
            <Typography.Title level={4} className="page-title">
              统计看板
            </Typography.Title>
            <Typography.Text className="app-page-desc" type="secondary">
              汇总任务、标注、审核和规则预审风险。
            </Typography.Text>
          </div>
          <div className="app-page-tools">
            <Space wrap>
              <Tag color="blue">
                进行中任务 {stats.inProgressTasks} / {stats.totalTasks}
              </Tag>
              <Tag color="cyan">数据总量 {stats.totalDataItems}</Tag>
              {stats.reviewPassRate.total > 0 ? (
                <Tag
                  color={passRatePercent >= 80 ? 'green' : passRatePercent >= 50 ? 'orange' : 'red'}
                >
                  审核通过率 {passRatePercent}%
                </Tag>
              ) : (
                <Tag color="default">暂无审核数据</Tag>
              )}
            </Space>
          </div>
        </header>

        {error && <Alert type="error" message={error} showIcon closable />}

        <Row gutter={[16, 16]}>
          {statCards.map((card) => (
            <Col key={card.title} xs={24} sm={12} xl={8} xxl={4}>
              <Card size="small" className={`metric-card metric-card--${card.tone}`}>
                <Statistic title={card.title} value={card.value} suffix={card.suffix} />
                <Typography.Text type="secondary" className="card-desc">
                  {card.description}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="标注员提交排行" size="small" className="panel-card">
              {stats.annotatorRank.length === 0 ? (
                <Empty description="暂无提交数据" />
              ) : (
                <List
                  dataSource={stats.annotatorRank.slice(0, 8)}
                  renderItem={(item, index) => (
                    <List.Item>
                      <div className="rank-row">
                        <Tag color="blue">#{index + 1}</Tag>
                        <Typography.Text>{item.displayName}</Typography.Text>
                        <Progress
                          percent={getRankPercent(item.submitCount)}
                          size="small"
                          className="rank-progress"
                        />
                        <Typography.Text strong>{item.submitCount}</Typography.Text>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="审核通过率" size="small" className="panel-card pass-rate-card">
              <Progress type="dashboard" percent={passRatePercent} />
              <div className="pass-rate-detail">
                <Tag color="green">通过 {stats.reviewPassRate.passed}</Tag>
                <Tag color="red">驳回 {stats.reviewPassRate.rejected}</Tag>
                <Tag>总计 {stats.reviewPassRate.total}</Tag>
              </div>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <Card title="数据状态分布" size="small" className="panel-card">
              <List
                dataSource={stats.statusDistribution}
                locale={{ emptyText: '暂无数据' }}
                renderItem={(item) => (
                  <List.Item>
                    <div className="distribution-row">
                      <Tag color={item.color}>{item.label}</Tag>
                      <Progress
                        percent={getStatusPercent(item.count)}
                        size="small"
                        className="rank-progress"
                      />
                      <Typography.Text strong>{item.count}</Typography.Text>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </Col>

          <Col xs={24} xl={12}>
            <Card title="规则风险分布" size="small" className="panel-card">
              <List
                dataSource={stats.aiRiskDistribution}
                locale={{ emptyText: '暂无规则预审数据' }}
                renderItem={(item) => (
                  <List.Item>
                    <div className="distribution-row">
                      <Tag color={item.color}>{item.label}</Tag>
                      <Progress
                        percent={getAIRiskPercent(item.count)}
                        size="small"
                        className="rank-progress"
                      />
                      <Typography.Text strong>{item.count}</Typography.Text>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      </section>
    </Spin>
  );
}

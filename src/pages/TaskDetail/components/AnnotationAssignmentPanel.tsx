import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Form,
  InputNumber,
  Popconfirm,
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
import {
  clearAssignment,
  executeAssignment,
  getAnnotators,
  getAssignableItems,
  getAssignmentStats,
  type ExecuteAssignParams,
} from '../../../api/assignment';
import type { AnnotatorInfo, AssignmentStats } from '../../../types';
import { SEMANTIC_COLORS } from '../../../utils/statusMeta';

interface AssignableItem {
  id: string;
  taskId: string;
  status: string;
  annotator: string | null;
  rawDataPreview: string;
}

export default function AnnotationAssignmentPanel({ taskId }: { taskId: string }) {
  const { message } = App.useApp();

  const [annotators, setAnnotators] = useState<AnnotatorInfo[]>([]);
  const [annotatorsLoading, setAnnotatorsLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [strategy, setStrategy] = useState<'even_split' | 'manual'>('even_split');
  const [selectedAnnotators, setSelectedAnnotators] = useState<string[]>([]);
  const [perPerson, setPerPerson] = useState(0);
  const [stats, setStats] = useState<AssignmentStats | null>(null);
  const [items, setItems] = useState<AssignableItem[]>([]);
  const [manualAssignments, setManualAssignments] = useState<Record<string, string>>({});

  // 已编辑但未提交的手动分配不能被后台刷新覆盖（Vue 版靠 reactive 上的 `id in map` 判断）
  const manualAssignmentsRef = useRef(manualAssignments);
  manualAssignmentsRef.current = manualAssignments;

  const annotatorOptions = useMemo(
    () => annotators.map((item) => ({ label: item.username, value: item.username })),
    [annotators],
  );

  const canAssign =
    strategy === 'even_split'
      ? selectedAnnotators.length > 0
      : Object.values(manualAssignments).some(Boolean);

  const loadAnnotators = useCallback(async () => {
    setAnnotatorsLoading(true);
    try {
      const res = await getAnnotators();
      setAnnotators(res.data);
    } catch {
      message.error('获取标注员列表失败');
    } finally {
      setAnnotatorsLoading(false);
    }
  }, [message]);

  const loadStats = useCallback(async () => {
    try {
      const res = await getAssignmentStats(taskId);
      setStats(res.data);
    } catch {
      // stats 加载失败不阻塞
    }
  }, [taskId]);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const res = await getAssignableItems(taskId);
      setItems(res.data.items);
      // 初始化手动分配映射：仅补齐新出现的数据项，保留用户已选但未提交的值
      const current = manualAssignmentsRef.current;
      const next = { ...current };
      let changed = false;
      res.data.items.forEach((item) => {
        if (!(item.id in next)) {
          next[item.id] = item.annotator || '';
          changed = true;
        }
      });
      if (changed) setManualAssignments(next);
    } catch {
      message.error('获取待分配数据失败');
    } finally {
      setItemsLoading(false);
    }
  }, [taskId, message]);

  const refreshData = useCallback(async () => {
    await Promise.all([loadStats(), loadItems()]);
  }, [loadStats, loadItems]);

  useEffect(() => {
    void loadAnnotators();
  }, [loadAnnotators]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  async function handleAssign() {
    setAssigning(true);
    try {
      const params: ExecuteAssignParams = { strategy };

      if (strategy === 'even_split') {
        params.annotators = selectedAnnotators;
        params.options = { perPerson };
      } else {
        const list = Object.entries(manualAssignments)
          .filter(([, annotator]) => annotator)
          .map(([itemId, annotator]) => ({ itemId, annotator }));
        if (list.length === 0) {
          message.warning('请至少为一条数据指定标注员');
          return;
        }
        params.options = { assignments: list };
      }

      const res = await executeAssignment(taskId, params);
      message.success(`分配成功，共分配 ${res.data.assigned} 条数据`);
      await refreshData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '分配失败');
    } finally {
      setAssigning(false);
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      const res = await clearAssignment(taskId);
      message.success(`已清除 ${res.data.cleared} 条分配`);
      setSelectedAnnotators([]);
      await refreshData();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '清除失败');
    } finally {
      setClearing(false);
    }
  }

  const columns = useMemo<TableColumnsType<AssignableItem>>(
    () => [
      { title: 'ID', dataIndex: 'id', key: 'id', width: 130, ellipsis: true },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 100,
        render: (status: string) => <Tag>{status}</Tag>,
      },
      {
        title: strategy === 'manual' ? '分配标注员' : '已分配标注员',
        dataIndex: 'annotator',
        key: 'annotator',
        width: 160,
        render: (_: unknown, record: AssignableItem) =>
          strategy === 'manual' ? (
            <Select
              value={manualAssignments[record.id] || undefined}
              placeholder="选择标注员"
              style={{ width: 140 }}
              allowClear
              options={annotatorOptions}
              onChange={(value) =>
                setManualAssignments((prev) => ({ ...prev, [record.id]: value ?? '' }))
              }
            />
          ) : (
            record.annotator || '-'
          ),
      },
      {
        title: '原始数据',
        dataIndex: 'rawDataPreview',
        key: 'rawDataPreview',
        ellipsis: true,
        render: (preview: string) => (
          <Tooltip title={preview}>
            <span className="ellipsis-cell">{preview}</span>
          </Tooltip>
        ),
      },
    ],
    [strategy, manualAssignments, annotatorOptions],
  );

  return (
    <Card title="标注分配" size="small" className="assignment-panel">
      {stats && (
        <Row gutter={16} className="stats-row">
          <Col span={6}>
            <Statistic title="总数" value={stats.total} />
          </Col>
          <Col span={6}>
            <Statistic
              title="已分配"
              value={stats.assigned}
              valueStyle={{ color: SEMANTIC_COLORS.success }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="未分配"
              value={stats.unassigned}
              valueStyle={{ color: SEMANTIC_COLORS.warning }}
            />
          </Col>
          <Col span={6}>
            <Statistic title="标注员" value={Object.keys(stats.byAnnotator).length} />
          </Col>
        </Row>
      )}

      <Divider />

      <Form layout="vertical">
        <Form.Item label="分配策略">
          <Radio.Group
            value={strategy}
            buttonStyle="solid"
            onChange={(event) => setStrategy(event.target.value as 'even_split' | 'manual')}
          >
            <Radio.Button value="even_split">按量均分</Radio.Button>
            <Radio.Button value="manual">手动指定</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {strategy === 'even_split' ? (
          <>
            <Form.Item label="选择标注员">
              <Checkbox.Group
                value={selectedAnnotators}
                onChange={(values) => setSelectedAnnotators(values as string[])}
              >
                <Row gutter={[16, 8]}>
                  {annotators.map((annotator) => (
                    <Col key={annotator.username} span={8}>
                      <Checkbox value={annotator.username}>{annotator.username}</Checkbox>
                    </Col>
                  ))}
                </Row>
              </Checkbox.Group>
              {annotators.length === 0 && !annotatorsLoading && (
                <Empty description="暂无可用的标注员" image={false} />
              )}
            </Form.Item>

            <Form.Item label="每人分配数量（0 = 全部分配）">
              <InputNumber
                value={perPerson}
                min={0}
                max={stats?.unassigned ?? 0}
                onChange={(value) => setPerPerson(value ?? 0)}
              />
            </Form.Item>
          </>
        ) : (
          <Alert
            type="info"
            showIcon
            message="在下方表格中为每条数据选择标注员"
            className="mode-hint"
          />
        )}

        <Space>
          <Button
            type="primary"
            loading={assigning}
            disabled={!canAssign}
            onClick={() => void handleAssign()}
          >
            执行分配
          </Button>
          <Popconfirm title="确认清除所有未开始标注的分配？" onConfirm={() => void handleClear()}>
            <Button loading={clearing} danger>
              清除分配
            </Button>
          </Popconfirm>
        </Space>
      </Form>

      <Divider />

      <Typography.Text type="secondary">待分配数据（共 {items.length} 条）</Typography.Text>

      <Table<AssignableItem>
        rowKey="id"
        size="small"
        className="items-table"
        columns={columns}
        dataSource={items}
        loading={itemsLoading}
        scroll={{ x: 640 }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total: number) => `共 ${total} 条`,
        }}
      />
    </Card>
  );
}

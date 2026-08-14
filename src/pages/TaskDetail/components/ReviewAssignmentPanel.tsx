// 任务详情中的审核人员分配面板。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Card, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  executeReviewAssignment,
  getReviewAssignableItems,
  getReviewers,
} from '../../../api/assignment';
import type { AnnotatorInfo } from '../../../types';

interface ReviewAssignableItem {
  id: string;
  taskId: string;
  status: string;
  annotator: string | null;
  reviewer: string | null;
  submittedAt: string | null;
  rawDataPreview: string;
}

export default function ReviewAssignmentPanel({ taskId }: { taskId: string }) {
  const { message } = App.useApp();

  const [reviewers, setReviewers] = useState<AnnotatorInfo[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [items, setItems] = useState<ReviewAssignableItem[]>([]);
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});

  // 刷新列表时保留已选择但未提交的审核员。
  const reviewAssignmentsRef = useRef(reviewAssignments);
  reviewAssignmentsRef.current = reviewAssignments;

  const reviewerOptions = useMemo(
    () => reviewers.map((reviewer) => ({ label: reviewer.username, value: reviewer.username })),
    [reviewers],
  );

  const canAssign = Object.values(reviewAssignments).some(Boolean);

  const loadReviewers = useCallback(async () => {
    try {
      const res = await getReviewers();
      setReviewers(res.data);
    } catch {
      message.error('获取审核员列表失败');
    }
  }, [message]);

  const loadItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const res = await getReviewAssignableItems(taskId);
      setItems(res.data.items);
      const current = reviewAssignmentsRef.current;
      const next = { ...current };
      let changed = false;
      res.data.items.forEach((item) => {
        if (!(item.id in next)) {
          next[item.id] = item.reviewer || '';
          changed = true;
        }
      });
      if (changed) setReviewAssignments(next);
    } catch {
      message.error('获取待分配审核数据失败');
    } finally {
      setItemsLoading(false);
    }
  }, [taskId, message]);

  useEffect(() => {
    void loadReviewers();
  }, [loadReviewers]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function handleAssign() {
    const list = Object.entries(reviewAssignments)
      .filter(([, reviewer]) => reviewer)
      .map(([itemId, reviewer]) => ({ itemId, reviewer }));

    if (list.length === 0) {
      message.warning('请至少为一条数据指定审核员');
      return;
    }

    setAssigning(true);
    try {
      const res = await executeReviewAssignment(taskId, list);
      message.success(`审核分配成功，共分配 ${res.data.assigned} 条数据`);
      await loadItems();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '审核分配失败');
    } finally {
      setAssigning(false);
    }
  }

  const columns = useMemo<TableColumnsType<ReviewAssignableItem>>(
    () => [
      { title: 'ID', dataIndex: 'id', key: 'id', width: 130, ellipsis: true },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (status: string) => <Tag>{status}</Tag>,
      },
      { title: '标注员', dataIndex: 'annotator', key: 'annotator', width: 110 },
      {
        title: '审核员',
        dataIndex: 'reviewer',
        key: 'reviewer',
        width: 160,
        render: (_: unknown, record: ReviewAssignableItem) => (
          <Select
            value={reviewAssignments[record.id] || undefined}
            placeholder="选择审核员"
            style={{ width: 140 }}
            allowClear
            options={reviewerOptions}
            onChange={(value) =>
              setReviewAssignments((prev) => ({ ...prev, [record.id]: value ?? '' }))
            }
          />
        ),
      },
      { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 150 },
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
    [reviewAssignments, reviewerOptions],
  );

  return (
    <Card title="审核分配" size="small" className="assignment-panel">
      <Alert
        type="info"
        showIcon
        message="为已提交的数据项分配审核员。标注员不能审核自己标注的数据。"
        className="mode-hint"
      />

      <Typography.Text type="secondary" className="count-text">
        待分配审核数据（共 {items.length} 条）
      </Typography.Text>

      <Table<ReviewAssignableItem>
        rowKey="id"
        size="small"
        className="items-table"
        columns={columns}
        dataSource={items}
        loading={itemsLoading}
        scroll={{ x: 900 }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total: number) => `共 ${total} 条`,
        }}
      />

      <Space className="actions">
        <Button
          type="primary"
          loading={assigning}
          disabled={!canAssign}
          onClick={() => void handleAssign()}
        >
          执行审核分配
        </Button>
      </Space>
    </Card>
  );
}

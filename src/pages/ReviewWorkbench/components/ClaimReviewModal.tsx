// 批量领取审核项的确认弹窗。
import { Button, Checkbox, Modal, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { Key } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import type { AvailableItem } from '../../../api/annotation';

interface ClaimReviewModalProps {
  open: boolean;
  loading: boolean;
  items: AvailableItem[];
  claimingId: string | null;
  batchClaiming: boolean;
  selectedIds: string[];
  continuous: boolean;
  /** taskId → 任务名 */
  taskNames: Record<string, string>;
  onClose: () => void;
  onContinuousChange: (value: boolean) => void;
  onRefresh: () => void;
  onClaim: (id: string) => void;
  onBatchClaim: () => void;
  onSelectionChange: (keys: Key[]) => void;
}

export default function ClaimReviewModal({
  open,
  loading,
  items,
  claimingId,
  batchClaiming,
  selectedIds,
  continuous,
  taskNames,
  onClose,
  onContinuousChange,
  onRefresh,
  onClaim,
  onBatchClaim,
  onSelectionChange,
}: ClaimReviewModalProps) {
  const claimColumns: TableColumnsType<AvailableItem> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 112, ellipsis: true },
    {
      title: '任务',
      dataIndex: 'taskId',
      key: 'taskId',
      width: 128,
      ellipsis: true,
      responsive: ['md'],
      render: (value: string) => taskNames[value] || value,
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 96 },
    {
      title: '标注员',
      dataIndex: 'annotator',
      key: 'annotator',
      width: 96,
      responsive: ['lg'],
      render: (value: string | undefined) => value || '未分配',
    },
    { title: '数据摘要', dataIndex: 'rawDataPreview', key: 'rawDataPreview', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 72,
      render: (_: unknown, record: AvailableItem) => (
        <Button
          type="link"
          size="small"
          loading={claimingId === record.id}
          onClick={() => onClaim(record.id)}
        >
          领取
        </Button>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      title="领取审核任务"
      width={780}
      footer={null}
      destroyOnClose
      onCancel={onClose}
    >
      <div className="lh-modal-stack">
        <Space wrap className="rw-claim-toolbar lh-modal-toolbar">
          <Button size="small" loading={loading} icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新
          </Button>
          <Button
            size="small"
            type="primary"
            loading={batchClaiming}
            disabled={selectedIds.length === 0}
            onClick={onBatchClaim}
          >
            批量领取 {selectedIds.length || ''}
          </Button>
          <Checkbox
            checked={continuous}
            onChange={(event) => onContinuousChange(event.target.checked)}
          >
            连续领取
          </Checkbox>
          <Typography.Text type="secondary">仅展示尚未分配审核员的待审数据。</Typography.Text>
        </Space>
        <Table<AvailableItem>
          rowKey="id"
          size="small"
          className="lh-modal-table"
          loading={loading}
          dataSource={items}
          columns={claimColumns}
          pagination={{ pageSize: 8 }}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: onSelectionChange }}
        />
      </div>
    </Modal>
  );
}

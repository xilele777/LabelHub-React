// 展示审核记录和状态流转时间线的弹窗。
import { Empty, Modal, Space, Tag, Timeline, Typography } from 'antd';
import type { AuditHistoryRecord } from '../../../types';
import { actionMeta, formatTime, statusLabel } from '../reviewDisplay';

interface AuditFlowModalProps {
  open: boolean;
  records: AuditHistoryRecord[];
  onClose: () => void;
}

export default function AuditFlowModal({ open, records, onClose }: AuditFlowModalProps) {
  return (
    <Modal open={open} title="流转记录" width={760} footer={null} onCancel={onClose}>
      <div className="lh-modal-detail">
        {records.length === 0 ? (
          <Empty description="暂无审核记录" />
        ) : (
          <Timeline
            mode="left"
            className="rw-audit-timeline"
            items={records.map((record) => ({
              key: record.id,
              color: actionMeta(record.actionType).color,
              children: (
                <div className="rw-timeline-row">
                  <Space wrap>
                    <Tag color={actionMeta(record.actionType).tagColor}>
                      {actionMeta(record.actionType).label}
                    </Tag>
                    <Tag>{statusLabel(record.fromStatus)}</Tag>
                    <span className="rw-timeline-arrow">→</span>
                    <Tag>{statusLabel(record.toStatus)}</Tag>
                  </Space>
                  <div className="rw-timeline-meta">
                    {record.operator} · {formatTime(record.timestamp)}
                  </div>
                  {record.reason && (
                    <Typography.Paragraph className="rw-timeline-reason">
                      {record.reason}
                    </Typography.Paragraph>
                  )}
                </div>
              ),
            }))}
          />
        )}
      </div>
    </Modal>
  );
}

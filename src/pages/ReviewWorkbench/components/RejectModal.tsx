// 驳回审核结果的原因填写弹窗。
import { useEffect, useState } from 'react';
import { Alert, App, Input, Modal } from 'antd';

interface RejectModalProps {
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export default function RejectModal({ open, loading, onClose, onConfirm }: RejectModalProps) {
  const { message } = App.useApp();
  const [reason, setReason] = useState('');

  // 每次打开重置原因，避免上一次驳回内容残留
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  function handleOk() {
    const trimmed = reason.trim();
    if (!trimmed) {
      message.warning('请填写驳回原因');
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <Modal
      open={open}
      title="驳回标注"
      okText="确认驳回"
      cancelText="取消"
      confirmLoading={loading}
      okButtonProps={{ danger: true }}
      onOk={handleOk}
      onCancel={onClose}
    >
      <div className="lh-modal-stack">
        <Alert
          type="warning"
          showIcon
          message="驳回后数据会返回给标注员重新修改，请填写清晰的原因。"
          className="rw-reject-alert"
        />
        <Input.TextArea
          value={reason}
          rows={5}
          maxLength={500}
          showCount
          placeholder="请输入驳回原因"
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Modal>
  );
}

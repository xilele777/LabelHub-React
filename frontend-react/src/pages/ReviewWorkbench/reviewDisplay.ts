/**
 * 审核工作台展示层常量与纯函数（页面与子组件共用）
 */
import {
  AuditActionType,
  DataItemStatus,
  STATUS_DISPLAY_CONFIG,
  type AuditHistoryRecord,
} from '../../types';
import { ReviewStatus } from '../../types/aiReview';
import { SEMANTIC_COLORS } from '../../utils/statusMeta';

export const statusFilterOptions = [
  { label: '规则预审中', value: 'ai_reviewing_group' },
  { label: '待人工审核', value: DataItemStatus.PENDING_REVIEW },
  { label: '审核通过', value: DataItemStatus.REVIEWED },
  { label: '审核驳回', value: DataItemStatus.REJECTED },
];

export const aiReviewFilterOptions = [
  { label: '预审通过', value: ReviewStatus.PASS },
  { label: '预审风险', value: ReviewStatus.RISK },
  { label: '预审不通过', value: ReviewStatus.FAIL },
];

export const REVIEW_ACTIONABLE_STATUSES = new Set<DataItemStatus>([
  DataItemStatus.SUBMITTED,
  DataItemStatus.AI_REVIEWING,
  DataItemStatus.AI_REVIEWED,
  DataItemStatus.PENDING_REVIEW,
]);

export const actionDisplay: Record<
  AuditActionType,
  { label: string; color: string; tagColor: string }
> = {
  [AuditActionType.SUBMIT]: { label: '提交标注', color: '#1890ff', tagColor: 'processing' },
  [AuditActionType.SAVE_DRAFT]: {
    label: '保存草稿',
    color: SEMANTIC_COLORS.warning,
    tagColor: 'warning',
  },
  [AuditActionType.CLAIM_ASSIGNMENT]: { label: '领取标注', color: '#2f54eb', tagColor: 'blue' },
  [AuditActionType.AI_REVIEW_START]: {
    label: '规则预审开始',
    color: '#722ed1',
    tagColor: 'purple',
  },
  [AuditActionType.AI_REVIEW_COMPLETE]: {
    label: '规则预审完成',
    color: '#13c2c2',
    tagColor: 'cyan',
  },
  [AuditActionType.ASSIGN_REVIEWER]: { label: '分配审核员', color: '#fa8c16', tagColor: 'orange' },
  [AuditActionType.CLAIM_REVIEW]: { label: '领取审核', color: '#1677ff', tagColor: 'processing' },
  [AuditActionType.APPROVE]: {
    label: '审核通过',
    color: SEMANTIC_COLORS.success,
    tagColor: 'success',
  },
  [AuditActionType.REJECT]: { label: '审核驳回', color: SEMANTIC_COLORS.danger, tagColor: 'error' },
  [AuditActionType.RESUBMIT]: { label: '重新提交', color: '#1890ff', tagColor: 'processing' },
  [AuditActionType.RELEASE_ANNOTATION_DUE_OVERDUE]: {
    label: '标注逾期释放',
    color: '#fa8c16',
    tagColor: 'warning',
  },
  [AuditActionType.RELEASE_REVIEW_DUE_OVERDUE]: {
    label: '审核逾期释放',
    color: '#fa8c16',
    tagColor: 'warning',
  },
  [AuditActionType.ARCHIVE]: { label: '归档', color: SEMANTIC_COLORS.success, tagColor: 'success' },
  [AuditActionType.UNARCHIVE]: {
    label: '取消归档',
    color: SEMANTIC_COLORS.warning,
    tagColor: 'warning',
  },
};

export function actionMeta(actionType: AuditHistoryRecord['actionType']) {
  const fallback = { label: actionType, color: '#8c8c8c', tagColor: 'default' };
  return actionDisplay[actionType as AuditActionType] ?? fallback;
}

export function aiStatusMeta(status: ReviewStatus) {
  if (status === ReviewStatus.PASS)
    return { label: '预审通过', tagColor: 'success', alertType: 'success' as const };
  if (status === ReviewStatus.RISK)
    return { label: '预审风险', tagColor: 'warning', alertType: 'warning' as const };
  return { label: '预审不通过', tagColor: 'error', alertType: 'error' as const };
}

export function statusLabel(status: DataItemStatus) {
  return STATUS_DISPLAY_CONFIG[status]?.label || status;
}

export function formatTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('zh-CN') : '未知';
}

export function formatShortTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '未提交';
}

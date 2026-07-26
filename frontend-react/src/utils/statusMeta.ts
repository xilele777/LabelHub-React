// 全站共享的状态/类型/角色显示元数据。
// 各页面统一从此处取用，避免各自维护映射导致配色漂移。
import { Role, TaskStatus, TaskType, STATUS_DISPLAY_CONFIG, type DataItemStatus } from '../types';

export interface DisplayMeta {
  label: string;
  color: string;
}

const FALLBACK_META: DisplayMeta = { label: '-', color: 'default' };

export const TASK_STATUS_META: Record<TaskStatus, DisplayMeta> = {
  [TaskStatus.DRAFT]: { label: '草稿', color: 'default' },
  [TaskStatus.PENDING]: { label: '待发布', color: 'processing' },
  [TaskStatus.IN_PROGRESS]: { label: '进行中', color: 'blue' },
  [TaskStatus.COMPLETED]: { label: '已完成', color: 'success' },
  [TaskStatus.ENDED]: { label: '已结束', color: 'warning' },
};

export const TASK_TYPE_META: Record<TaskType, DisplayMeta> = {
  [TaskType.IMAGE_CLASSIFICATION]: { label: '图像分类', color: 'blue' },
  [TaskType.OBJECT_DETECTION]: { label: '目标检测', color: 'green' },
  [TaskType.SEMANTIC_SEGMENTATION]: { label: '语义分割', color: 'purple' },
  [TaskType.TEXT_NER]: { label: '文本 NER', color: 'orange' },
};

export const ROLE_META: Record<Role, DisplayMeta> = {
  [Role.ADMIN]: { label: '管理员', color: 'purple' },
  [Role.OWNER]: { label: '负责人', color: 'blue' },
  [Role.ANNOTATOR]: { label: '标注员', color: 'green' },
  [Role.REVIEWER]: { label: '审核员', color: 'orange' },
};

export function getTaskStatusMeta(status: TaskStatus | null | undefined): DisplayMeta {
  return (status && TASK_STATUS_META[status]) || FALLBACK_META;
}

export function getTaskTypeMeta(type: TaskType | null | undefined): DisplayMeta {
  if (!type) return FALLBACK_META;
  return TASK_TYPE_META[type] ?? { label: type, color: 'default' };
}

export function getRoleMeta(role: Role | null | undefined): DisplayMeta {
  return (role && ROLE_META[role]) || FALLBACK_META;
}

export function getDataStatusMeta(status: DataItemStatus | null | undefined): DisplayMeta {
  return (status && STATUS_DISPLAY_CONFIG[status]) || FALLBACK_META;
}

// 与 main.ts ConfigProvider 主题 token 和 global.css 的 --lh-* 变量保持一致；
// JS 侧（如 ECharts、strokeColor、valueStyle）无法引用 CSS 变量，故在此镜像常量。
// 若调整主题色，需同步修改 main.ts、global.css 与此处。
export const SEMANTIC_COLORS = {
  primary: '#1a73e8',
  success: '#188038',
  warning: '#f9ab00',
  danger: '#d93025',
  info: '#129eaf',
} as const;

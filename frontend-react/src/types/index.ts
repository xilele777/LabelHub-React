// ========== 用户与角色类型 ==========

export enum Role {
  ADMIN = 'admin', // 管理员
  OWNER = 'owner', // 负责人
  ANNOTATOR = 'annotator', // 标注员
  REVIEWER = 'reviewer', // 审核员
}

export interface UserInfo {
  id: string;
  username: string;
  avatar?: string;
  role: Role;
}

// ========== 菜单与路由类型 ==========

export interface MenuItem {
  key: string;
  label: string;
  icon?: string;
  path: string;
  roles: Role[]; // 允许查看的角色列表
  children?: MenuItem[];
}

// ========== 任务类型 ==========

export enum TaskStatus {
  DRAFT = 'draft', // 草稿
  PENDING = 'pending', // 待发布
  IN_PROGRESS = 'in_progress', // 进行中
  COMPLETED = 'completed', // 已完成
  ENDED = 'ended', // 已结束
}

export enum TaskType {
  IMAGE_CLASSIFICATION = 'image_classification', // 图像分类
  OBJECT_DETECTION = 'object_detection', // 目标检测
  SEMANTIC_SEGMENTATION = 'semantic_segmentation', // 语义分割
  TEXT_NER = 'text_ner', // 文本命名实体识别
}

export enum TaskOverdueStrategy {
  REMIND_ONLY = 'remind_only', // 仅预警提醒
  BLOCK_SUBMIT = 'block_submit', // 逾期后禁止提交
  MANUAL_CLOSE = 'manual_close', // 逾期后由负责人手动结束
}

export interface TaskItem {
  id: string;
  name: string; // 任务名称
  description: string; // 任务描述
  type: TaskType; // 任务类型
  owner: string; // 负责人
  templateId: string; // 绑定模板ID
  templateName: string; // 模板名称
  instructions: string; // 任务说明
  status: TaskStatus; // 状态
  createdAt: string; // 创建时间 ISO 字符串
  startsAt: string | null; // 标注计划开始时间 ISO 字符串
  dueAt: string | null; // 标注截止时间 ISO 字符串
  reminderHours: number; // 标注截止前多少小时进入预警
  overdueStrategy: TaskOverdueStrategy; // 标注逾期处理策略
  reviewStartsAt: string | null; // 审核计划开始时间 ISO 字符串
  reviewDueAt: string | null; // 审核截止时间 ISO 字符串
  reviewReminderHours: number; // 审核截止前多少小时进入预警
  reviewOverdueStrategy: TaskOverdueStrategy; // 审核逾期处理策略
  annotationTimeoutHours: number; // 标注项自领取/分配起多少小时后过期
  reviewTimeoutHours: number; // 审核项自领取/分配起多少小时后过期
  taskEndedNotifiedAt?: string | null; // 任务周期结束通知时间
  assignmentConfig: AssignmentConfig; // 任务分配配置
  archived: boolean; // 是否已归档
  archivedAt: string | null; // 归档时间 ISO 字符串
}

// ========== 任务分配类型 ==========

/** 分配策略 */
export enum AssignmentStrategy {
  EVEN_SPLIT = 'even_split', // 按量均分
  MANUAL = 'manual', // 手动指定
}

/** 分配策略选项 */
export interface AssignmentOptions {
  perPerson?: number; // 按量均分：每人分配数量
  assignments?: { itemId: string; annotator: string }[]; // 手动指定：分配列表
}

/** 任务分配配置 */
export interface AssignmentConfig {
  strategy?: AssignmentStrategy; // 分配策略
  annotators?: string[]; // 标注员列表
  options?: AssignmentOptions; // 策略选项
  lastAssignedAt?: string; // 上次分配时间
  lastResult?: { assigned: number }; // 上次分配结果
}

/** 分配统计信息 */
export interface AssignmentStats {
  total: number; // 数据总条数
  assigned: number; // 已分配条数
  unassigned: number; // 未分配条数
  byAnnotator: Record<string, number>; // 按标注员统计
  byStatus: Record<string, number>; // 按状态统计
}

/** 标注员简要信息 */
export interface AnnotatorInfo {
  id: string;
  username: string;
  avatar: string | null;
  role: string;
}

// ========== 模板类型 ==========

export interface TemplateItem {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  fieldCount: number;
  creator: string;
  createdAt: string;
  /** 模板字段列表（服务端返回时包含此字段） */
  fields?: TemplateField[];
}

// ========== 动态标注模板 Schema ==========

/** 第一期支持的字段类型 */
export enum FieldType {
  INPUT = 'input', // 单行输入
  TEXTAREA = 'textarea', // 多行文本
  RADIO = 'radio', // 单选
  CHECKBOX = 'checkbox', // 多选
  SELECT = 'select', // 下拉
  RATING = 'rating', // 评分
  SWITCH = 'switch', // 开关
  TITLE = 'title', // 说明块（仅展示，无值）
}

/** 选项（radio / checkbox / select 共用） */
export interface FieldOption {
  id: string; // 前端生成的稳定 key，用于列表渲染 / 拖拽排序
  label: string;
  value: string;
}

/** 所有字段共享的基础属性 */
export interface BaseField {
  id: string; // 唯一标识，前端生成 uuid
  type: FieldType; // 字段类型
  fieldKey: string; // 字段标识，用于数据采集 & 导出 key
  label: string; // 字段标题
  required?: boolean; // 是否必填（title 忽略此项）
  placeholder?: string; // 占位提示文字
  description?: string; // 补充说明（标题下灰色小字）
  defaultValue?: unknown; // 默认值，类型由具体字段决定
}

/** 各字段类型的专属配置 */

export interface InputField extends BaseField {
  type: FieldType.INPUT;
  maxLength?: number;
  minLength?: number;
}

export interface TextareaField extends BaseField {
  type: FieldType.TEXTAREA;
  maxLength?: number;
  minLength?: number;
  autoSize?: boolean;
}

export interface RadioField extends BaseField {
  type: FieldType.RADIO;
  options: FieldOption[];
  direction?: 'horizontal' | 'vertical';
}

export interface CheckboxField extends BaseField {
  type: FieldType.CHECKBOX;
  options: FieldOption[];
  direction?: 'horizontal' | 'vertical';
  maxCheck?: number;
}

export interface SelectField extends BaseField {
  type: FieldType.SELECT;
  options: FieldOption[];
  multiple?: boolean;
  searchable?: boolean;
}

export interface RatingField extends BaseField {
  type: FieldType.RATING;
  maxScore?: number; // 最高分（映射到星星数量）
  allowHalf?: boolean;
}

export interface SwitchField extends BaseField {
  type: FieldType.SWITCH;
  checkedChildren?: string;
  unCheckedChildren?: string;
}

export interface TitleField extends BaseField {
  type: FieldType.TITLE;
  content?: string; // 说明块正文
  level?: 1 | 2 | 3 | 4 | 5;
}

/** 联合类型：所有字段并集 */
export type TemplateField =
  | InputField
  | TextareaField
  | RadioField
  | CheckboxField
  | SelectField
  | RatingField
  | SwitchField
  | TitleField;

/** 标注模板完整 Schema */
export interface AnnotationTemplate {
  id: string;
  name: string;
  type: TaskType;
  fields: TemplateField[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** 标注填写结果 */
export interface AnnotationRecord {
  id: string;
  templateId: string;
  taskId: string;
  data: Record<string, unknown>;
  annotator: string;
  createdAt: string;
}

// ========== 标注数据项类型 ==========

export enum DataItemStatus {
  PENDING = 'pending', // 待标注
  DRAFT = 'draft', // 已存草稿
  SUBMITTED = 'submitted', // 已提交
  AI_REVIEWING = 'ai_reviewing', // 规则预审中
  AI_REVIEWED = 'ai_reviewed', // 规则已预审
  PENDING_REVIEW = 'pending_review', // 待人工审核
  REVIEWED = 'reviewed', // 人工已审核（通过）
  REJECTED = 'rejected', // 人工已驳回
}

/** 审核操作类型 */
export enum AuditActionType {
  SUBMIT = 'submit', // 提交标注
  SAVE_DRAFT = 'save_draft', // 保存草稿
  CLAIM_ASSIGNMENT = 'claim_assignment', // 领取标注
  AI_REVIEW_START = 'ai_review_start', // 规则预审开始
  AI_REVIEW_COMPLETE = 'ai_review_complete', // 规则预审完成
  ASSIGN_REVIEWER = 'assign_reviewer', // 分配审核员（进入待人工审核）
  CLAIM_REVIEW = 'claim_review', // 领取审核
  APPROVE = 'approve', // 审核通过
  REJECT = 'reject', // 审核驳回
  RESUBMIT = 'resubmit', // 驳回后重新提交
  RELEASE_ANNOTATION_DUE_OVERDUE = 'release_annotation_due_overdue', // 标注项逾期释放
  RELEASE_REVIEW_DUE_OVERDUE = 'release_review_due_overdue', // 审核项逾期释放
  ARCHIVE = 'archive', // 归档
  UNARCHIVE = 'unarchive', // 取消归档
}

/** 审核历史记录 */
export interface AuditHistoryRecord {
  id: string; // 记录唯一ID
  operator: string; // 操作人（标注员/审核员/规则系统）
  actionType: AuditActionType | string; // 操作类型
  fromStatus: DataItemStatus; // 原状态
  toStatus: DataItemStatus; // 新状态
  reason: string | null; // 原因/备注（驳回时必填）
  timestamp: string; // 操作时间 ISO字符串
}

/** 状态流转映射（合法的状态转换） */
export const STATUS_TRANSITIONS: Record<DataItemStatus, DataItemStatus[]> = {
  // 允许从 pending 直接提交（无需先保存草稿）；服务端提交后会原子完成规则预审并进入待人工审核
  [DataItemStatus.PENDING]: [
    DataItemStatus.DRAFT,
    DataItemStatus.SUBMITTED,
    DataItemStatus.PENDING_REVIEW,
  ],
  // 草稿提交后服务端原子完成规则预审，前端会直接观察到 pending_review（同 pending/rejected）
  [DataItemStatus.DRAFT]: [
    DataItemStatus.SUBMITTED,
    DataItemStatus.PENDING,
    DataItemStatus.PENDING_REVIEW,
  ],
  // 服务端原子规则预审：submitted 可直接到 pending_review（跳过中间态）；
  // 仍保留 → ai_reviewing 供手动重跑规则预审使用
  [DataItemStatus.SUBMITTED]: [
    DataItemStatus.PENDING_REVIEW,
    DataItemStatus.AI_REVIEWING,
    DataItemStatus.REVIEWED,
    DataItemStatus.REJECTED,
  ],
  [DataItemStatus.AI_REVIEWING]: [
    DataItemStatus.AI_REVIEWED,
    DataItemStatus.REVIEWED,
    DataItemStatus.REJECTED,
  ],
  [DataItemStatus.AI_REVIEWED]: [
    DataItemStatus.PENDING_REVIEW,
    DataItemStatus.REVIEWED,
    DataItemStatus.REJECTED,
  ],
  [DataItemStatus.PENDING_REVIEW]: [DataItemStatus.REVIEWED, DataItemStatus.REJECTED],
  [DataItemStatus.REVIEWED]: [],
  // 驳回后可重新提交；若服务端在同一次 resubmit 中自动完成规则预审，前端会直接观察到 pending_review
  [DataItemStatus.REJECTED]: [DataItemStatus.SUBMITTED, DataItemStatus.PENDING_REVIEW],
};

/** 状态显示配置 */
export const STATUS_DISPLAY_CONFIG: Record<
  DataItemStatus,
  { label: string; color: string; icon: string }
> = {
  [DataItemStatus.PENDING]: { label: '待标注', color: 'default', icon: 'FileTextOutlined' },
  [DataItemStatus.DRAFT]: { label: '草稿', color: 'warning', icon: 'EditOutlined' },
  [DataItemStatus.SUBMITTED]: { label: '已提交', color: 'processing', icon: 'SendOutlined' },
  [DataItemStatus.AI_REVIEWING]: {
    label: '规则预审中',
    color: 'processing',
    icon: 'LoadingOutlined',
  },
  [DataItemStatus.AI_REVIEWED]: { label: '规则已预审', color: 'cyan', icon: 'RobotOutlined' },
  [DataItemStatus.PENDING_REVIEW]: { label: '待人工审核', color: 'orange', icon: 'AuditOutlined' },
  [DataItemStatus.REVIEWED]: { label: '审核通过', color: 'success', icon: 'CheckCircleOutlined' },
  [DataItemStatus.REJECTED]: { label: '审核驳回', color: 'error', icon: 'CloseCircleOutlined' },
};

export interface DataItem {
  id: string;
  taskId: string;
  rawData: Record<string, unknown>;
  status: DataItemStatus;
  annotationData: Record<string, unknown> | null;
  annotator: string | null;
  submittedAt: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  auditHistory: AuditHistoryRecord[]; // 审核操作历史
  version: number; // 乐观锁版本号，每次写入自增
  lockedBy: string | null; // 悲观锁：当前持有锁的用户
  lockedAt: string | null; // 悲观锁：锁的获取时间
  archived: boolean; // 是否已归档
  archivedAt: string | null; // 归档时间 ISO字符串
}

/** 并发冲突响应数据 */
export interface ConflictData {
  currentVersion: number;
  serverItem: DataItem;
}

/** 认领锁定响应数据 */
export interface LockData {
  lockedBy: string;
  lockedAt: string;
}

// ========== AI 自动预审类型（re-export） ==========

export { ReviewStatus } from './aiReview';
export type {
  Severity,
  MatchedRule,
  FieldWarning,
  ReviewSuggestion,
  AIReviewResult,
} from './aiReview';

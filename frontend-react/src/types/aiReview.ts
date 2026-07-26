// ========== 规则预审类型 ==========

/** 预审结果状态 */
export enum ReviewStatus {
  PASS = 'pass', // 通过
  RISK = 'risk', // 风险（需人工复核）
  FAIL = 'fail', // 不通过
}

/** 严重程度 */
export type Severity = 'error' | 'warning' | 'info';

/** 规则匹配项 - 命中的预审规则 */
export interface MatchedRule {
  ruleId: string; // 规则唯一标识
  name: string; // 规则名称
  severity: Severity; // 严重程度
  description: string; // 规则说明
}

/** 字段级警告 - 定位到具体标注字段 */
export interface FieldWarning {
  fieldKey: string; // 对应 TemplateField.fieldKey
  fieldLabel: string; // 字段标题，便于前端展示
  message: string; // 警告描述
  value?: unknown; // 触发警告的标注值（保留原始类型）
  severity: Severity;
}

/** 修改建议 */
export interface ReviewSuggestion {
  fieldKey: string; // 对应 TemplateField.fieldKey
  fieldLabel: string; // 字段标题
  current?: unknown; // 当前标注值
  suggested: unknown; // 建议修改值
  reason: string; // 建议原因
}

/** 单条数据项的规则预审结果 */
export interface AIReviewResult {
  id: string; // 预审结果唯一 ID
  dataItemId: string; // 关联 DataItem.id
  taskId: string; // 关联 TaskItem.id
  templateId: string; // 关联 AnnotationTemplate.id
  reviewStatus: ReviewStatus; // 整体预审状态
  score: number; // 置信度 / 质量评分 0-100
  summary: string; // 预审摘要（自然语言）
  matchedRules: MatchedRule[]; // 命中的规则列表
  fieldWarnings: FieldWarning[]; // 字段级警告列表
  suggestions: ReviewSuggestion[]; // 修改建议列表
  reviewedAt: string; // 预审时间 ISO 字符串
  modelVersion: string; // 使用的预审引擎版本，便于追溯
}

/**
 * 规则预审模拟器 — 规则引擎
 *
 * 纯规则驱动，不依赖大模型 API。
 * 对模板中每个非 TITLE 字段逐一执行所有规则，
 * 收集命中项后汇总为 AIReviewResult。
 *
 * ──────────────────────────────────────
 * 规则设计说明
 * ──────────────────────────────────────
 *
 * | 规则ID | 名称               | 严重程度 | 适用字段类型              | 触发条件                                    |
 * |--------|--------------------|----------|---------------------------|---------------------------------------------|
 * | R001   | 必填字段缺失       | error    | 所有非 TITLE              | required=true 且值为空                      |
 * | R002   | 评分超出范围        | error    | RATING                    | 值 < 0 或 > maxScore                        |
 * | R003   | 文本长度过短        | warning  | INPUT / TEXTAREA           | 非空文本长度 < minLength（默认 2）          |
 * | R004   | 分类字段为空        | error    | RADIO / SELECT / CHECKBOX | 非必填但值为空，可能影响数据归类            |
 * | R005   | "其他"类别风险      | warning  | RADIO / SELECT            | 选中了 value="other" 的选项                 |
 * | R006   | 评分偏低风险        | warning  | RATING                    | 0 < 值 < 2，表示标注不确定                  |
 *
 * 评分算法：
 *   基础分 100，error 扣 30，warning 扣 15，info 扣 5，最低 0。
 *   score < 60 或 maxSeverity=error → FAIL
 *   score < 80 或 maxSeverity=warning → RISK
 *   其余 → PASS
 */
import { FieldType, type AnnotationTemplate, type TemplateField } from '../types';
import {
  ReviewStatus,
  type AIReviewResult,
  type MatchedRule,
  type FieldWarning,
  type ReviewSuggestion,
  type Severity,
} from '../types/aiReview';

// =====================================================================
//  规则定义
// =====================================================================

/** 规则执行上下文 */
export interface RuleContext {
  field: TemplateField;
  value: unknown;
  rawData: Record<string, unknown>;
}

/** 单条预审规则 */
export interface ReviewRule {
  ruleId: string;
  name: string;
  severity: Severity;
  description: string;
  /** 返回命中消息，undefined 表示未命中 */
  check: (ctx: RuleContext) => string | undefined;
  /** 可选：返回修改建议 */
  suggest?: (ctx: RuleContext) => ReviewSuggestion | undefined;
}

// ---------- R001 必填字段缺失 ----------

const R001_RequiredFieldEmpty: ReviewRule = {
  ruleId: 'R001',
  name: '必填字段缺失',
  severity: 'error',
  description: '必填字段未填写将导致标注不可用',
  check(ctx) {
    const { field, value } = ctx;
    if (!field.required || field.type === FieldType.TITLE) return undefined;
    if (isEmpty(value)) {
      return `必填字段"${field.label}"为空`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field } = ctx;
    // 对选择类字段给出默认值建议
    if (field.type === FieldType.RADIO || field.type === FieldType.SELECT) {
      if ('options' in field && field.options.length > 0) {
        const first = field.options[0]!;
        return {
          fieldKey: field.fieldKey,
          fieldLabel: field.label,
          suggested: first.value,
          reason: `建议选择"${first.label}"作为默认值`,
        };
      }
    }
    if (field.type === FieldType.RATING) {
      return {
        fieldKey: field.fieldKey,
        fieldLabel: field.label,
        suggested: 3,
        reason: '建议先给一个中等评分',
      };
    }
    return undefined;
  },
};

// ---------- R002 评分超出范围 ----------

const R002_RatingOutOfRange: ReviewRule = {
  ruleId: 'R002',
  name: '评分超出范围',
  severity: 'error',
  description: 'rating 评分超出模板定义范围',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FieldType.RATING) return undefined;
    if (value === undefined || value === null || value === '') return undefined; // 空值由 R001 处理
    const maxScore = 'maxScore' in field ? (field.maxScore ?? 5) : 5;
    const numVal = Number(value);
    if (isNaN(numVal) || numVal < 0 || numVal > maxScore) {
      return `"${field.label}"评分 ${value} 超出允许范围 [0, ${maxScore}]`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field, value } = ctx;
    const maxScore = 'maxScore' in field ? (field.maxScore ?? 5) : 5;
    const numVal = Number(value);
    if (numVal > maxScore) {
      return {
        fieldKey: field.fieldKey,
        fieldLabel: field.label,
        current: value,
        suggested: maxScore,
        reason: `已超出最大评分，建议修正为 ${maxScore}`,
      };
    }
    if (numVal < 0) {
      return {
        fieldKey: field.fieldKey,
        fieldLabel: field.label,
        current: value,
        suggested: 0,
        reason: '评分不能为负数，建议修正为 0',
      };
    }
    return undefined;
  },
};

// ---------- R003 文本长度过短 ----------

const R003_TextTooShort: ReviewRule = {
  ruleId: 'R003',
  name: '文本长度过短',
  severity: 'warning',
  description: '文本字段内容过短可能缺乏有效信息',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FieldType.INPUT && field.type !== FieldType.TEXTAREA) return undefined;
    if (isEmpty(value)) return undefined; // 空值由 R001 处理
    const str = String(value);
    const minLength = 'minLength' in field ? field.minLength : undefined;
    const threshold = minLength ?? 2;
    if (str.length < threshold) {
      return `"${field.label}"文本内容过短（${str.length} 字符，最少建议 ${threshold}）`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field, value } = ctx;
    const minLen = 'minLength' in field ? field.minLength : 2;
    return {
      fieldKey: field.fieldKey,
      fieldLabel: field.label,
      current: value,
      suggested: `<补充内容，至少 ${minLen} 字>`,
      reason: '当前内容过短，建议补充详细信息',
    };
  },
};

// ---------- R004 分类字段为空 ----------

const R004_CategoryFieldEmpty: ReviewRule = {
  ruleId: 'R004',
  name: '分类字段为空',
  severity: 'error',
  description: '分类字段未选择将导致标注无法归类',
  check(ctx) {
    const { field, value } = ctx;
    const isCategoryType = [FieldType.RADIO, FieldType.SELECT, FieldType.CHECKBOX].includes(
      field.type,
    );
    if (!isCategoryType) return undefined;
    // 必填的空值由 R001 处理，这里只检查非必填的空值
    if (!field.required && isEmpty(value)) {
      return `分类字段"${field.label}"未选择，可能影响数据归类`;
    }
    return undefined;
  },
};

// ---------- R005 "其他"类别风险 ----------

const R005_OtherCategoryRisk: ReviewRule = {
  ruleId: 'R005',
  name: '"其他"类别风险',
  severity: 'warning',
  description: '选择了"其他"类别时建议确认是否有更精确选项',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FieldType.RADIO && field.type !== FieldType.SELECT) return undefined;
    if (!('options' in field)) return undefined;
    const otherOpt = field.options.find((o) => o.value === 'other' || o.label === '其他');
    if (otherOpt && value === otherOpt.value) {
      return `选择了"其他"类别，建议确认是否有更精确选项`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field } = ctx;
    if (!('options' in field)) return undefined;
    const nonOther = field.options.filter((o) => o.value !== 'other' && o.label !== '其他');
    if (nonOther.length > 0) {
      const pick = nonOther[0]!;
      return {
        fieldKey: field.fieldKey,
        fieldLabel: field.label,
        current: 'other',
        suggested: pick.value,
        reason: `"${pick.label}"可能是更精确的选择`,
      };
    }
    return undefined;
  },
};

// ---------- R006 评分偏低风险 ----------

const R006_LowRatingRisk: ReviewRule = {
  ruleId: 'R006',
  name: '评分偏低风险',
  severity: 'warning',
  description: '评分低于 2 可能表示标注不确定',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FieldType.RATING) return undefined;
    if (value === undefined || value === null || value === '') return undefined;
    const numVal = Number(value);
    if (!isNaN(numVal) && numVal > 0 && numVal < 2) {
      return `"${field.label}"评分偏低（${numVal}），可能表示标注不确定`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field, value } = ctx;
    return {
      fieldKey: field.fieldKey,
      fieldLabel: field.label,
      current: value,
      suggested: 3,
      reason: '建议适当上调评分或重新审视标注',
    };
  },
};

// ---------- 规则列表 ----------

const builtinRules: ReviewRule[] = [
  R001_RequiredFieldEmpty,
  R002_RatingOutOfRange,
  R003_TextTooShort,
  R004_CategoryFieldEmpty,
  R005_OtherCategoryRisk,
  R006_LowRatingRisk,
];

// =====================================================================
//  工具函数
// =====================================================================

/** 判断标注值是否为空 */
function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** 严重程度对应扣分 */
function severityDeduction(severity: Severity): number {
  switch (severity) {
    case 'error':
      return 30;
    case 'warning':
      return 15;
    case 'info':
      return 5;
  }
}

/** 计算质量评分（基础 100，逐项扣分，最低 0） */
function calculateScore(hits: { severity: Severity }[]): number {
  const totalDeduction = hits.reduce((sum, h) => sum + severityDeduction(h.severity), 0);
  return Math.max(0, 100 - totalDeduction);
}

/** 根据分数和最高严重程度推导整体预审状态 */
function deriveStatus(score: number, maxSeverity: Severity | null): ReviewStatus {
  if (maxSeverity === 'error') return ReviewStatus.FAIL;
  if (score < 60) return ReviewStatus.FAIL;
  if (maxSeverity === 'warning' || score < 80) return ReviewStatus.RISK;
  return ReviewStatus.PASS;
}

/** 生成自然语言摘要 */
function generateSummary(status: ReviewStatus, score: number, warnings: FieldWarning[]): string {
  const parts: string[] = [];
  if (status === ReviewStatus.PASS) {
    parts.push(`标注结果经预审评估通过，质量评分 ${score} 分。`);
  } else if (status === ReviewStatus.RISK) {
    parts.push(`标注结果存在风险项，质量评分 ${score} 分，建议人工复核。`);
  } else {
    parts.push(`标注结果未通过预审，质量评分 ${score} 分，需修正后重新提交。`);
  }
  const errorCount = warnings.filter((w) => w.severity === 'error').length;
  const warningCount = warnings.filter((w) => w.severity === 'warning').length;
  const infoCount = warnings.filter((w) => w.severity === 'info').length;
  if (errorCount > 0) parts.push(`严重问题 ${errorCount} 项`);
  if (warningCount > 0) parts.push(`风险警告 ${warningCount} 项`);
  if (infoCount > 0) parts.push(`提示 ${infoCount} 项`);
  return parts.join('，') + '。';
}

// =====================================================================
//  执行引擎
// =====================================================================

/** 引擎输入 */
export interface RunReviewInput {
  template: AnnotationTemplate;
  rawData: Record<string, unknown>;
  annotationResult: Record<string, unknown>;
  dataItemId: string;
  taskId: string;
  /** 额外自定义规则（可选） */
  extraRules?: ReviewRule[];
}

/**
 * 运行规则预审规则引擎
 *
 * 对模板中的每个非 TITLE 字段逐一执行所有规则，
 * 收集命中项，最后汇总为 AIReviewResult。
 */
export function runAIReview(input: RunReviewInput): AIReviewResult {
  const { template, rawData, annotationResult, dataItemId, taskId, extraRules = [] } = input;
  const rules = [...builtinRules, ...extraRules];

  const matchedRules: MatchedRule[] = [];
  const fieldWarnings: FieldWarning[] = [];
  const suggestions: ReviewSuggestion[] = [];
  const hitSeverities: Severity[] = [];

  for (const field of template.fields) {
    if (field.type === FieldType.TITLE) continue;
    const value = annotationResult[field.fieldKey];
    const ctx: RuleContext = { field, value, rawData };

    for (const rule of rules) {
      const hitMessage = rule.check(ctx);
      if (hitMessage !== undefined) {
        matchedRules.push({
          ruleId: rule.ruleId,
          name: rule.name,
          severity: rule.severity,
          description: rule.description,
        });
        fieldWarnings.push({
          fieldKey: field.fieldKey,
          fieldLabel: field.label,
          message: hitMessage,
          value,
          severity: rule.severity,
        });
        hitSeverities.push(rule.severity);

        const suggestion = rule.suggest?.(ctx);
        if (suggestion) {
          suggestion.current = suggestion.current ?? value;
          suggestions.push(suggestion);
        }
      }
    }
  }

  // 去重（同一规则可能命中多个字段，但规则本身只记录一次）
  const dedupedRules = matchedRules.filter(
    (r, i, arr) => arr.findIndex((x) => x.ruleId === r.ruleId) === i,
  );

  const score = calculateScore(hitSeverities.map((s) => ({ severity: s })));
  const maxSeverity =
    hitSeverities.length > 0
      ? hitSeverities.sort((a, b) => {
          const order: Record<Severity, number> = { error: 2, warning: 1, info: 0 };
          return order[b] - order[a];
        })[0]
      : null;
  const reviewStatus = deriveStatus(score, maxSeverity ?? null);
  const summary = generateSummary(reviewStatus, score, fieldWarnings);

  return {
    id: `rv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dataItemId,
    taskId,
    templateId: template.id,
    reviewStatus,
    score,
    summary,
    matchedRules: dedupedRules,
    fieldWarnings,
    suggestions,
    reviewedAt: new Date().toISOString(),
    modelVersion: 'labelhub-ai-rule-v1.0',
  };
}

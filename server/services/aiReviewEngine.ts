/**
 * 服务端规则预审引擎（TypeScript 源码）。
 * 纯规则驱动，不依赖大模型；逐字段执行规则并汇总预审结果。
 *
 * 规则设计：
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

// 结果和规则的类型定义。

type Severity = 'error' | 'warning' | 'info';
type ReviewStatus = 'pass' | 'risk' | 'fail';

interface FieldOption {
  id: string;
  label: string;
  value: string;
}

interface TemplateField {
  type: string;
  fieldKey: string;
  label: string;
  required?: boolean;
  maxScore?: number;
  minLength?: number;
  options?: FieldOption[];
}

interface AnnotationTemplate {
  id: string;
  fields: TemplateField[];
}

interface RuleContext {
  field: TemplateField;
  value: unknown;
  rawData: Record<string, unknown>;
}

interface MatchedRule {
  ruleId: string;
  name: string;
  severity: Severity;
  description: string;
}

interface FieldWarning {
  fieldKey: string;
  fieldLabel: string;
  message: string;
  value: unknown;
  severity: Severity;
}

interface ReviewSuggestion {
  fieldKey: string;
  fieldLabel: string;
  current?: unknown;
  suggested: unknown;
  reason: string;
}

interface AIReviewResult {
  id: string;
  dataItemId: string;
  taskId: string;
  templateId: string;
  reviewStatus: ReviewStatus;
  score: number;
  summary: string;
  matchedRules: MatchedRule[];
  fieldWarnings: FieldWarning[];
  suggestions: ReviewSuggestion[];
  reviewedAt: string;
  modelVersion: string;
}

interface ReviewRule {
  ruleId: string;
  name: string;
  severity: Severity;
  description: string;
  check: (ctx: RuleContext) => string | undefined;
  suggest?: (ctx: RuleContext) => ReviewSuggestion | undefined;
}

interface RunReviewInput {
  template: AnnotationTemplate;
  rawData: Record<string, unknown>;
  annotationResult: Record<string, unknown>;
  dataItemId: string;
  taskId: string;
  templateId?: string;
}

// 规则常量。

const FIELD_TYPE = {
  INPUT: 'input',
  TEXTAREA: 'textarea',
  RADIO: 'radio',
  CHECKBOX: 'checkbox',
  SELECT: 'select',
  RATING: 'rating',
  SWITCH: 'switch',
  TITLE: 'title',
} as const;

// 评分和摘要工具。

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

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

function calculateScore(hits: { severity: Severity }[]): number {
  const totalDeduction = hits.reduce((sum, h) => sum + severityDeduction(h.severity), 0);
  return Math.max(0, 100 - totalDeduction);
}

function deriveStatus(score: number, maxSeverity: Severity | null): ReviewStatus {
  if (maxSeverity === 'error') return 'fail';
  if (score < 60) return 'fail';
  if (maxSeverity === 'warning' || score < 80) return 'risk';
  return 'pass';
}

function generateSummary(status: ReviewStatus, score: number, warnings: FieldWarning[]): string {
  const parts: string[] = [];
  if (status === 'pass') {
    parts.push(`标注结果经预审评估通过，质量评分 ${score} 分。`);
  } else if (status === 'risk') {
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

// 规则定义。

const R001_RequiredFieldEmpty: ReviewRule = {
  ruleId: 'R001',
  name: '必填字段缺失',
  severity: 'error',
  description: '必填字段未填写将导致标注不可用',
  check(ctx) {
    const { field, value } = ctx;
    if (!field.required || field.type === FIELD_TYPE.TITLE) return undefined;
    if (isEmpty(value)) {
      return `必填字段"${field.label}"为空`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field } = ctx;
    if (field.type === FIELD_TYPE.RADIO || field.type === FIELD_TYPE.SELECT) {
      if (field.options && field.options.length > 0) {
        const first = field.options[0]!;
        return {
          fieldKey: field.fieldKey,
          fieldLabel: field.label,
          suggested: first.value,
          reason: `建议选择"${first.label}"作为默认值`,
        };
      }
    }
    if (field.type === FIELD_TYPE.RATING) {
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

const R002_RatingOutOfRange: ReviewRule = {
  ruleId: 'R002',
  name: '评分超出范围',
  severity: 'error',
  description: 'rating 评分超出模板定义范围',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FIELD_TYPE.RATING) return undefined;
    if (value === undefined || value === null || value === '') return undefined;
    const maxScore = field.maxScore ?? 5;
    const numVal = Number(value);
    if (isNaN(numVal) || numVal < 0 || numVal > maxScore) {
      return `"${field.label}"评分 ${value} 超出允许范围 [0, ${maxScore}]`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field, value } = ctx;
    const maxScore = field.maxScore ?? 5;
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

const R003_TextTooShort: ReviewRule = {
  ruleId: 'R003',
  name: '文本长度过短',
  severity: 'warning',
  description: '文本字段内容过短可能缺乏有效信息',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FIELD_TYPE.INPUT && field.type !== FIELD_TYPE.TEXTAREA) return undefined;
    if (isEmpty(value)) return undefined;
    const str = String(value);
    const threshold = field.minLength ?? 2;
    if (str.length < threshold) {
      return `"${field.label}"文本内容过短（${str.length} 字符，最少建议 ${threshold}）`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field, value } = ctx;
    const minLen = field.minLength ?? 2;
    return {
      fieldKey: field.fieldKey,
      fieldLabel: field.label,
      current: value,
      suggested: `<补充内容，至少 ${minLen} 字>`,
      reason: '当前内容过短，建议补充详细信息',
    };
  },
};

const R004_CategoryFieldEmpty: ReviewRule = {
  ruleId: 'R004',
  name: '分类字段为空',
  severity: 'error',
  description: '分类字段未选择将导致标注无法归类',
  check(ctx) {
    const { field, value } = ctx;
    const categoryTypes: string[] = [FIELD_TYPE.RADIO, FIELD_TYPE.SELECT, FIELD_TYPE.CHECKBOX];
    const isCategoryType = categoryTypes.includes(field.type);
    if (!isCategoryType) return undefined;
    if (!field.required && isEmpty(value)) {
      return `分类字段"${field.label}"未选择，可能影响数据归类`;
    }
    return undefined;
  },
};

const R005_OtherCategoryRisk: ReviewRule = {
  ruleId: 'R005',
  name: '"其他"类别风险',
  severity: 'warning',
  description: '选择了"其他"类别时建议确认是否有更精确选项',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FIELD_TYPE.RADIO && field.type !== FIELD_TYPE.SELECT) return undefined;
    if (!field.options) return undefined;
    const otherOpt = field.options.find((o) => o.value === 'other' || o.label === '其他');
    if (otherOpt && value === otherOpt.value) {
      return `选择了"其他"类别，建议确认是否有更精确选项`;
    }
    return undefined;
  },
  suggest(ctx) {
    const { field } = ctx;
    if (!field.options) return undefined;
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

const R006_LowRatingRisk: ReviewRule = {
  ruleId: 'R006',
  name: '评分偏低风险',
  severity: 'warning',
  description: '评分低于 2 可能表示标注不确定',
  check(ctx) {
    const { field, value } = ctx;
    if (field.type !== FIELD_TYPE.RATING) return undefined;
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

const builtinRules: ReviewRule[] = [
  R001_RequiredFieldEmpty,
  R002_RatingOutOfRange,
  R003_TextTooShort,
  R004_CategoryFieldEmpty,
  R005_OtherCategoryRisk,
  R006_LowRatingRisk,
];

// 执行引擎。

export function runAIReview(input: RunReviewInput): AIReviewResult {
  const {
    template,
    rawData,
    annotationResult,
    dataItemId,
    taskId,
    templateId = template.id,
  } = input;

  const fields = template.fields || [];
  const matchedRules: MatchedRule[] = [];
  const fieldWarnings: FieldWarning[] = [];
  const suggestions: ReviewSuggestion[] = [];
  const hitSeverities: Severity[] = [];

  for (const field of fields) {
    if (field.type === FIELD_TYPE.TITLE) continue;
    const value = annotationResult ? annotationResult[field.fieldKey] : undefined;
    const ctx: RuleContext = { field, value, rawData };

    for (const rule of builtinRules) {
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

        const suggestion = rule.suggest ? rule.suggest(ctx) : undefined;
        if (suggestion) {
          suggestion.current = suggestion.current ?? value;
          suggestions.push(suggestion);
        }
      }
    }
  }

  // 去重
  const dedupedRules = matchedRules.filter(
    (r, i, arr) => arr.findIndex((x) => x.ruleId === r.ruleId) === i,
  );

  const score = calculateScore(hitSeverities.map((s) => ({ severity: s })));
  const maxSeverity: Severity | null =
    hitSeverities.length > 0
      ? hitSeverities.sort((a, b) => {
          const order: Record<Severity, number> = { error: 2, warning: 1, info: 0 };
          return order[b] - order[a];
        })[0]!
      : null;
  const reviewStatus = deriveStatus(score, maxSeverity);
  const summary = generateSummary(reviewStatus, score, fieldWarnings);

  return {
    id: `rv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dataItemId,
    taskId,
    templateId,
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

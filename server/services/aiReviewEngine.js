/**
 * 服务端规则预审引擎。
 * 在提交时按模板字段执行固定规则，生成评分、风险项和修改建议。
 *
 * 当前规则：
 * | 规则ID | 名称               | 严重程度 | 适用字段类型              | 触发条件                                    |
 * |--------|--------------------|----------|---------------------------|---------------------------------------------|
 * | R001   | 必填字段缺失       | error    | 所有非 TITLE              | required=true 且值为空                      |
 * | R002   | 评分超出范围        | error    | RATING                    | 值 < 0 或 > maxScore                        |
 * | R003   | 文本长度过短        | warning  | INPUT / TEXTAREA           | 非空文本长度 < minLength（默认 2）          |
 * | R004   | 分类字段为空        | error    | RADIO / SELECT / CHECKBOX | 非必填但值为空，可能影响数据归类            |
 * | R005   | "其他"类别风险      | warning  | RADIO / SELECT            | 选中了 value="other" 的选项                 |
 * | R006   | 评分偏低风险        | warning  | RATING                    | 0 < 值 < 2，表示标注不确定                  |
 *
 * 评分算法：基础分 100，error 扣 30，warning 扣 15，info 扣 5，最低 0。
 *   score < 60 或 maxSeverity=error → FAIL
 *   score < 80 或 maxSeverity=warning → RISK
 *   其余 → PASS
 */

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
};

const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

const REVIEW_STATUS = {
  PASS: 'pass',
  RISK: 'risk',
  FAIL: 'fail',
};

// 评分和摘要工具。

/** 判断标注值是否为空 */
function isEmpty(value) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** 严重程度对应扣分 */
function severityDeduction(severity) {
  switch (severity) {
    case SEVERITY.ERROR:
      return 30;
    case SEVERITY.WARNING:
      return 15;
    case SEVERITY.INFO:
      return 5;
    default:
      return 5;
  }
}

/** 计算质量评分（基础 100，逐项扣分，最低 0） */
function calculateScore(hits) {
  const totalDeduction = hits.reduce((sum, h) => sum + severityDeduction(h.severity), 0);
  return Math.max(0, 100 - totalDeduction);
}

/** 根据分数和最高严重程度推导整体预审状态 */
function deriveStatus(score, maxSeverity) {
  if (maxSeverity === SEVERITY.ERROR) return REVIEW_STATUS.FAIL;
  if (score < 60) return REVIEW_STATUS.FAIL;
  if (maxSeverity === SEVERITY.WARNING || score < 80) return REVIEW_STATUS.RISK;
  return REVIEW_STATUS.PASS;
}

/** 生成自然语言摘要 */
function generateSummary(status, score, warnings) {
  const parts = [];
  if (status === REVIEW_STATUS.PASS) {
    parts.push(`标注结果经预审评估通过，质量评分 ${score} 分。`);
  } else if (status === REVIEW_STATUS.RISK) {
    parts.push(`标注结果存在风险项，质量评分 ${score} 分，建议人工复核。`);
  } else {
    parts.push(`标注结果未通过预审，质量评分 ${score} 分，需修正后重新提交。`);
  }
  const errorCount = warnings.filter((w) => w.severity === SEVERITY.ERROR).length;
  const warningCount = warnings.filter((w) => w.severity === SEVERITY.WARNING).length;
  const infoCount = warnings.filter((w) => w.severity === SEVERITY.INFO).length;
  if (errorCount > 0) parts.push(`严重问题 ${errorCount} 项`);
  if (warningCount > 0) parts.push(`风险警告 ${warningCount} 项`);
  if (infoCount > 0) parts.push(`提示 ${infoCount} 项`);
  return parts.join('，') + '。';
}

// 规则定义。

/**
 * 每条规则是一个对象：
 * { ruleId, name, severity, description, check(ctx), suggest?(ctx) }
 *
 * check 返回命中消息字符串（命中）或 undefined（未命中）。
 * suggest 返回修改建议对象或 undefined。
 */

// R001：必填字段缺失。
const R001 = {
  ruleId: 'R001',
  name: '必填字段缺失',
  severity: SEVERITY.ERROR,
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
        const first = field.options[0];
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

// R002：评分超出范围。
const R002 = {
  ruleId: 'R002',
  name: '评分超出范围',
  severity: SEVERITY.ERROR,
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

// R003：文本长度过短。
const R003 = {
  ruleId: 'R003',
  name: '文本长度过短',
  severity: SEVERITY.WARNING,
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

// R004：分类字段为空。
const R004 = {
  ruleId: 'R004',
  name: '分类字段为空',
  severity: SEVERITY.ERROR,
  description: '分类字段未选择将导致标注无法归类',
  check(ctx) {
    const { field, value } = ctx;
    const isCategoryType = [FIELD_TYPE.RADIO, FIELD_TYPE.SELECT, FIELD_TYPE.CHECKBOX].includes(
      field.type,
    );
    if (!isCategoryType) return undefined;
    if (!field.required && isEmpty(value)) {
      return `分类字段"${field.label}"未选择，可能影响数据归类`;
    }
    return undefined;
  },
};

// R005：“其他”类别风险。
const R005 = {
  ruleId: 'R005',
  name: '"其他"类别风险',
  severity: SEVERITY.WARNING,
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
      const pick = nonOther[0];
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

// R006：评分偏低风险。
const R006 = {
  ruleId: 'R006',
  name: '评分偏低风险',
  severity: SEVERITY.WARNING,
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

// 内置规则列表。
const builtinRules = [R001, R002, R003, R004, R005, R006];

// 执行引擎。

/**
 * 运行规则预审引擎（服务端版本）
 *
 * @param {Object} input
 * @param {Object} input.template - 模板对象（含 fields 数组）
 * @param {Object} input.rawData - 原始数据
 * @param {Object} input.annotationResult - 标注结果
 * @param {string} input.dataItemId - 数据项 ID
 * @param {string} input.taskId - 任务 ID
 * @param {string} input.templateId - 模板 ID
 * @returns {Object} AIReviewResult
 */
function runAIReview(input) {
  const { template, rawData, annotationResult, dataItemId, taskId, templateId } = input;

  const fields = template.fields || [];
  const matchedRules = [];
  const fieldWarnings = [];
  const suggestions = [];
  const hitSeverities = [];

  for (const field of fields) {
    if (field.type === FIELD_TYPE.TITLE) continue;
    const value = annotationResult ? annotationResult[field.fieldKey] : undefined;
    const ctx = { field, value, rawData };

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

  // 去重（同一规则可能命中多个字段，但规则本身只记录一次）
  const dedupedRules = matchedRules.filter(
    (r, i, arr) => arr.findIndex((x) => x.ruleId === r.ruleId) === i,
  );

  const score = calculateScore(hitSeverities.map((s) => ({ severity: s })));
  const maxSeverity =
    hitSeverities.length > 0
      ? hitSeverities.sort((a, b) => {
          const order = { error: 2, warning: 1, info: 0 };
          return order[b] - order[a];
        })[0]
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

module.exports = { runAIReview };

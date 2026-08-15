// 管理标注编辑过程中的实时规则预审结果。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationTemplate, DataItem } from '../../../types';
import { ReviewStatus, type AIReviewResult, type Severity } from '../../../types/aiReview';
import { runAIReview } from '../../../services/aiReviewEngine';

export interface UseLivePreReviewOptions {
  templateSchema: AnnotationTemplate | null;
  currentItem: DataItem | null;
  formState: Record<string, unknown>;
  /** 表单变化后防抖延迟 (ms)，默认 300。避免逐键触发全量规则重算。 */
  debounceMs?: number;
}

function createEmptyReview(
  currentItem: DataItem | null,
  templateSchema: AnnotationTemplate | null,
): AIReviewResult {
  return {
    id: 'local_empty',
    dataItemId: currentItem?.id ?? '',
    taskId: currentItem?.taskId ?? '',
    templateId: templateSchema?.id ?? '',
    reviewStatus: ReviewStatus.PASS,
    score: 100,
    summary: '实时预审通过，当前未发现风险。',
    matchedRules: [],
    fieldWarnings: [],
    suggestions: [],
    reviewedAt: new Date().toISOString(),
    modelVersion: 'labelhub-local-watch-v1',
  };
}

function runPreReview(
  templateSchema: AnnotationTemplate | null,
  currentItem: DataItem | null,
  formSnapshot: Record<string, unknown>,
): AIReviewResult {
  if (!templateSchema || !currentItem) return createEmptyReview(currentItem, templateSchema);
  return runAIReview({
    template: templateSchema,
    rawData: currentItem.rawData ?? {},
    annotationResult: formSnapshot,
    dataItemId: currentItem.id,
    taskId: currentItem.taskId,
  });
}

/**
 * 本地实时预审引擎：监听表单变化，按模板规则（必填/评分范围/文本长度/选项完整性）
 * 即时产出与后端规则预审同构的结果对象，用于标注过程中的实时反馈。
 *
 * 性能策略：
 * - templateSchema / currentItem 切换立即触发重算（useMemo 依赖）；
 * - formState 变化经过防抖（默认 300ms）后落入 formSnapshot 再参与计算，
 *   避免逐键触发 O(n×rules) 遍历；
 * - 表单快照为浅层引用，因为字段值都是原始类型（string/number/boolean）。
 */
export function useLivePreReview(options: UseLivePreReviewOptions) {
  const { templateSchema, currentItem, formState, debounceMs = 300 } = options;

  const [formSnapshot, setFormSnapshot] = useState<Record<string, unknown>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 表单变化后延迟更新快照，避免逐字触发规则计算。
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setFormSnapshot(formState);
    }, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [formState, debounceMs]);

  const liveReviewResult = useMemo(
    () => runPreReview(templateSchema, currentItem, formSnapshot),
    [templateSchema, currentItem, formSnapshot],
  );

  const riskStats = useMemo(() => {
    const init = { error: 0, warning: 0, info: 0 };
    return liveReviewResult.fieldWarnings.reduce((stats, warning) => {
      stats[warning.severity] += 1;
      return stats;
    }, init);
  }, [liveReviewResult]);

  const sortedWarnings = useMemo(() => {
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    return [...liveReviewResult.fieldWarnings].sort(
      (a, b) => order[a.severity] - order[b.severity],
    );
  }, [liveReviewResult]);

  function fieldWarnings(fieldKey: string) {
    return liveReviewResult.fieldWarnings.filter((warning) => warning.fieldKey === fieldKey);
  }

  function fieldValidateStatus(fieldKey: string): 'error' | 'warning' | undefined {
    const warnings = fieldWarnings(fieldKey);
    if (warnings.some((warning) => warning.severity === 'error')) return 'error';
    if (warnings.some((warning) => warning.severity === 'warning')) return 'warning';
    return undefined;
  }

  function fieldHelp(fieldKey: string) {
    return (
      fieldWarnings(fieldKey)
        .map((warning) => warning.message)
        .join('；') || undefined
    );
  }

  return { liveReviewResult, riskStats, sortedWarnings, fieldValidateStatus, fieldHelp };
}

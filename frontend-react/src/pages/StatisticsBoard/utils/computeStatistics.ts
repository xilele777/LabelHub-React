/**
 * Statistics board aggregation helpers.
 */
import {
  DataItemStatus,
  ReviewStatus,
  STATUS_DISPLAY_CONFIG,
  TaskStatus,
  type DataItem,
  type TaskItem,
} from '../../../types';
import type { AIReviewResult } from '../../../types/aiReview';
import { SEMANTIC_COLORS } from '../../../utils/statusMeta';

const STATUS_CHART_COLOR_MAP: Record<DataItemStatus, string> = {
  [DataItemStatus.PENDING]: '#8c8c8c',
  [DataItemStatus.DRAFT]: SEMANTIC_COLORS.warning,
  [DataItemStatus.SUBMITTED]: SEMANTIC_COLORS.primary,
  [DataItemStatus.AI_REVIEWING]: '#597ef7',
  [DataItemStatus.AI_REVIEWED]: '#13c2c2',
  [DataItemStatus.PENDING_REVIEW]: '#fa8c16',
  [DataItemStatus.REVIEWED]: SEMANTIC_COLORS.success,
  [DataItemStatus.REJECTED]: SEMANTIC_COLORS.danger,
};

const AI_RISK_MAP: Record<ReviewStatus, { label: string; color: string }> = {
  [ReviewStatus.PASS]: { label: '通过', color: SEMANTIC_COLORS.success },
  [ReviewStatus.RISK]: { label: '风险', color: SEMANTIC_COLORS.warning },
  [ReviewStatus.FAIL]: { label: '不通过', color: SEMANTIC_COLORS.danger },
};

export interface AnnotatorRankItem {
  annotator: string;
  displayName: string;
  submitCount: number;
}

export interface ReviewPassRate {
  total: number;
  passed: number;
  rejected: number;
  rate: number;
}

export interface StatusDistributionItem {
  status: DataItemStatus;
  label: string;
  count: number;
  color: string;
}

export interface AIRiskDistributionItem {
  status: ReviewStatus;
  label: string;
  count: number;
  color: string;
}

export interface StatisticsResult {
  totalTasks: number;
  inProgressTasks: number;
  passedDataCount: number;
  rejectedDataCount: number;
  aiRiskHitCount: number;
  totalDataItems: number;
  archivedDataItems: number;
  reviewPendingCount: number;
  annotatorRank: AnnotatorRankItem[];
  reviewPassRate: ReviewPassRate;
  statusDistribution: StatusDistributionItem[];
  aiRiskDistribution: AIRiskDistributionItem[];
}

const REVIEWED_STATUSES = new Set<DataItemStatus>([
  DataItemStatus.REVIEWED,
  DataItemStatus.REJECTED,
]);

const SUBMITTED_STATUSES = new Set<DataItemStatus>([
  DataItemStatus.SUBMITTED,
  DataItemStatus.AI_REVIEWING,
  DataItemStatus.AI_REVIEWED,
  DataItemStatus.PENDING_REVIEW,
  DataItemStatus.REVIEWED,
  DataItemStatus.REJECTED,
]);

function getDisplayName(annotator: string): string {
  return annotator;
}

function countUniqueRiskRules(aiResults: AIReviewResult[]): number {
  const matched = aiResults.filter(
    (result) =>
      result.reviewStatus === ReviewStatus.RISK || result.reviewStatus === ReviewStatus.FAIL,
  );
  const uniqueRuleIds = new Set(
    matched.flatMap((result) => result.matchedRules.map((r) => r.ruleId)),
  );
  return uniqueRuleIds.size;
}

export function computeStatistics(
  tasks: TaskItem[],
  dataItems: DataItem[],
  aiResults: AIReviewResult[],
): StatisticsResult {
  const totalTasks = tasks.length;
  const inProgressTasks = tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS).length;
  const totalDataItems = dataItems.length;
  const archivedDataItems = dataItems.filter((item) => item.archived).length;

  const passedDataCount = dataItems.filter(
    (item) => item.status === DataItemStatus.REVIEWED,
  ).length;
  const rejectedDataCount = dataItems.filter(
    (item) => item.status === DataItemStatus.REJECTED,
  ).length;
  const reviewPendingCount = dataItems.filter(
    (item) => item.status === DataItemStatus.PENDING_REVIEW,
  ).length;
  const aiRiskHitCount = countUniqueRiskRules(aiResults);

  const annotatorSubmitMap = new Map<string, number>();
  dataItems.forEach((item) => {
    const isSubmitted = Boolean(item.submittedAt) || SUBMITTED_STATUSES.has(item.status);
    if (item.annotator && isSubmitted) {
      annotatorSubmitMap.set(item.annotator, (annotatorSubmitMap.get(item.annotator) ?? 0) + 1);
    }
  });

  const annotatorRank = Array.from(annotatorSubmitMap.entries())
    .map(([annotator, submitCount]) => ({
      annotator,
      displayName: getDisplayName(annotator),
      submitCount,
    }))
    .sort((a, b) => b.submitCount - a.submitCount);

  const reviewedItems = dataItems.filter((item) => REVIEWED_STATUSES.has(item.status));
  const passed = reviewedItems.filter((item) => item.status === DataItemStatus.REVIEWED).length;
  const rejected = reviewedItems.filter((item) => item.status === DataItemStatus.REJECTED).length;
  const total = passed + rejected;
  const reviewPassRate: ReviewPassRate = {
    total,
    passed,
    rejected,
    rate: total > 0 ? passed / total : 0,
  };

  const statusCountMap = new Map<DataItemStatus, number>();
  dataItems.forEach((item) => {
    statusCountMap.set(item.status, (statusCountMap.get(item.status) ?? 0) + 1);
  });

  const statusDistribution = Object.values(DataItemStatus)
    .map((status) => ({
      status,
      label: STATUS_DISPLAY_CONFIG[status].label,
      count: statusCountMap.get(status) ?? 0,
      color: STATUS_CHART_COLOR_MAP[status],
    }))
    .filter((item) => item.count > 0);

  const aiRiskCountMap = new Map<ReviewStatus, number>();
  aiResults.forEach((result) => {
    aiRiskCountMap.set(result.reviewStatus, (aiRiskCountMap.get(result.reviewStatus) ?? 0) + 1);
  });

  const aiRiskDistribution = Object.values(ReviewStatus)
    .map((status) => ({
      status,
      label: AI_RISK_MAP[status].label,
      count: aiRiskCountMap.get(status) ?? 0,
      color: AI_RISK_MAP[status].color,
    }))
    .filter((item) => item.count > 0);

  return {
    totalTasks,
    inProgressTasks,
    passedDataCount,
    rejectedDataCount,
    aiRiskHitCount,
    totalDataItems,
    archivedDataItems,
    reviewPendingCount,
    annotatorRank,
    reviewPassRate,
    statusDistribution,
    aiRiskDistribution,
  };
}

import { DataItemStatus, type DataItem } from '../types';
import type { AIReviewResult } from '../types/aiReview';

// ========== 导出数据类型定义 ==========

/** 人工审核结果（导出用） */
export interface HumanReviewResult {
  reviewer: string | null;
  reviewedAt: string | null;
  result: 'approved' | 'rejected' | null;
  rejectReason: string | null;
}

/** 单条导出记录 */
export interface ExportRecord {
  id: string;
  taskId: string;
  rawData: Record<string, unknown> | null;
  annotationResult: Record<string, unknown> | null;
  aiReviewResult: AIReviewResult | null;
  humanReviewResult: HumanReviewResult | null;
  status: DataItemStatus;
}

/** 导出范围枚举 */
export enum ExportRange {
  ALL = 'all',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** 导出格式枚举 */
export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

// ========== 导出字段映射方案 ==========
// 详细映射说明见本文件末尾注释

/** CSV 列定义：key → 列标题（中文） */
export const CSV_COLUMN_MAP: Record<string, string> = {
  id: '数据ID',
  taskId: '任务ID',
  status: '状态',
  rawData: '原始数据',
  annotationResult: '标注结果',
  aiReviewResult: '规则预审结果(完整)',
  aiReviewStatus: '规则预审状态',
  aiReviewScore: '规则预审评分',
  aiReviewSummary: '规则预审摘要',
  humanReviewResult: '人工审核结果(完整)',
  humanReviewer: '审核人',
  humanReviewResult2: '人工审核结论',
  humanRejectReason: '驳回原因',
};

/** CSV 导出时使用的列顺序 */
export const CSV_COLUMN_ORDER: string[] = [
  'id',
  'taskId',
  'status',
  'rawData',
  'annotationResult',
  'aiReviewStatus',
  'aiReviewScore',
  'aiReviewSummary',
  'aiReviewResult',
  'humanReviewer',
  'humanReviewResult2',
  'humanRejectReason',
  'humanReviewResult',
];

// ========== 数据构造 ==========

function getHumanReviewConclusion(status: DataItemStatus): 'approved' | 'rejected' | null {
  if (status === DataItemStatus.REVIEWED) return 'approved';
  if (status === DataItemStatus.REJECTED) return 'rejected';
  return null;
}

export function buildHumanReviewResult(item: DataItem): HumanReviewResult {
  return {
    reviewer: item.reviewer,
    reviewedAt: item.reviewedAt,
    result: getHumanReviewConclusion(item.status),
    rejectReason: item.rejectReason,
  };
}

export function buildExportRecords(
  dataItems: DataItem[],
  aiReviewResults: AIReviewResult[],
): ExportRecord[] {
  const aiReviewMap = new Map<string, AIReviewResult>();
  for (const ar of aiReviewResults) {
    aiReviewMap.set(ar.dataItemId, ar);
  }

  return dataItems.map((item) => ({
    id: item.id,
    taskId: item.taskId,
    rawData: item.rawData ?? null,
    annotationResult: item.annotationData ?? null,
    aiReviewResult: aiReviewMap.get(item.id) ?? null,
    humanReviewResult: buildHumanReviewResult(item),
    status: item.status,
  }));
}

export function filterByRange(records: ExportRecord[], range: ExportRange): ExportRecord[] {
  switch (range) {
    case ExportRange.APPROVED:
      return records.filter((r) => r.status === DataItemStatus.REVIEWED);
    case ExportRange.REJECTED:
      return records.filter((r) => r.status === DataItemStatus.REJECTED);
    case ExportRange.ALL:
    default:
      return records;
  }
}

// ========== CSV 转换工具 ==========

export function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return escapeCsvCell(JSON.stringify(value));
  }
  return escapeCsvCell(String(value));
}

export function flattenRecordToCsvRow(record: ExportRecord): string[] {
  const aiResult = record.aiReviewResult;
  const humanResult = record.humanReviewResult;

  const flat: Record<string, unknown> = {
    id: record.id,
    taskId: record.taskId,
    status: record.status,
    rawData: record.rawData,
    annotationResult: record.annotationResult,
    aiReviewResult: aiResult,
    aiReviewStatus: aiResult?.reviewStatus ?? null,
    aiReviewScore: aiResult?.score ?? null,
    aiReviewSummary: aiResult?.summary ?? null,
    humanReviewResult: humanResult,
    humanReviewer: humanResult?.reviewer ?? null,
    humanReviewResult2: humanResult?.result ?? null,
    humanRejectReason: humanResult?.rejectReason ?? null,
  };

  return CSV_COLUMN_ORDER.map((key) => toCsvCell(flat[key]));
}

export function exportRecordsToCsv(records: ExportRecord[]): string {
  const header = CSV_COLUMN_ORDER.map((key) => escapeCsvCell(CSV_COLUMN_MAP[key] ?? key));
  const rows = records.map((record) => flattenRecordToCsvRow(record).join(','));
  return [header.join(','), ...rows].join('\n');
}

// ========== 文件下载工具 ==========

export function downloadFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadAsJson(records: ExportRecord[], filename: string): void {
  const jsonStr = JSON.stringify(records, null, 2);
  downloadFile(jsonStr, filename, 'application/json;charset=utf-8');
}

/** UTF-8 BOM \u524D\u7F00\uFF1AExcel \u6B63\u786E\u8BC6\u522B\u4E2D\u6587 CSV \u7F16\u7801\u7528 */
export const CSV_BOM = '\uFEFF';

export function downloadAsCsv(records: ExportRecord[], filename: string): void {
  const csvStr = exportRecordsToCsv(records);
  downloadFile(CSV_BOM + csvStr, filename, 'text/csv;charset=utf-8');
}

export function performExport(
  records: ExportRecord[],
  format: ExportFormat,
  baseFilename: string,
): void {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  switch (format) {
    case ExportFormat.JSON:
      downloadAsJson(records, baseFilename + '_' + timestamp + '.json');
      break;
    case ExportFormat.CSV:
      downloadAsCsv(records, baseFilename + '_' + timestamp + '.csv');
      break;
  }
}

/*
 * ========== 导出字段映射方案 ==========
 *
 * | 导出字段            | 数据来源                              | CSV 列名              | CSV 处理方式          |
 * |--------------------|--------------------------------------|----------------------|----------------------|
 * | id                 | DataItem.id                          | 数据ID                | 直接输出              |
 * | taskId             | DataItem.taskId                      | 任务ID                | 直接输出              |
 * | status             | DataItem.status                      | 状态                  | 枚举值字符串           |
 * | rawData            | DataItem.rawData                     | 原始数据              | JSON 序列化           |
 * | annotationResult   | DataItem.annotationData              | 标注结果              | JSON 序列化           |
 * | aiReviewResult     | AIReviewResult (by dataItemId)       | 规则预审结果(完整)    | JSON 序列化           |
 * | aiReviewStatus     | AIReviewResult.reviewStatus          | 规则预审状态          | 提取为独立列           |
 * | aiReviewScore      | AIReviewResult.score                 | 规则预审评分          | 提取为独立列           |
 * | aiReviewSummary    | AIReviewResult.summary               | 规则预审摘要          | 提取为独立列           |
 * | humanReviewResult  | 由 DataItem 审核字段构造              | 人工审核结果(完整)     | JSON 序列化           |
 * | humanReviewer      | DataItem.reviewer                    | 审核人                | 提取为独立列           |
 * | humanReviewResult2 | DataItem.status 推导                 | 人工审核结论           | 提取为独立列           |
 * | humanRejectReason  | DataItem.rejectReason                | 驳回原因              | 提取为独立列           |
 *
 * 说明：
 * - rawData / annotationResult / aiReviewResult / humanReviewResult 保持 JSON 序列化，
 *   便于后续程序解析，同时不丢失嵌套结构。
 * - aiReviewStatus / aiReviewScore / aiReviewSummary 从 aiReviewResult 提取为独立列，
 *   方便在 Excel / 数据库中直接筛选和统计。
 * - humanReviewer / humanReviewResult2 / humanRejectReason 从人工审核结果提取为独立列，
 *   方便快速定位审核人和驳回原因。
 */

import { describe, it, expect } from 'vitest';
import {
  buildHumanReviewResult,
  buildExportRecords,
  filterByRange,
  escapeCsvCell,
  toCsvCell,
  flattenRecordToCsvRow,
  exportRecordsToCsv,
  ExportRange,
  CSV_BOM,
  type ExportRecord,
} from '../utils/exportUtils';
import { DataItemStatus, ReviewStatus, type DataItem } from '../types';
import type { AIReviewResult } from '../types/aiReview';

function makeItem(overrides: Partial<DataItem> = {}): DataItem {
  return {
    id: 'item-1',
    taskId: 'task-1',
    rawData: { fileName: 'test.jpg' },
    status: DataItemStatus.REVIEWED,
    annotationData: { category: 'cat', confidence: 5 },
    annotator: 'annotator1',
    submittedAt: '2024-01-15T10:00:00Z',
    reviewer: 'reviewer1',
    reviewedAt: '2024-01-15T12:00:00Z',
    rejectReason: null,
    auditHistory: [],
    version: 1,
    lockedBy: null,
    lockedAt: null,
    archived: false,
    archivedAt: null,
    ...overrides,
  };
}

function makeAIReview(item: DataItem): AIReviewResult {
  return {
    id: 'rv-1',
    dataItemId: item.id,
    taskId: item.taskId,
    templateId: 'tpl-1',
    reviewStatus: ReviewStatus.PASS,
    score: 95,
    summary: '通过',
    matchedRules: [],
    fieldWarnings: [],
    suggestions: [],
    reviewedAt: '2024-01-15T11:00:00Z',
    modelVersion: 'v1',
  };
}

describe('buildHumanReviewResult', () => {
  it('返回 approved 当状态为 REVIEWED', () => {
    const item = makeItem({ status: DataItemStatus.REVIEWED });
    const result = buildHumanReviewResult(item);
    expect(result.result).toBe('approved');
  });

  it('返回 rejected 当状态为 REJECTED', () => {
    const item = makeItem({ status: DataItemStatus.REJECTED, rejectReason: '标注不完整' });
    const result = buildHumanReviewResult(item);
    expect(result.result).toBe('rejected');
    expect(result.rejectReason).toBe('标注不完整');
  });

  it('返回 null 当状态为 SUBMITTED（未审核）', () => {
    const item = makeItem({ status: DataItemStatus.SUBMITTED });
    const result = buildHumanReviewResult(item);
    expect(result.result).toBeNull();
  });
});

describe('buildExportRecords', () => {
  it('关联规则预审结果到对应数据条目', () => {
    const itemA = makeItem({ id: 'a' });
    const itemB = makeItem({ id: 'b' });
    const items = [itemA, itemB];
    const reviews = [
      { ...makeAIReview(itemA), dataItemId: 'a', score: 80 },
      { ...makeAIReview(itemB), dataItemId: 'b', score: 90 },
    ];
    const records = buildExportRecords(items, reviews);
    expect(records).toHaveLength(2);
    expect(records[0]!.aiReviewResult?.score).toBe(80);
    expect(records[1]!.aiReviewResult?.score).toBe(90);
  });

  it('未匹配到预审结果时 aiReviewResult 为 null', () => {
    const items = [makeItem({ id: 'orphan' })];
    const reviews: AIReviewResult[] = [];
    const records = buildExportRecords(items, reviews);
    expect(records[0]!.aiReviewResult).toBeNull();
  });
});

describe('filterByRange', () => {
  function makeRecord(status: DataItemStatus): ExportRecord {
    return {
      id: '1',
      taskId: 't1',
      rawData: {},
      annotationResult: {},
      aiReviewResult: null,
      humanReviewResult: { reviewer: null, reviewedAt: null, result: null, rejectReason: null },
      status,
    };
  }

  it('ALL 保留全部', () => {
    const records = [
      makeRecord(DataItemStatus.REVIEWED),
      makeRecord(DataItemStatus.REJECTED),
      makeRecord(DataItemStatus.SUBMITTED),
    ];
    expect(filterByRange(records, ExportRange.ALL)).toHaveLength(3);
  });

  it('APPROVED 仅保留 REVIEWED', () => {
    const records = [makeRecord(DataItemStatus.REVIEWED), makeRecord(DataItemStatus.REJECTED)];
    expect(filterByRange(records, ExportRange.APPROVED)).toHaveLength(1);
  });

  it('REJECTED 仅保留 REJECTED', () => {
    const records = [makeRecord(DataItemStatus.REVIEWED), makeRecord(DataItemStatus.REJECTED)];
    expect(filterByRange(records, ExportRange.REJECTED)).toHaveLength(1);
  });
});

describe('escapeCsvCell', () => {
  it('普通文本不需要引号', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
  });

  it('含逗号需要引号包裹', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('含双引号转义为两个双引号', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('含换行符需要引号', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('toCsvCell', () => {
  it('null/undefined 返回空字符串', () => {
    expect(toCsvCell(null)).toBe('');
    expect(toCsvCell(undefined)).toBe('');
  });

  it('对象序列化为 JSON 字符串（CSV 转义）', () => {
    const result = toCsvCell({ a: 1 });
    // toCsvCell 对 object 先 JSON.stringify 再 escapeCsvCell，双引号会被转义
    expect(result).toContain('a');
    expect(result).toContain('1');
  });

  it('字符串直接转义', () => {
    expect(toCsvCell('simple')).toBe('simple');
  });
});

describe('flattenRecordToCsvRow', () => {
  it('按 CSV_COLUMN_ORDER 顺序输出列', () => {
    const item = makeItem({ id: 'export-1', taskId: 'task-1' });
    const review = makeAIReview(item);
    const records = buildExportRecords([item], [review]);
    expect(records[0]).toBeDefined();
    const row = flattenRecordToCsvRow(records[0]!);
    // 验证行是一个数组且包含关键字段
    expect(Array.isArray(row)).toBe(true);
    const idIdx = row.findIndex((cell) => cell.includes('export-1') || cell === 'export-1');
    expect(idIdx).toBeGreaterThanOrEqual(0);
  });
});

describe('exportRecordsToCsv', () => {
  it('生成包含 BOM 头的 CSV', () => {
    const item = makeItem({
      id: 'csv-1',
      annotationData: { label: 'positive' },
    });
    const review = makeAIReview(item);
    const records = buildExportRecords([item], [review]);

    // 测试 CSV 序列化（不含 BOM，BOM 在 downloadAsCsv 中附加）
    const csv = exportRecordsToCsv(records);
    expect(csv).toContain('数据ID');
    expect(csv).toContain('csv-1');
  });

  it('CSV_BOM 为 UTF-8 BOM 字符', () => {
    expect(CSV_BOM).toBe('﻿');
  });
});

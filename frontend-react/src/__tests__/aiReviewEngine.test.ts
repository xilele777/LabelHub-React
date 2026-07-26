import { describe, it, expect } from 'vitest';
import { runAIReview, type RunReviewInput } from '../services/aiReviewEngine';
import { FieldType, ReviewStatus } from '../types';
import type { AnnotationTemplate, TemplateField } from '../types';

function makeTemplate(fields: TemplateField[] = []): AnnotationTemplate {
  return {
    id: 'tpl-test',
    name: 'Test Template',
    type: 'image_classification' as never,
    fields,
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeField(overrides: Partial<TemplateField> = {}): TemplateField {
  return {
    id: 'f1',
    type: FieldType.INPUT,
    fieldKey: 'title',
    label: '标题',
    required: false,
    ...overrides,
  } as TemplateField;
}

describe('runAIReview', () => {
  it('空模板返回 PASS 满分', () => {
    const input: RunReviewInput = {
      template: makeTemplate([]),
      rawData: {},
      annotationResult: {},
      dataItemId: 'd1',
      taskId: 't1',
    };
    const result = runAIReview(input);
    expect(result.reviewStatus).toBe(ReviewStatus.PASS);
    expect(result.score).toBe(100);
    expect(result.fieldWarnings).toHaveLength(0);
  });

  it('R001: 必填字段为空 → FAIL', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({ fieldKey: 'name', label: '名称', required: true, type: FieldType.INPUT }),
      ]),
      rawData: {},
      annotationResult: { name: '' },
      dataItemId: 'd2',
      taskId: 't2',
    };
    const result = runAIReview(input);
    expect(result.reviewStatus).toBe(ReviewStatus.FAIL);
    expect(result.score).toBeLessThan(80);
    expect(result.fieldWarnings.some((w) => w.severity === 'error')).toBe(true);
  });

  it('R002: 评分超出范围 → error', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({
          fieldKey: 'score',
          label: '评分',
          type: FieldType.RATING,
          maxScore: 5,
          required: true,
        }),
      ]),
      rawData: {},
      annotationResult: { score: 10 },
      dataItemId: 'd3',
      taskId: 't3',
    };
    const result = runAIReview(input);
    expect(result.fieldWarnings.some((w) => w.severity === 'error')).toBe(true);
  });

  it('R004: 非必填分类为空 → error', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({
          fieldKey: 'category',
          label: '分类',
          type: FieldType.SELECT,
          required: false,
          options: [
            { id: 'opt1', label: 'A', value: 'a' },
            { id: 'opt2', label: 'B', value: 'b' },
          ],
        }),
      ]),
      rawData: {},
      annotationResult: { category: '' },
      dataItemId: 'd4',
      taskId: 't4',
    };
    const result = runAIReview(input);
    // R004 对非必填但为空的分类字段报 error
    expect(result.fieldWarnings.length).toBeGreaterThan(0);
  });

  it('全部字段填写正确 → PASS', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({
          fieldKey: 'name',
          label: '名称',
          required: true,
          type: FieldType.INPUT,
        }),
        makeField({
          fieldKey: 'rating',
          label: '评分',
          type: FieldType.RATING,
          maxScore: 5,
          required: true,
        }),
      ]),
      rawData: {},
      annotationResult: { name: '正常文本', rating: 4 },
      dataItemId: 'd5',
      taskId: 't5',
    };
    const result = runAIReview(input);
    expect(result.reviewStatus).toBe(ReviewStatus.PASS);
    expect(result.score).toBe(100);
  });

  it('TITLE 类型字段被跳过（不参与规则检查）', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({
          fieldKey: 'section',
          label: '说明块',
          type: FieldType.TITLE,
          content: '这是说明',
        }),
        makeField({
          fieldKey: 'name',
          label: '名称',
          required: true,
          type: FieldType.INPUT,
        }),
      ]),
      rawData: {},
      annotationResult: { name: '正常值' },
      dataItemId: 'd6',
      taskId: 't6',
    };
    const result = runAIReview(input);
    // TITLE 字段不参与检查，name 填写正常 → PASS
    expect(result.reviewStatus).toBe(ReviewStatus.PASS);
    // fieldWarnings 中不应包含 TITLE 字段
    expect(result.fieldWarnings.every((w) => w.fieldKey !== 'section')).toBe(true);
  });

  it('R003: 文本过短 → warning', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({
          fieldKey: 'desc',
          label: '描述',
          type: FieldType.TEXTAREA,
          required: false,
        }),
      ]),
      rawData: {},
      annotationResult: { desc: 'A' },
      dataItemId: 'd7',
      taskId: 't7',
    };
    const result = runAIReview(input);
    expect(result.fieldWarnings.some((w) => w.severity === 'warning')).toBe(true);
  });

  it('score / summary / suggestions 四要素完整性', () => {
    const input: RunReviewInput = {
      template: makeTemplate([
        makeField({
          fieldKey: 'name',
          label: '名称',
          required: true,
          type: FieldType.INPUT,
        }),
      ]),
      rawData: {},
      annotationResult: { name: '' },
      dataItemId: 'd8',
      taskId: 't8',
    };
    const result = runAIReview(input);
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.matchedRules)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

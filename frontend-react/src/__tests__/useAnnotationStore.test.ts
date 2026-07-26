/**
 * 标注状态流转回归测试
 *
 * 运行: npx vitest run src/__tests__/useAnnotationStore.test.ts
 */
import { describe, expect, it } from 'vitest';
import { DataItemStatus, STATUS_TRANSITIONS } from '../types';

describe('annotation status transitions', () => {
  it('allows draft items to move directly to pending_review after atomic submit + rule review', () => {
    expect(STATUS_TRANSITIONS[DataItemStatus.DRAFT]).toContain(DataItemStatus.SUBMITTED);
    expect(STATUS_TRANSITIONS[DataItemStatus.DRAFT]).toContain(DataItemStatus.PENDING_REVIEW);
  });

  it('allows rejected items to move directly to pending_review after atomic resubmit + rule review', () => {
    expect(STATUS_TRANSITIONS[DataItemStatus.REJECTED]).toContain(DataItemStatus.SUBMITTED);
    expect(STATUS_TRANSITIONS[DataItemStatus.REJECTED]).toContain(DataItemStatus.PENDING_REVIEW);
  });

  it('keeps other reviewer-side transitions unchanged', () => {
    expect(STATUS_TRANSITIONS[DataItemStatus.PENDING_REVIEW]).toEqual([
      DataItemStatus.REVIEWED,
      DataItemStatus.REJECTED,
    ]);
  });
});

/** 任务、标注项和审核项的开始时间、开放状态及超时判断。 */

// 状态和触发动作。

export const ANNOTATION_START_ACTIONS = ['assign_annotator', 'claim_assignment', 'reject'] as const;
export const REVIEW_START_ACTIONS = ['assign_reviewer', 'claim_review'] as const;
export const ANNOTATION_OPEN_STATUSES = ['pending', 'draft', 'rejected'] as const;
export const REVIEW_OPEN_STATUSES = ['submitted', 'pending_review'] as const;

// 时间工具。

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function isTaskStarted(
  task: { startsAt?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  const startsAt = parseTime(task?.startsAt);
  return !startsAt || startsAt <= now;
}

export function isTaskExpired(
  task: { dueAt?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  const dueAt = parseTime(task?.dueAt);
  return Boolean(dueAt && dueAt <= now);
}

export function hasFutureDueAt(
  task: { dueAt?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  const dueAt = parseTime(task?.dueAt);
  return Boolean(dueAt && dueAt > now);
}

export function canTaskExposeWorkItems(
  task:
    | {
        status?: string;
        archived?: boolean;
        taskEndedNotifiedAt?: string | null;
        startsAt?: string | null;
        dueAt?: string | null;
      }
    | null
    | undefined,
  now = Date.now(),
): boolean {
  const isWorkStatus =
    task?.status === 'in_progress' ||
    (task?.status === 'ended' &&
      !task?.archived &&
      !task?.taskEndedNotifiedAt &&
      hasFutureDueAt(task, now));
  return Boolean(task && isWorkStatus && isTaskStarted(task, now) && !isTaskExpired(task, now));
}

// 审计记录时间。

interface AuditRecord {
  actionType?: string;
  timestamp?: string;
}

function getLatestAuditTimestamp(
  item: { auditHistory?: AuditRecord[] } | null | undefined,
  actionTypes: readonly string[],
): number | null {
  if (!Array.isArray(item?.auditHistory)) return null;
  let latest: number | null = null;
  for (const record of item!.auditHistory!) {
    if (!record || !actionTypes.includes(record.actionType!)) continue;
    const timestamp = parseTime(record.timestamp);
    if (timestamp && (!latest || timestamp > latest)) {
      latest = timestamp;
    }
  }
  return latest;
}

export function getItemStartTimestamp(
  item: { auditHistory?: AuditRecord[] } | null | undefined,
  phase: 'review' | 'annotation',
): number | null {
  return getLatestAuditTimestamp(
    item,
    phase === 'review' ? REVIEW_START_ACTIONS : ANNOTATION_START_ACTIONS,
  );
}

// 超时配置。

interface TaskLike {
  reviewTimeoutHours?: number | null;
  reviewReminderHours?: number | null;
  annotationTimeoutHours?: number | null;
  reminderHours?: number | null;
}

export function getItemTimeoutHours(
  task: TaskLike | null | undefined,
  phase: 'review' | 'annotation',
): number {
  if (!task) return 0;
  const value =
    phase === 'review'
      ? (task.reviewTimeoutHours ?? task.reviewReminderHours)
      : (task.annotationTimeoutHours ?? task.reminderHours);
  return Math.max(0, Number(value ?? 0));
}

// 过期判断。

interface ItemLike {
  reviewer?: string | null;
  auditHistory?: AuditRecord[];
}

export function isItemExpired(
  task: TaskLike | null | undefined,
  item: ItemLike | null | undefined,
  phase: 'review' | 'annotation',
  now = Date.now(),
): boolean {
  if (phase === 'review' && !item?.reviewer) {
    return false;
  }

  const timeoutHours = getItemTimeoutHours(task, phase);
  if (timeoutHours <= 0) return false;
  const startedAt = getItemStartTimestamp(item, phase);
  if (!startedAt) return false;
  return startedAt + timeoutHours * 60 * 60 * 1000 <= now;
}

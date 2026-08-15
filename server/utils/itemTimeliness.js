/** 任务、标注项和审核项的时效判断运行版本。 */

const ANNOTATION_START_ACTIONS = ['assign_annotator', 'claim_assignment', 'reject'];
const REVIEW_START_ACTIONS = ['assign_reviewer', 'claim_review'];
const ANNOTATION_OPEN_STATUSES = ['pending', 'draft', 'rejected'];
const REVIEW_OPEN_STATUSES = ['submitted', 'pending_review'];

function parseTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function isTaskStarted(task, now = Date.now()) {
  const startsAt = parseTime(task?.startsAt);
  return !startsAt || startsAt <= now;
}

function isTaskExpired(task, now = Date.now()) {
  const dueAt = parseTime(task?.dueAt);
  return Boolean(dueAt && dueAt <= now);
}

function hasFutureDueAt(task, now = Date.now()) {
  const dueAt = parseTime(task?.dueAt);
  return Boolean(dueAt && dueAt > now);
}

function canTaskExposeWorkItems(task, now = Date.now()) {
  const isWorkStatus =
    task?.status === 'in_progress' ||
    (task?.status === 'ended' &&
      !task?.archived &&
      !task?.taskEndedNotifiedAt &&
      hasFutureDueAt(task, now));
  return Boolean(task && isWorkStatus && isTaskStarted(task, now) && !isTaskExpired(task, now));
}

function getLatestAuditTimestamp(item, actionTypes) {
  if (!Array.isArray(item?.auditHistory)) return null;
  let latest = null;
  for (const record of item.auditHistory) {
    if (!record || !actionTypes.includes(record.actionType)) continue;
    const timestamp = parseTime(record.timestamp);
    if (timestamp && (!latest || timestamp > latest)) {
      latest = timestamp;
    }
  }
  return latest;
}

function getItemStartTimestamp(item, phase) {
  return getLatestAuditTimestamp(
    item,
    phase === 'review' ? REVIEW_START_ACTIONS : ANNOTATION_START_ACTIONS,
  );
}

function getItemTimeoutHours(task, phase) {
  if (!task) return 0;
  const value =
    phase === 'review'
      ? (task.reviewTimeoutHours ?? task.reviewReminderHours)
      : (task.annotationTimeoutHours ?? task.reminderHours);
  return Math.max(0, Number(value ?? 0));
}

function isItemExpired(task, item, phase, now = Date.now()) {
  if (phase === 'review' && !item?.reviewer) {
    return false;
  }

  const timeoutHours = getItemTimeoutHours(task, phase);
  if (timeoutHours <= 0) return false;
  const startedAt = getItemStartTimestamp(item, phase);
  if (!startedAt) return false;
  return startedAt + timeoutHours * 60 * 60 * 1000 <= now;
}

module.exports = {
  ANNOTATION_OPEN_STATUSES,
  REVIEW_OPEN_STATUSES,
  canTaskExposeWorkItems,
  getItemStartTimestamp,
  getItemTimeoutHours,
  hasFutureDueAt,
  isItemExpired,
  isTaskExpired,
  isTaskStarted,
};

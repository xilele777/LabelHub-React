/** 定时扫描任务和标注项，释放逾期占用并发送提醒通知。 */
const db = require('../store/db');
const {
  NOTIFICATION_TYPE,
  createNotification,
  notifyUsersByUsername,
} = require('./notificationService');
const {
  ANNOTATION_OPEN_STATUSES,
  REVIEW_OPEN_STATUSES,
  isItemExpired,
  isTaskExpired,
} = require('../utils/itemTimeliness');

const DEFAULT_SCAN_INTERVAL_MS = 5 * 60 * 1000;
let timer = null;

function formatTime(value) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function notifyTaskEnded(task, holders) {
  const users = [...new Set(holders.filter(Boolean))];
  if (users.length === 0) return false;

  const notification = createNotification({
    type: NOTIFICATION_TYPE.TASK_DUE_SOON,
    title: '任务周期已结束',
    message: `任务「${task.name}」已到达任务期限，未完成的数据将不再显示。`,
    data: { taskId: task.id, taskName: task.name, phase: 'task', dueAt: task.dueAt },
    sender: 'system',
  });

  notifyUsersByUsername(users, notification);
  return true;
}

function notifyItemExpired(task, item, phase, username) {
  if (!username) return;
  const isReview = phase === 'review';
  const notification = createNotification({
    type: NOTIFICATION_TYPE.TASK_DUE_SOON,
    title: isReview ? '审核项已逾期' : '标注项已逾期',
    message: `任务「${task.name}」中的${isReview ? '审核' : '标注'}项已超过处理时限，数据已回到任务池。`,
    data: {
      taskId: task.id,
      taskName: task.name,
      dataItemId: item.id,
      phase,
    },
    sender: 'system',
  });
  notifyUsersByUsername([username], notification);
}

function releaseAnnotationItem(task, item, now) {
  const holder = item.annotator;
  if (!holder || item.archived || !ANNOTATION_OPEN_STATUSES.includes(item.status)) return false;
  if (!isItemExpired(task, item, 'annotation', now)) return false;

  const timestamp = new Date(now).toISOString();
  const historyRecord = {
    id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    operator: 'system',
    actionType: 'release_annotation_due_overdue',
    fromStatus: item.status,
    toStatus: item.status,
    reason: `标注项处理时限已到，自动释放标注员 ${holder}`,
    timestamp,
  };

  db.updateById('annotation-items', item.id, {
    annotator: null,
    lockedBy: null,
    lockedAt: null,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });
  notifyItemExpired(task, item, 'annotation', holder);
  return true;
}

function releaseReviewItem(task, item, now) {
  const holder = item.reviewer;
  if (!holder || item.archived || !REVIEW_OPEN_STATUSES.includes(item.status)) return false;
  if (!isItemExpired(task, item, 'review', now)) return false;

  const timestamp = new Date(now).toISOString();
  const historyRecord = {
    id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    operator: 'system',
    actionType: 'release_review_due_overdue',
    fromStatus: item.status,
    toStatus: item.status,
    reason: `审核项处理时限已到，自动释放审核员 ${holder}`,
    timestamp,
  };

  db.updateById('annotation-items', item.id, {
    reviewer: null,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });
  notifyItemExpired(task, item, 'review', holder);
  return true;
}

function endExpiredTask(task, items, now) {
  if (!isTaskExpired(task, now)) return false;

  const holders = [];
  for (const item of items) {
    if (item.archived) continue;
    if (item.annotator && ANNOTATION_OPEN_STATUSES.includes(item.status)) {
      holders.push(item.annotator);
    }
    if (item.reviewer && REVIEW_OPEN_STATUSES.includes(item.status)) {
      holders.push(item.reviewer);
    }
  }

  if (!task.taskEndedNotifiedAt) {
    notifyTaskEnded(task, holders);
  }

  db.updateById('tasks', task.id, {
    status: 'ended',
    taskEndedNotifiedAt: task.taskEndedNotifiedAt || new Date(now).toISOString(),
  });
  return true;
}

function scanTimelinessReminders() {
  const now = Date.now();
  const tasks = db
    .getAll('tasks')
    .filter((task) => task.status === 'in_progress' && !task.archived);
  let affected = 0;

  for (const task of tasks) {
    const items = db.find('annotation-items', { taskId: task.id });

    if (endExpiredTask(task, items, now)) {
      affected += 1;
      continue;
    }

    for (const item of items) {
      if (releaseAnnotationItem(task, item, now)) affected += 1;
      if (releaseReviewItem(task, item, now)) affected += 1;
    }
  }

  return affected;
}

function startTimelinessReminderService(intervalMs = DEFAULT_SCAN_INTERVAL_MS) {
  if (timer) return timer;
  scanTimelinessReminders();
  timer = setInterval(() => {
    try {
      scanTimelinessReminders();
    } catch (err) {
      console.error('[TimelinessReminder] scan failed:', err.message);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  formatTime,
  scanTimelinessReminders,
  startTimelinessReminderService,
};

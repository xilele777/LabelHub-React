import dayjs from 'dayjs';
import { TaskStatus, type TaskItem } from '../types';

export type TaskTimelinessLevel =
  'unset' | 'not_started' | 'normal' | 'due_soon' | 'overdue' | 'closed';

export interface TaskTimelinessInfo {
  level: TaskTimelinessLevel;
  label: string;
  color: string;
  description: string;
}

export interface PhaseTimelinessFields {
  status: TaskStatus;
  archived: boolean;
  startsAt: string | null;
  dueAt: string | null;
  reminderHours: number;
}

export function getTaskTimeliness(
  task: Pick<TaskItem, 'status' | 'startsAt' | 'dueAt' | 'reminderHours' | 'archived'>,
): TaskTimelinessInfo {
  return getPhaseTimeliness(task);
}

export function getReviewTimeliness(
  task: Pick<
    TaskItem,
    'status' | 'startsAt' | 'dueAt' | 'reviewTimeoutHours' | 'reviewReminderHours' | 'archived'
  >,
): TaskTimelinessInfo {
  const taskWindow = getPhaseTimeliness({
    status: task.status,
    archived: task.archived,
    startsAt: task.startsAt,
    dueAt: task.dueAt,
    reminderHours: task.reviewReminderHours,
  });
  const timeoutHours = Number(task.reviewTimeoutHours ?? task.reviewReminderHours ?? 0);
  const timeoutText = formatHours(timeoutHours);

  if (taskWindow.level === 'closed') {
    return {
      ...taskWindow,
      description: `审核项：领取或分配后 ${timeoutText}；${taskWindow.description}`,
    };
  }

  return {
    ...taskWindow,
    label: timeoutHours > 0 ? `${timeoutText}` : '不限时',
    description:
      timeoutHours > 0
        ? `领取或分配后 ${timeoutText}；任务期限${taskWindow.description}`
        : `未限制单项审核时长；任务期限${taskWindow.description}`,
  };
}

export function getPhaseTimeliness(task: PhaseTimelinessFields): TaskTimelinessInfo {
  if (task.archived || task.status === TaskStatus.COMPLETED || isEndedWithoutFutureDeadline(task)) {
    return {
      level: 'closed',
      label: '已收口',
      color: 'default',
      description: task.dueAt
        ? `截止于 ${dayjs(task.dueAt).format('YYYY-MM-DD HH:mm')}`
        : '任务已完成或结束',
    };
  }

  if (!task.dueAt) {
    return {
      level: 'unset',
      label: '未设置',
      color: 'default',
      description: '未配置截止时间',
    };
  }

  const now = dayjs();
  const dueAt = dayjs(task.dueAt);
  const startsAt = task.startsAt ? dayjs(task.startsAt) : null;

  if (startsAt && now.isBefore(startsAt)) {
    return {
      level: 'not_started',
      label: '未开始',
      color: 'cyan',
      description: `计划 ${startsAt.format('YYYY-MM-DD HH:mm')} 开始`,
    };
  }

  if (now.isAfter(dueAt)) {
    return {
      level: 'overdue',
      label: '已逾期',
      color: 'error',
      description: `已逾期 ${formatDuration(now.diff(dueAt, 'minute'))}`,
    };
  }

  const remainingMinutes = dueAt.diff(now, 'minute');
  const reminderMinutes = Math.max(Number(task.reminderHours || 0), 0) * 60;
  if (reminderMinutes > 0 && remainingMinutes <= reminderMinutes) {
    return {
      level: 'due_soon',
      label: '即将到期',
      color: 'warning',
      description: `剩余 ${formatDuration(remainingMinutes)}`,
    };
  }

  return {
    level: 'normal',
    label: '正常',
    color: 'success',
    description: `剩余 ${formatDuration(remainingMinutes)}`,
  };
}

export function formatTaskTimeRange(task: Pick<TaskItem, 'startsAt' | 'dueAt'>) {
  const start = task.startsAt ? dayjs(task.startsAt).format('YYYY-MM-DD HH:mm') : '立即开始';
  const due = task.dueAt ? dayjs(task.dueAt).format('YYYY-MM-DD HH:mm') : '未设置截止';
  return `${start} - ${due}`;
}

export function formatReviewTimeRange(task: Pick<TaskItem, 'reviewStartsAt' | 'reviewDueAt'>) {
  const start = task.reviewStartsAt
    ? dayjs(task.reviewStartsAt).format('YYYY-MM-DD HH:mm')
    : '立即开始';
  const due = task.reviewDueAt ? dayjs(task.reviewDueAt).format('YYYY-MM-DD HH:mm') : '未设置截止';
  return `${start} - ${due}`;
}

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(Math.ceil(minutes), 0);
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const mins = safeMinutes % 60;

  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${mins}分钟`;
  return `${mins}分钟`;
}

function formatHours(hours: number) {
  const safeHours = Math.max(Number(hours || 0), 0);
  if (Number.isInteger(safeHours)) return `${safeHours}小时`;
  return `${Number(safeHours.toFixed(2))}小时`;
}

function isEndedWithoutFutureDeadline(task: PhaseTimelinessFields) {
  if (task.status !== TaskStatus.ENDED) return false;
  if (!task.dueAt) return true;
  return !dayjs(task.dueAt).isAfter(dayjs());
}

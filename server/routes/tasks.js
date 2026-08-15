/** 标注任务接口：任务 CRUD、状态流转和任务可见性控制。 */
const express = require('express');
const createCrudRouter = require('./crudFactory');
const db = require('../store/db');
const { requireAuth } = require('../middleware/auth');
const { TASK_TRANSITIONS, validateTransition } = require('../constants/statusMachine');
const { hasFutureDueAt } = require('../utils/itemTimeliness');
const { readEnum, readNumber, readString } = require('../utils/requestValidation');

const router = express.Router();
router.use(requireAuth);

const TASK_TYPES = [
  'image_classification',
  'object_detection',
  'semantic_segmentation',
  'text_ner',
];
const TASK_STATUSES = ['draft', 'pending', 'in_progress', 'completed', 'ended'];
const MAX_TIMEOUT_HOURS = 24 * 365;

function normalizeHours(value, fallback = 24) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(0, Math.min(normalized, MAX_TIMEOUT_HOURS));
}

function readOptionalIsoString(input, field) {
  if (!Object.prototype.hasOwnProperty.call(input, field)) {
    return { hasValue: false };
  }

  const value = input[field];
  if (value === null || value === '') {
    return { hasValue: true, value: null };
  }
  if (typeof value !== 'string') {
    return { error: `${field} must be an ISO date string or null` };
  }
  if (Number.isNaN(Date.parse(value))) {
    return { error: `${field} must be a valid ISO date string` };
  }
  return { hasValue: true, value };
}

function validateTaskPayload(input, { partial = false } = {}) {
  const normalized = { ...input };

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'name')) {
    const result = readString(normalized, 'name', {
      required: !partial,
      minLength: 1,
      maxLength: 100,
    });
    if (result.error) return result.error;
    if (result.value !== undefined) normalized.name = result.value;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'description')) {
    const result = readString(normalized, 'description', { maxLength: 1000 });
    if (result.error) return result.error;
    normalized.description = result.value || '';
  } else if (!partial) {
    normalized.description = '';
  }

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'type')) {
    const result = readEnum(normalized, 'type', TASK_TYPES, { required: !partial });
    if (result.error) return result.error;
    if (result.value !== undefined) normalized.type = result.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'owner')) {
    const result = readString(normalized, 'owner', {
      required: !partial,
      minLength: 1,
      maxLength: 64,
    });
    if (result.error) return result.error;
    if (result.value !== undefined) normalized.owner = result.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'templateId')) {
    const result = readString(normalized, 'templateId', {
      required: !partial,
      minLength: 1,
      maxLength: 80,
    });
    if (result.error) return result.error;
    if (result.value !== undefined) normalized.templateId = result.value;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'templateName')) {
    const result = readString(normalized, 'templateName', { maxLength: 100 });
    if (result.error) return result.error;
    normalized.templateName = result.value || null;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'instructions')) {
    const result = readString(normalized, 'instructions', { maxLength: 5000 });
    if (result.error) return result.error;
    normalized.instructions = result.value || '';
  } else if (!partial) {
    normalized.instructions = '';
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'status')) {
    const result = readEnum(normalized, 'status', TASK_STATUSES, { required: false });
    if (result.error) return result.error;
    normalized.status = result.value;
  }

  for (const field of ['startsAt', 'dueAt']) {
    const result = readOptionalIsoString(normalized, field);
    if (result.error) return result.error;
    if (result.hasValue) normalized[field] = result.value;
  }

  for (const field of [
    'annotationTimeoutHours',
    'reminderHours',
    'reviewTimeoutHours',
    'reviewReminderHours',
  ]) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      const result = readNumber(normalized, field, { min: 0, max: MAX_TIMEOUT_HOURS });
      if (result.error) return result.error;
      normalized[field] = result.value;
    }
  }

  return normalized;
}

function normalizeTimeliness(input) {
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(input, 'startsAt')) {
    normalized.startsAt = input.startsAt || null;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'dueAt')) {
    normalized.dueAt = input.dueAt || null;
    normalized.annotationDueSoonNotifiedAt = null;
    normalized.reviewDueSoonNotifiedAt = null;
    normalized.taskEndedNotifiedAt = null;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'annotationTimeoutHours')) {
    normalized.annotationTimeoutHours = normalizeHours(input.annotationTimeoutHours);
    normalized.reminderHours = normalized.annotationTimeoutHours;
  } else if (Object.prototype.hasOwnProperty.call(input, 'reminderHours')) {
    normalized.annotationTimeoutHours = normalizeHours(input.reminderHours);
    normalized.reminderHours = normalized.annotationTimeoutHours;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'reviewTimeoutHours')) {
    normalized.reviewTimeoutHours = normalizeHours(input.reviewTimeoutHours);
    normalized.reviewReminderHours = normalized.reviewTimeoutHours;
  } else if (Object.prototype.hasOwnProperty.call(input, 'reviewReminderHours')) {
    normalized.reviewTimeoutHours = normalizeHours(input.reviewReminderHours);
    normalized.reviewReminderHours = normalized.reviewTimeoutHours;
  }

  if (Object.keys(normalized).length > 0) {
    normalized.overdueStrategy = 'block_submit';
    normalized.reviewStartsAt = null;
    normalized.reviewDueAt = null;
    normalized.reviewOverdueStrategy = 'block_submit';
  }

  return normalized;
}

function hasTimelinessUpdate(updates) {
  return [
    'startsAt',
    'dueAt',
    'annotationTimeoutHours',
    'reminderHours',
    'reviewTimeoutHours',
    'reviewReminderHours',
  ].some((key) => Object.prototype.hasOwnProperty.call(updates, key));
}

function shouldReopenEndedTask(task, updates) {
  if (task.archived || task.status !== 'ended' || !hasTimelinessUpdate(updates)) {
    return false;
  }
  return hasFutureDueAt(task);
}

function validateEndedTaskReopen(existing, nextTask, updates) {
  if (
    existing.archived ||
    existing.status !== 'ended' ||
    updates.status ||
    !hasTimelinessUpdate(updates)
  ) {
    return null;
  }

  if (!hasFutureDueAt(nextTask)) {
    return 'Ended tasks can only reopen when the updated deadline is in the future';
  }

  return null;
}

function repairEndedTaskAfterDeadlineExtension(item) {
  if (
    item.archived ||
    item.status !== 'ended' ||
    item.taskEndedNotifiedAt ||
    !hasFutureDueAt(item)
  ) {
    return item;
  }

  const repaired = db.updateById('tasks', item.id, {
    status: 'in_progress',
    taskEndedNotifiedAt: null,
  });
  return repaired || { ...item, status: 'in_progress', taskEndedNotifiedAt: null };
}

function validateTimeliness(task) {
  const start = task.startsAt;
  const due = task.dueAt;

  if (start && Number.isNaN(Date.parse(start))) {
    return 'startsAt must be a valid ISO date string';
  }
  if (due && Number.isNaN(Date.parse(due))) {
    return 'dueAt must be a valid ISO date string';
  }
  if (start && due && new Date(start).getTime() >= new Date(due).getTime()) {
    return 'dueAt must be later than startsAt';
  }
  if (task.status === 'in_progress' && due && new Date(due).getTime() <= Date.now()) {
    return 'Cannot publish a task whose deadline has already passed';
  }

  return null;
}

function validateTemplateBinding(task) {
  if (!task.templateId) return null;

  const tpl = db.getById('templates', task.templateId);
  if (!tpl) {
    return 'templateId does not reference an existing template';
  }
  if (tpl.type !== task.type) {
    return 'task type must match template type';
  }

  return tpl;
}

const crud = createCrudRouter('tasks', {
  beforeCreate(item, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owner can create tasks';
    }

    const validated = validateTaskPayload(item);
    if (typeof validated === 'string') {
      return validated;
    }
    item = validated;

    const template = validateTemplateBinding(item);
    if (typeof template === 'string') {
      return template;
    }
    if (template && !item.templateName) {
      item.templateName = template.name;
    }

    if (item.archived === undefined) {
      item.archived = false;
    }

    Object.assign(item, {
      startsAt: item.startsAt || null,
      dueAt: item.dueAt || null,
      annotationTimeoutHours: normalizeHours(item.annotationTimeoutHours ?? item.reminderHours),
      reviewTimeoutHours: normalizeHours(item.reviewTimeoutHours ?? item.reviewReminderHours),
      reminderHours: normalizeHours(item.annotationTimeoutHours ?? item.reminderHours),
      overdueStrategy: 'block_submit',
      reviewStartsAt: null,
      reviewDueAt: null,
      reviewReminderHours: normalizeHours(item.reviewTimeoutHours ?? item.reviewReminderHours),
      reviewOverdueStrategy: 'block_submit',
      taskEndedNotifiedAt: null,
    });

    const timelinessError = validateTimeliness(item);
    if (timelinessError) return timelinessError;
    return item;
  },

  beforeUpdate(existing, updates, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owner can update tasks';
    }

    const validated = validateTaskPayload(updates, { partial: true });
    if (typeof validated === 'string') {
      return validated;
    }
    Object.keys(updates).forEach((key) => delete updates[key]);
    Object.assign(updates, validated);

    if (updates.templateId || updates.type) {
      const template = validateTemplateBinding({ ...existing, ...updates });
      if (typeof template === 'string') {
        return template;
      }
      if (updates.templateId && template) {
        updates.templateName = template.name;
      }
    }

    const normalizedTimeliness = normalizeTimeliness(updates);
    const nextTask = { ...existing, ...updates, ...normalizedTimeliness };
    const reopenError = validateEndedTaskReopen(existing, nextTask, updates);
    if (reopenError) return reopenError;

    const shouldReopen = shouldReopenEndedTask(nextTask, updates);

    if (updates.status && updates.status !== existing.status && !shouldReopen) {
      const { valid, reason } = validateTransition(
        TASK_TRANSITIONS,
        existing.status,
        updates.status,
      );
      if (!valid) {
        return reason;
      }
    }

    if (shouldReopen) {
      nextTask.status = 'in_progress';
      normalizedTimeliness.status = 'in_progress';
      normalizedTimeliness.taskEndedNotifiedAt = null;
    }

    if (
      updates.status === 'ended' &&
      existing.status !== 'ended' &&
      !normalizedTimeliness.taskEndedNotifiedAt
    ) {
      normalizedTimeliness.taskEndedNotifiedAt = new Date().toISOString();
    }

    const timelinessError = validateTimeliness(nextTask);
    if (timelinessError) return timelinessError;

    if (
      normalizedTimeliness.annotationDueSoonNotifiedAt === null &&
      nextTask.dueAt === existing.dueAt
    ) {
      delete normalizedTimeliness.annotationDueSoonNotifiedAt;
      delete normalizedTimeliness.reviewDueSoonNotifiedAt;
      delete normalizedTimeliness.taskEndedNotifiedAt;
    }

    return Object.keys(normalizedTimeliness).length > 0 ? normalizedTimeliness : undefined;
  },

  beforeDelete(_existing, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owner can delete tasks';
    }
    return undefined;
  },

  afterRead(item, _req) {
    item = repairEndedTaskAfterDeadlineExtension(item);
    if (item.archived === undefined) item.archived = false;
    if (item.archivedAt === undefined) item.archivedAt = null;
    if (item.startsAt === undefined) item.startsAt = null;
    if (item.dueAt === undefined) item.dueAt = null;
    if (item.reminderHours === undefined) item.reminderHours = 24;
    if (item.overdueStrategy === undefined) item.overdueStrategy = 'block_submit';
    if (item.reviewStartsAt === undefined) item.reviewStartsAt = null;
    if (item.reviewDueAt === undefined) item.reviewDueAt = null;
    if (item.reviewReminderHours === undefined) item.reviewReminderHours = 24;
    if (item.reviewOverdueStrategy === undefined) item.reviewOverdueStrategy = 'block_submit';
    if (item.annotationTimeoutHours === undefined)
      item.annotationTimeoutHours = item.reminderHours ?? 24;
    if (item.reviewTimeoutHours === undefined)
      item.reviewTimeoutHours = item.reviewReminderHours ?? 24;
    if (item.taskEndedNotifiedAt === undefined) item.taskEndedNotifiedAt = null;
    return item;
  },

  filterList(items, req) {
    const archivedParam = req.query.archived;
    let result;
    if (archivedParam === 'true' || archivedParam === '1') {
      result = items.filter((item) => item.archived === true);
    } else {
      result = items.filter((item) => !item.archived);
    }

    // 服务端筛选（配合 _page/_limit 支撑列表页服务端分页）
    const status = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
    if (status) {
      result = result.filter((item) => item.status === status);
    }

    const keywordParam = Array.isArray(req.query.keyword)
      ? req.query.keyword[0]
      : req.query.keyword;
    const keyword = typeof keywordParam === 'string' ? keywordParam.trim().toLowerCase() : '';
    if (keyword) {
      result = result.filter((item) =>
        String(item.name || '')
          .toLowerCase()
          .includes(keyword),
      );
    }

    return result;
  },
});

router.use(crud);

router.put('/:id/archive', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.fail('Only owner can archive tasks', 403);
  }
  const existing = db.getById('tasks', req.params.id);
  if (!existing) {
    return res.notFound('Task not found');
  }
  if (existing.status !== 'completed' && existing.status !== 'ended') {
    return res.fail('Only completed or ended tasks can be archived');
  }
  if (existing.archived) {
    return res.fail('Task is already archived');
  }
  const now = new Date().toISOString();
  const updated = db.updateById('tasks', req.params.id, { archived: true, archivedAt: now });
  res.success(updated, 'Archived');
});

router.put('/:id/unarchive', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.fail('Only owner can unarchive tasks', 403);
  }
  const existing = db.getById('tasks', req.params.id);
  if (!existing) {
    return res.notFound('Task not found');
  }
  if (!existing.archived) {
    return res.fail('Task is not archived');
  }
  const updated = db.updateById('tasks', req.params.id, { archived: false, archivedAt: null });
  res.success(updated, 'Unarchived');
});

module.exports = router;

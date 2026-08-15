/**
 * 标注项接口：领取、保存、提交、审核、驳回及批量导入。
 * 这里集中处理状态迁移、权限、锁和时效校验。
 */
const express = require('express');
const createCrudRouter = require('./crudFactory');
const db = require('../store/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { body } = require('../middleware/validate');
const {
  submitAnnotationSchema,
  saveDraftSchema,
  approveSchema,
  rejectSchema,
} = require('../utils/validationSchemas');
const {
  DATA_ITEM_STATUS,
  DATA_ITEM_TRANSITIONS,
  validateTransition,
} = require('../constants/statusMachine');
const { runAIReview } = require('../services/aiReviewEngine');
const { isPlainObject, readArray, readString, readNumber } = require('../utils/requestValidation');
const {
  notifyReviewApproved,
  notifyReviewRejected,
  notifyAnnotationSubmitted,
  notifyAnnotationResubmitted,
  notifyAIReviewComplete,
} = require('../services/notificationService');
const itemTimeliness = require('../utils/itemTimeliness');
const {
  annotationSubmitLimiter,
  reviewActionLimiter,
  batchImportLimiter,
} = require('../middleware/apiRateLimit');

const router = express.Router();
router.use(requireAuth);

// 锁最长保留 30 分钟，过期后由请求触发清理。
const LOCK_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_BATCH_IMPORT_ITEMS = Number(process.env.MAX_BATCH_IMPORT_ITEMS || 1000);

/**
 * 定期清理过期锁，单次请求最多每 60 秒执行一次。
 */
let lastCleanup = 0;
function cleanupExpiredLocks(req, res, next) {
  const now = Date.now();
  if (now - lastCleanup > 60000) {
    lastCleanup = now;
    db.cleanExpiredLocks(LOCK_TIMEOUT_MS);
  }
  next();
}
router.use(cleanupExpiredLocks);

router.post('/batch-import', requireRole('owner'), batchImportLimiter, (req, res) => {
  const taskIdResult = readString(req.body, 'taskId', {
    required: true,
    minLength: 1,
    maxLength: 80,
  });
  if (taskIdResult.error) {
    return res.fail(taskIdResult.error);
  }

  const itemsResult = readArray(req.body, 'items', {
    required: true,
    minLength: 1,
    maxLength: MAX_BATCH_IMPORT_ITEMS,
  });
  if (itemsResult.error) {
    return res.fail(itemsResult.error);
  }

  const taskId = taskIdResult.value;
  const items = itemsResult.value;
  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('Task not found');
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isPlainObject(item)) {
      return res.fail(`items[${index}] must be an object`);
    }
    if (item.rawData !== undefined && !isPlainObject(item.rawData)) {
      return res.fail(`items[${index}].rawData must be an object`);
    }
  }

  const now = new Date().toISOString();
  const created = db.transaction(() => {
    const insertedItems = [];
    for (const item of items) {
      insertedItems.push(
        db.insert('annotation-items', {
          id: `ai${String(Date.now()).slice(-3)}${Math.random().toString(36).slice(2, 8)}`,
          taskId,
          rawData: item.rawData || {},
          status: 'pending',
          annotator: null,
          reviewer: null,
          annotationData: null,
          submittedAt: null,
          reviewedAt: null,
          rejectReason: null,
          auditHistory: [],
          createdAt: now,
          version: 1,
          lockedBy: null,
          lockedAt: null,
        }),
      );
    }
    return insertedItems;
  });

  return res.success(
    { imported: created.length, items: created },
    `Imported ${created.length} item(s)`,
    201,
  );
});

// 权限辅助方法。

/**
 * 只有被明确分配的标注员才拥有该标注项，未分配项必须先领取。
 */
function isAnnotatorOwner(item, user) {
  if (user.role !== 'annotator') return false;
  // 标注员只能操作分配给自己的项。
  return item.annotator === user.username;
}

/**
 * 判断审核员能否审核该项，审核员不能审核自己的标注。
 */
function canReviewerApprove(item, user) {
  if (user.role !== 'reviewer') return false;
  // 避免自审。
  if (item.annotator === user.username) return false;
  // 可审核分配给自己的项，或未指定审核员的待审项。
  return item.reviewer === null || item.reviewer === user.username;
}

function isTaskStarted(task) {
  return itemTimeliness.isTaskStarted(task);
}

function isReviewStarted(task) {
  return itemTimeliness.isTaskStarted(task) && !itemTimeliness.isTaskExpired(task);
}

function canTaskExposeWorkItems(task) {
  return itemTimeliness.canTaskExposeWorkItems(task);
}

function validateTaskSubmissionWindow(task, item) {
  if (!task) return 'Task not found';
  if (!canTaskExposeWorkItems(task)) {
    if (!itemTimeliness.isTaskStarted(task)) return 'Task has not started yet';
    if (itemTimeliness.isTaskExpired(task)) return 'Task has expired';
    return 'Task is not open for annotation';
  }
  if (item && itemTimeliness.isItemExpired(task, item, 'annotation')) {
    return 'Annotation item is overdue';
  }
  return null;
}

function validateReviewWindow(task, item) {
  if (!task) return 'Task not found';
  if (!canTaskExposeWorkItems(task)) {
    if (!itemTimeliness.isTaskStarted(task)) return 'Task has not started yet';
    if (itemTimeliness.isTaskExpired(task)) return 'Task has expired';
    return 'Task is not open for review';
  }
  if (item && itemTimeliness.isItemExpired(task, item, 'review')) {
    return 'Review item is overdue';
  }
  return null;
}

function returnAnnotationItemToPool(item, operator, reason) {
  if (!item.annotator) return item;
  const now = new Date().toISOString();
  const historyRecord = {
    id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    operator,
    actionType: 'release_annotation_due_overdue',
    fromStatus: item.status,
    toStatus: item.status,
    reason,
    timestamp: now,
  };
  return db.updateById('annotation-items', item.id, {
    annotator: null,
    lockedBy: null,
    lockedAt: null,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });
}

function returnReviewItemToPool(item, operator, reason) {
  if (!item.reviewer) return item;
  const now = new Date().toISOString();
  const historyRecord = {
    id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
    operator,
    actionType: 'release_review_due_overdue',
    fromStatus: item.status,
    toStatus: item.status,
    reason,
    timestamp: now,
  };
  return db.updateById('annotation-items', item.id, {
    reviewer: null,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });
}

const OVERDUE_POOL_ACTIONS = {
  annotation: 'release_annotation_due_overdue',
  review: 'release_review_due_overdue',
};

function hasAuditAction(item, actionType) {
  return (
    Array.isArray(item.auditHistory) &&
    item.auditHistory.some((record) => record?.actionType === actionType)
  );
}

function wasReturnedToPoolByOverdue(item, phase) {
  if (!hasAuditAction(item, OVERDUE_POOL_ACTIONS[phase])) return false;
  const task = db.getById('tasks', item.taskId);
  return itemTimeliness.isItemExpired(task, item, phase);
}

// 特殊路由必须先于 CRUD 注册，否则会被 /:id 截获。

/**
 * GET /annotation-items/available
 * 查询当前用户可以领取的未分配标注项。
 * 支持按任务和状态筛选，默认只返回 pending 项。
 */
router.get('/available', (req, res) => {
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can claim annotation items', 403);
  }

  const taskId = req.query.taskId;
  const statuses = req.query.status
    ? String(req.query.status).split(',')
    : ['pending', 'draft', 'rejected'];

  let items = db.getAll('annotation-items');

  // 只返回未分配且状态符合要求的项。
  items = items.filter(
    (item) =>
      item.annotator === null &&
      !item.archived &&
      !wasReturnedToPoolByOverdue(item, 'annotation') &&
      statuses.includes(item.status),
  );

  // 任务未开始或已结束时不暴露标注项。
  items = items.filter((item) => {
    const task = db.getById('tasks', item.taskId);
    return canTaskExposeWorkItems(task);
  });

  // 按任务筛选。
  if (taskId) {
    items = items.filter((item) => item.taskId === taskId);
  }

  // 列表只返回领取页面需要的字段。
  items = items.map((item) => ({
    id: item.id,
    taskId: item.taskId,
    status: item.status,
    annotator: item.annotator,
    rawData: item.rawData,
    rawDataPreview: item.rawData
      ? item.rawData.text
        ? String(item.rawData.text).slice(0, 80)
        : item.rawData.imageUrl
          ? String(item.rawData.imageUrl).slice(0, 80)
          : JSON.stringify(item.rawData).slice(0, 80)
      : '',
  }));

  res.success({ items, total: items.length });
});

router.get('/review-available', (req, res) => {
  if (req.currentUser.role !== 'reviewer') {
    return res.fail('Only reviewers can claim review items', 403);
  }

  const taskId = req.query.taskId;
  const statuses = req.query.status
    ? String(req.query.status).split(',')
    : ['submitted', 'pending_review'];

  let items = db
    .getAll('annotation-items')
    .filter(
      (item) =>
        item.reviewer === null &&
        !item.archived &&
        !wasReturnedToPoolByOverdue(item, 'review') &&
        statuses.includes(item.status),
    );

  items = items.filter((item) => {
    const task = db.getById('tasks', item.taskId);
    return canTaskExposeWorkItems(task);
  });

  if (taskId) {
    items = items.filter((item) => item.taskId === taskId);
  }

  const simplified = items.map((item) => ({
    id: item.id,
    taskId: item.taskId,
    status: item.status,
    annotator: item.annotator,
    reviewer: item.reviewer,
    submittedAt: item.submittedAt,
    rawData: item.rawData,
    rawDataPreview: item.rawData
      ? item.rawData.text
        ? String(item.rawData.text).slice(0, 80)
        : item.rawData.imageUrl
          ? String(item.rawData.imageUrl).slice(0, 80)
          : JSON.stringify(item.rawData).slice(0, 80)
      : '',
  }));

  res.success({ items: simplified, total: simplified.length });
});

// 标注项通用 CRUD，并附加权限和状态迁移校验。
router.put('/batch-claim-assignment', (req, res) => {
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can claim annotation items', 403);
  }

  const ids = Array.isArray(req.body?.ids)
    ? [
        ...new Set(
          req.body.ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()),
        ),
      ]
    : [];

  if (ids.length === 0) {
    return res.fail('Please select annotation items to claim');
  }

  const now = new Date().toISOString();
  const username = req.currentUser.username;
  const claimed = [];
  const failed = [];

  ids.forEach((id, index) => {
    const item = db.getById('annotation-items', id);
    if (!item) {
      failed.push({ id, reason: 'Annotation item not found' });
      return;
    }
    if (item.annotator !== null) {
      failed.push({ id, reason: 'Annotation item has already been assigned' });
      return;
    }
    if (wasReturnedToPoolByOverdue(item, 'annotation')) {
      failed.push({ id, reason: 'Annotation item is overdue and cannot be claimed' });
      return;
    }
    if (!['pending', 'draft', 'rejected'].includes(item.status)) {
      failed.push({ id, reason: 'Current status cannot be claimed for annotation' });
      return;
    }
    if (item.archived) {
      failed.push({ id, reason: 'Archived annotation items cannot be claimed' });
      return;
    }

    const task = db.getById('tasks', item.taskId);
    if (!canTaskExposeWorkItems(task)) {
      failed.push({ id, reason: 'Task is not open for annotation' });
      return;
    }

    const historyRecord = {
      id: `h${Date.now()}${index}`,
      operator: username,
      actionType: 'claim_assignment',
      fromStatus: item.status,
      toStatus: item.status,
      reason: `Annotator ${username} batch claimed`,
      timestamp: now,
    };

    const updated = db.updateById('annotation-items', item.id, {
      annotator: username,
      auditHistory: [...(item.auditHistory || []), historyRecord],
    });
    claimed.push(updated);
  });

  res.success(
    {
      claimed,
      failed,
      claimedCount: claimed.length,
      failedCount: failed.length,
    },
    claimed.length > 0
      ? `Claimed ${claimed.length} annotation item(s)`
      : 'No annotation items were claimed',
  );
});

router.put('/batch-claim-review', (req, res) => {
  if (req.currentUser.role !== 'reviewer') {
    return res.fail('Only reviewers can claim review items', 403);
  }

  const ids = Array.isArray(req.body?.ids)
    ? [
        ...new Set(
          req.body.ids.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()),
        ),
      ]
    : [];

  if (ids.length === 0) {
    return res.fail('Please select review items to claim');
  }

  const now = new Date().toISOString();
  const username = req.currentUser.username;
  const claimed = [];
  const failed = [];

  ids.forEach((id, index) => {
    const item = db.getById('annotation-items', id);
    if (!item) {
      failed.push({ id, reason: 'Review item not found' });
      return;
    }
    if (item.reviewer !== null) {
      failed.push({ id, reason: 'Review item has already been assigned' });
      return;
    }
    if (wasReturnedToPoolByOverdue(item, 'review')) {
      failed.push({ id, reason: 'Review item is overdue and cannot be claimed' });
      return;
    }
    if (!['submitted', 'pending_review'].includes(item.status)) {
      failed.push({ id, reason: 'Current status cannot be claimed for review' });
      return;
    }
    if (item.archived) {
      failed.push({ id, reason: 'Archived annotation items cannot be claimed for review' });
      return;
    }

    const task = db.getById('tasks', item.taskId);
    const timeWindowError = validateReviewWindow(task, item);
    if (timeWindowError) {
      failed.push({ id, reason: timeWindowError });
      return;
    }

    const historyRecord = {
      id: `h${Date.now()}${index}`,
      operator: username,
      actionType: 'claim_review',
      fromStatus: item.status,
      toStatus: item.status,
      reason: `Reviewer ${username} batch claimed`,
      timestamp: now,
    };

    const updated = db.updateById('annotation-items', item.id, {
      reviewer: username,
      auditHistory: [...(item.auditHistory || []), historyRecord],
    });
    claimed.push(updated);
  });

  res.success(
    {
      claimed,
      failed,
      claimedCount: claimed.length,
      failedCount: failed.length,
    },
    claimed.length > 0
      ? `Claimed ${claimed.length} review item(s)`
      : 'No review items were claimed',
  );
});

const crud = createCrudRouter('annotation-items', {
  // 标注员只看自己的项，审核员只看负责的待审项，负责人可以查看全部。
  filterList(items, req) {
    // 默认排除归档项，明确请求 archived=true 时才查看历史数据。
    const showArchived = req.query.archived === 'true';
    let filtered = items;
    if (!showArchived) {
      filtered = items.filter((item) => !item.archived);
    } else {
      // 归档模式只显示已归档项。
      filtered = items.filter((item) => item.archived);
    }

    // 非归档模式只显示当前开放任务中的项，归档模式保留历史审核数据。
    if (!showArchived) {
      filtered = filtered.filter((item) => {
        const task = db.getById('tasks', item.taskId);
        return canTaskExposeWorkItems(task);
      });
    }

    const role = req.currentUser?.role;
    if (role === 'owner') return filtered;
    if (role === 'annotator') {
      if (showArchived) {
        return filtered.filter((item) => item.annotator === req.currentUser.username);
      }
      // 标注员只能查看明确分配给自己的项，未分配项需先领取。
      return filtered.filter((item) => {
        const task = db.getById('tasks', item.taskId);
        return (
          item.annotator === req.currentUser.username &&
          !itemTimeliness.isItemExpired(task, item, 'annotation')
        );
      });
    }
    if (role === 'reviewer') {
      if (showArchived) {
        return filtered.filter((item) => item.reviewer === req.currentUser.username);
      }
      // 审核员只能查看分配或领取给自己的待审项。
      return filtered.filter((item) => {
        const task = db.getById('tasks', item.taskId);
        return (
          item.reviewer === req.currentUser.username &&
          !itemTimeliness.isItemExpired(task, item, 'review')
        );
      });
    }
    return filtered;
  },
  // 兼容旧种子数据，确保返回结构符合前端约定。
  afterRead(item, _req) {
    if (item.lockedBy === undefined) item.lockedBy = null;
    if (item.lockedAt === undefined) item.lockedAt = null;
    if (item.version === undefined) item.version = 1;
    return item;
  },
  beforeCreate(item, req) {
    // 只有负责人可以直接创建标注项。
    if (req.currentUser.role !== 'owner') {
      return 'Only owners can create annotation items';
    }
    // 新建项补齐锁字段。
    if (item.lockedBy === undefined) item.lockedBy = null;
    if (item.lockedAt === undefined) item.lockedAt = null;
    if (item.version === undefined) item.version = 1;
    return item;
  },
  beforeUpdate(existing, updates, req) {
    // 通用 PUT 仅允许标注员修改自己的项，审核员和负责人使用专用操作接口。
    const role = req.currentUser.role;
    if (role === 'annotator') {
      if (!isAnnotatorOwner(existing, req.currentUser)) {
        return 'Annotators can only update their own annotation items';
      }
    } else {
      return 'Only annotators can update annotation data';
    }

    // 修改状态时必须通过状态机校验。
    if (updates.status && updates.status !== existing.status) {
      const { valid, reason } = validateTransition(
        DATA_ITEM_TRANSITIONS,
        existing.status,
        updates.status,
      );
      if (!valid) {
        return reason;
      }
    }

    // 标注项更新使用版本号做乐观锁校验。
    if (
      updates.version !== undefined &&
      updates.version !== null &&
      existing.version !== updates.version
    ) {
      return `Version conflict: current version is ${existing.version}, submitted version is ${updates.version}`;
    }

    return undefined;
  },
  beforeDelete(existing, req) {
    // 只有负责人可以删除标注项。
    if (req.currentUser.role !== 'owner') {
      return 'Only owners can delete annotation items';
    }
    return undefined;
  },
});
router.use(crud);

/**
 * PUT /annotation-items/:id/save-draft
 * 请求体：{ annotationData }
 * 保存草稿并将状态设为 draft；未分配项允许在保存时自动领取。
 */
router.put('/:id/save-draft', body(saveDraftSchema), annotationSubmitLimiter, (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 仅标注员可以保存草稿。
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can save drafts', 403);
  }
  // 可以操作自己的项，也可以自动领取未分配项。
  if (item.annotator !== null && !isAnnotatorOwner(item, req.currentUser)) {
    return res.fail('Annotators can only operate on their own data', 403);
  }

  // 校验当前状态是否允许进入 draft。
  const { valid, reason } = validateTransition(
    DATA_ITEM_TRANSITIONS,
    item.status,
    DATA_ITEM_STATUS.DRAFT,
  );
  if (!valid) {
    return res.fail(reason);
  }

  const task = db.getById('tasks', item.taskId);
  const timeWindowError = validateTaskSubmissionWindow(task, item);
  if (timeWindowError) {
    const returnedItem = returnAnnotationItemToPool(
      item,
      req.currentUser?.username || 'system',
      timeWindowError,
    );
    return res.fail(timeWindowError, 403, {
      returnedToPool: Boolean(item.annotator),
      item: returnedItem,
    });
  }

  const now = new Date().toISOString();
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: req.currentUser?.username || 'unknown',
    actionType: 'save_draft',
    fromStatus: item.status,
    toStatus: 'draft',
    reason: null,
    timestamp: now,
  };

  // 校验版本号，避免覆盖他人的最新修改。
  const clientVersion = req.body.version;
  if (clientVersion !== undefined && clientVersion !== null && item.version !== clientVersion) {
    return res.fail(
      `Version conflict: current version is ${item.version}, submitted version is ${clientVersion}`,
      409,
      { currentVersion: item.version, serverItem: item },
    );
  }

  const updated = db.updateById('annotation-items', item.id, {
    status: 'draft',
    annotationData: req.body.annotationData || item.annotationData,
    annotator: req.currentUser?.username || item.annotator,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  res.success(updated, 'Draft saved');
});

/**
 * 执行服务端规则预审、保存结果并推进状态，供提交和重提流程复用。
 */
function executeAndPersistAIReview(item) {
  // 读取关联模板。
  const task = db.getById('tasks', item.taskId);
  const templateId = task?.templateId;
  const template = templateId ? db.getById('templates', templateId) : null;

  if (!template || !template.fields || template.fields.length === 0) {
    // 模板缺失或没有字段时跳过预审。
    return null;
  }

  // 在服务端执行规则引擎，避免客户端篡改预审结果。
  const aiResult = runAIReview({
    template,
    rawData: item.rawData || {},
    annotationResult: item.annotationData || {},
    dataItemId: item.id,
    taskId: item.taskId,
    templateId: templateId,
  });

  // 保存预审结果。
  const now = new Date().toISOString();
  const reviewRecord = {
    id: aiResult.id,
    dataItemId: item.id,
    taskId: item.taskId,
    templateId: templateId,
    reviewStatus: aiResult.reviewStatus,
    score: aiResult.score,
    summary: aiResult.summary,
    matchedRules: aiResult.matchedRules,
    fieldWarnings: aiResult.fieldWarnings,
    suggestions: aiResult.suggestions,
    reviewedAt: now,
    modelVersion: aiResult.modelVersion,
  };
  db.insert('reviews', reviewRecord);

  // 规则预审同步完成，submitted 直接进入待人工审核。
  const historyRecords = [
    {
      id: `h${Date.now()}a`,
      operator: 'Rule Engine',
      actionType: 'ai_review_complete',
      fromStatus: item.status,
      toStatus: 'pending_review',
      reason: null,
      timestamp: now,
    },
    {
      id: `h${Date.now()}b`,
      operator: 'System',
      actionType: 'assign_reviewer',
      fromStatus: 'pending_review',
      toStatus: 'pending_review',
      reason: null,
      timestamp: now,
    },
  ];

  const updatedItem = db.updateById('annotation-items', item.id, {
    status: 'pending_review',
    auditHistory: [...(item.auditHistory || []), ...historyRecords],
  });

  return { reviewRecord, updatedItem };
}

/**
 * PUT /annotation-items/:id/submit
 * 请求体：{ annotationData }
 * 提交标注，触发服务端规则预审，并推进到 pending_review。
 */
router.put('/:id/submit', body(submitAnnotationSchema), annotationSubmitLimiter, (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 校验标注数据。
  if (
    req.body.annotationData !== undefined &&
    req.body.annotationData !== null &&
    !isPlainObject(req.body.annotationData)
  ) {
    return res.fail('annotationData must be an object');
  }

  // 仅标注员可以提交。
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can submit annotations', 403);
  }
  // 可以提交自己的项，或在提交时自动领取未分配项。
  if (item.annotator !== null && !isAnnotatorOwner(item, req.currentUser)) {
    return res.fail('Annotators can only operate on their own data', 403);
  }

  // 校验当前状态是否允许提交。
  const { valid, reason } = validateTransition(
    DATA_ITEM_TRANSITIONS,
    item.status,
    DATA_ITEM_STATUS.SUBMITTED,
  );
  if (!valid) {
    return res.fail(reason);
  }

  const task = db.getById('tasks', item.taskId);
  const timeWindowError = validateTaskSubmissionWindow(task, item);
  if (timeWindowError) {
    const returnedItem = returnAnnotationItemToPool(
      item,
      req.currentUser?.username || 'system',
      timeWindowError,
    );
    return res.fail(timeWindowError, 403, {
      returnedToPool: Boolean(item.annotator),
      item: returnedItem,
    });
  }

  const now = new Date().toISOString();
  const annotationData = req.body.annotationData || item.annotationData;
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: req.currentUser?.username || 'unknown',
    actionType: 'submit',
    fromStatus: item.status,
    toStatus: 'submitted',
    reason: null,
    timestamp: now,
  };

  // 校验版本号，避免并发提交覆盖结果。
  const clientVersion = req.body.version;
  if (clientVersion !== undefined && clientVersion !== null && item.version !== clientVersion) {
    return res.fail(
      `Version conflict: current version is ${item.version}, submitted version is ${clientVersion}`,
      409,
      { currentVersion: item.version, serverItem: item },
    );
  }

  // 第一步：保存标注并进入 submitted。
  const submittedItem = db.updateById('annotation-items', item.id, {
    status: 'submitted',
    annotationData,
    annotator: req.currentUser?.username || item.annotator,
    submittedAt: now,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  // 第二步：执行服务端规则预审。
  const aiResult = executeAndPersistAIReview(submittedItem);

  // 通知可处理该项的审核员。
  notifyAnnotationSubmitted(submittedItem, req.currentUser);

  if (aiResult) {
    // 预审完成后补发带结果的通知。
    notifyAIReviewComplete(aiResult.updatedItem, aiResult.reviewRecord);

    res.success(
      {
        item: aiResult.updatedItem,
        review: aiResult.reviewRecord,
      },
      'Annotation submitted and rule review completed',
    );
  } else {
    // 模板缺失时保留 submitted，等待后续人工处理。
    res.success(
      submittedItem,
      'Annotation submitted; rule review skipped because template was not found',
    );
  }
});

/**
 * PUT /annotation-items/:id/approve
 * 请求体：{ reason? }
 * 审核通过并将状态设为 reviewed。
 */
router.put('/:id/approve', body(approveSchema), reviewActionLimiter, (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 理由可选，仅做长度和类型校验。
  if (req.body.reason !== undefined && req.body.reason !== null) {
    const reasonResult = readString(req.body, 'reason', { maxLength: 1000 });
    if (reasonResult.error) {
      return res.fail(reasonResult.error);
    }
  }

  // 仅审核员可以操作，且不能审核自己的标注。
  if (!canReviewerApprove(item, req.currentUser)) {
    if (req.currentUser.role === 'annotator') {
      return res.fail('Annotators cannot review annotations', 403);
    }
    if (req.currentUser.role === 'owner') {
      return res.fail('Owners cannot review annotations', 403);
    }
    // 拒绝自审。
    return res.fail('Reviewers cannot review their own annotations', 403);
  }

  // 校验当前状态是否允许通过。
  const { valid, reason } = validateTransition(
    DATA_ITEM_TRANSITIONS,
    item.status,
    DATA_ITEM_STATUS.REVIEWED,
  );
  if (!valid) {
    return res.fail(reason);
  }

  const task = db.getById('tasks', item.taskId);
  const timeWindowError = validateReviewWindow(task, item);
  if (timeWindowError) {
    const returnedItem = returnReviewItemToPool(
      item,
      req.currentUser?.username || 'system',
      timeWindowError,
    );
    return res.fail(timeWindowError, 403, {
      returnedToPool: Boolean(item.reviewer),
      item: returnedItem,
    });
  }

  const now = new Date().toISOString();
  const historyRecords = [
    {
      id: `h${Date.now()}a`,
      operator: req.currentUser?.username || 'unknown',
      actionType: 'approve',
      fromStatus: item.status,
      toStatus: 'reviewed',
      reason: req.body.reason || null,
      timestamp: now,
    },
    {
      id: `h${Date.now()}b`,
      operator: req.currentUser?.username || 'unknown',
      actionType: 'archive',
      fromStatus: 'reviewed',
      toStatus: 'reviewed',
      reason: 'Review approved; automatically archived',
      timestamp: now,
    },
  ];

  const updated = db.updateById('annotation-items', item.id, {
    status: 'reviewed',
    reviewer: req.currentUser?.username || item.reviewer,
    reviewedAt: now,
    archived: true,
    archivedAt: now,
    auditHistory: [...(item.auditHistory || []), ...historyRecords],
  });

  // 通知标注员审核结果。
  notifyReviewApproved(updated, req.currentUser);

  res.success(updated, 'Review approved and archived');
});

/**
 * PUT /annotation-items/:id/reject
 * 请求体：{ reason }
 * 审核驳回并将状态设为 rejected。
 */
router.put('/:id/reject', body(rejectSchema), reviewActionLimiter, (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 驳回理由必填。
  const reasonResult = readString(req.body, 'reason', {
    required: true,
    minLength: 1,
    maxLength: 1000,
  });
  if (reasonResult.error) {
    return res.fail(reasonResult.error);
  }

  // 仅审核员可以操作，且不能审核自己的标注。
  if (!canReviewerApprove(item, req.currentUser)) {
    if (req.currentUser.role === 'annotator') {
      return res.fail('Annotators cannot review annotations', 403);
    }
    if (req.currentUser.role === 'owner') {
      return res.fail('Owners cannot review annotations', 403);
    }
    // 拒绝自审。
    return res.fail('Reviewers cannot review their own annotations', 403);
  }

  // 校验当前状态是否允许驳回。
  const { valid, reason } = validateTransition(
    DATA_ITEM_TRANSITIONS,
    item.status,
    DATA_ITEM_STATUS.REJECTED,
  );
  if (!valid) {
    return res.fail(reason);
  }

  const rejectReason = reasonResult.value;

  const task = db.getById('tasks', item.taskId);
  const timeWindowError = validateReviewWindow(task, item);
  if (timeWindowError) {
    const returnedItem = returnReviewItemToPool(
      item,
      req.currentUser?.username || 'system',
      timeWindowError,
    );
    return res.fail(timeWindowError, 403, {
      returnedToPool: Boolean(item.reviewer),
      item: returnedItem,
    });
  }

  const now = new Date().toISOString();
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: req.currentUser?.username || 'unknown',
    actionType: 'reject',
    fromStatus: item.status,
    toStatus: 'rejected',
    reason: rejectReason,
    timestamp: now,
  };

  const updated = db.updateById('annotation-items', item.id, {
    status: 'rejected',
    reviewer: req.currentUser?.username || item.reviewer,
    reviewedAt: now,
    rejectReason: rejectReason,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  // 通知标注员修改并重新提交。
  notifyReviewRejected(updated, req.currentUser);

  res.success(updated, 'Annotation rejected');
});

/**
 * PUT /annotation-items/:id/resubmit
 * 请求体：{ annotationData }
 * 驳回后重新提交，流程与首次提交相同并自动执行服务端规则预审。
 */
router.put('/:id/resubmit', annotationSubmitLimiter, (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 校验重新提交的标注数据。
  if (
    req.body.annotationData !== undefined &&
    req.body.annotationData !== null &&
    !isPlainObject(req.body.annotationData)
  ) {
    return res.fail('annotationData must be an object');
  }

  // 仅原标注员可以重新提交自己的项。
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can resubmit annotations', 403);
  }
  if (!isAnnotatorOwner(item, req.currentUser)) {
    return res.fail('Annotators can only operate on their own data', 403);
  }

  // 校验驳回项是否允许重新提交。
  const { valid, reason } = validateTransition(
    DATA_ITEM_TRANSITIONS,
    item.status,
    DATA_ITEM_STATUS.SUBMITTED,
  );
  if (!valid) {
    return res.fail(reason);
  }

  const task = db.getById('tasks', item.taskId);
  const timeWindowError = validateTaskSubmissionWindow(task, item);
  if (timeWindowError) {
    const returnedItem = returnAnnotationItemToPool(
      item,
      req.currentUser?.username || 'system',
      timeWindowError,
    );
    return res.fail(timeWindowError, 403, {
      returnedToPool: Boolean(item.annotator),
      item: returnedItem,
    });
  }

  const now = new Date().toISOString();
  const annotationData = req.body.annotationData || item.annotationData;
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: req.currentUser?.username || 'unknown',
    actionType: 'resubmit',
    fromStatus: item.status,
    toStatus: 'submitted',
    reason: null,
    timestamp: now,
  };

  // 校验版本号，避免并发修改互相覆盖。
  const clientVersion = req.body.version;
  if (clientVersion !== undefined && clientVersion !== null && item.version !== clientVersion) {
    return res.fail(
      `Version conflict: current version is ${item.version}, submitted version is ${clientVersion}`,
      409,
      { currentVersion: item.version, serverItem: item },
    );
  }

  // 第一步：保存修改并进入 submitted。
  const submittedItem = db.updateById('annotation-items', item.id, {
    status: 'submitted',
    annotationData,
    submittedAt: now,
    rejectReason: null,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  // 第二步：重新执行服务端规则预审。
  const aiResult = executeAndPersistAIReview(submittedItem);

  // 通知审核员重新提交。
  notifyAnnotationResubmitted(submittedItem, req.currentUser);

  if (aiResult) {
    // 预审完成后补发结果通知。
    notifyAIReviewComplete(aiResult.updatedItem, aiResult.reviewRecord);

    res.success(
      {
        item: aiResult.updatedItem,
        review: aiResult.reviewRecord,
      },
      'Annotation resubmitted and rule review completed',
    );
  } else {
    res.success(
      submittedItem,
      'Annotation resubmitted; rule review skipped because template was not found',
    );
  }
});

/**
 * PUT /annotation-items/:id/claim-assignment
 * 标注员领取一个未分配项，只设置归属，不改变当前状态。
 */
router.put('/:id/claim-assignment', (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 仅标注员可以领取。
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can claim annotation items', 403);
  }

  // 已分配项不能重复领取。
  if (item.annotator !== null) {
    return res.fail('Annotation item has already been assigned', 403);
  }

  if (wasReturnedToPoolByOverdue(item, 'annotation')) {
    return res.fail('Annotation item is overdue and cannot be claimed', 403);
  }

  if (!['pending', 'draft', 'rejected'].includes(item.status)) {
    return res.fail('Current status cannot be claimed for annotation', 403);
  }

  // 归档项不能领取。
  if (item.archived) {
    return res.fail('Archived annotation items cannot be claimed', 403);
  }

  // 非开放任务中的项不能领取。
  const task = db.getById('tasks', item.taskId);
  if (!canTaskExposeWorkItems(task)) {
    return res.fail('Task is not open for annotation', 403);
  }

  const now = new Date().toISOString();
  const username = req.currentUser.username;

  const historyRecord = {
    id: `h${Date.now()}`,
    operator: username,
    actionType: 'claim_assignment',
    fromStatus: item.status,
    toStatus: item.status,
    reason: `Annotator ${username} claimed`,
    timestamp: now,
  };

  const updated = db.updateById('annotation-items', item.id, {
    annotator: username,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  res.success(updated, 'Annotation item claimed successfully');
});

router.put('/:id/claim-review', (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Review item not found');
  }

  if (req.currentUser.role !== 'reviewer') {
    return res.fail('Only reviewers can claim review items', 403);
  }

  if (item.reviewer !== null) {
    return res.fail('Review item has already been assigned', 403);
  }

  if (wasReturnedToPoolByOverdue(item, 'review')) {
    return res.fail('Review item is overdue and cannot be claimed', 403);
  }

  if (!['submitted', 'pending_review'].includes(item.status)) {
    return res.fail('Current status cannot be claimed for review', 403);
  }

  if (item.archived) {
    return res.fail('Archived annotation items cannot be claimed for review', 403);
  }

  const task = db.getById('tasks', item.taskId);
  const timeWindowError = validateReviewWindow(task, item);
  if (timeWindowError) {
    return res.fail(timeWindowError, 403);
  }

  const now = new Date().toISOString();
  const username = req.currentUser.username;
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: username,
    actionType: 'claim_review',
    fromStatus: item.status,
    toStatus: item.status,
    reason: `Reviewer ${username} claimed review item`,
    timestamp: now,
  };

  const updated = db.updateById('annotation-items', item.id, {
    reviewer: username,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  res.success(updated, 'Review item claimed successfully');
});

/**
 * PUT /annotation-items/:id/claim
 * 为编辑领取标注项的排他锁，同一时间只能由一个用户持有，30 分钟后自动过期。
 */
router.put('/:id/claim', (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 只有标注员可以加编辑锁，负责人不能直接标注。
  if (req.currentUser.role !== 'annotator') {
    return res.fail('Only annotators can lock annotation items', 403);
  }
  if (!isAnnotatorOwner(item, req.currentUser)) {
    return res.fail('Annotators can only lock their own annotation items', 403);
  }

  const username = req.currentUser.username;
  const result = db.claimItem(item.id, username, LOCK_TIMEOUT_MS);

  if (result.claimed) {
    res.success(result.item, 'Lock acquired');
  } else if (result.notFound) {
    res.notFound('Annotation item not found');
  } else {
    res.fail(
      `This item is locked by ${result.lockedBy} since ${result.lockedAt}`,
      423, // HTTP 423 Locked
      { lockedBy: result.lockedBy, lockedAt: result.lockedAt },
    );
  }
});

/**
 * PUT /annotation-items/:id/release
 * 释放标注项的编辑锁，锁持有者或负责人可以操作。
 */
router.put('/:id/release', (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  const username = req.currentUser.username;
  // 负责人可以强制释放，标注员只能释放自己的锁。
  if (req.currentUser.role === 'annotator' && item.lockedBy && item.lockedBy !== username) {
    return res.fail('Annotators can only release their own annotation locks', 403);
  }
  if (req.currentUser.role === 'reviewer') {
    return res.fail('Reviewers cannot release annotation locks', 403);
  }

  const result = db.releaseItem(item.id, username);
  if (result.released) {
    res.success(result.item, 'Released');
  } else if (result.notFound) {
    res.notFound('Annotation item not found');
  } else {
    res.fail(`Only the lock holder ${result.lockedBy} can release this item`, 403);
  }
});

/**
 * POST /annotation-items/release-all
 * 释放当前用户持有的全部锁，适合退出登录时调用。
 */
router.post('/release-all', (req, res) => {
  const username = req.currentUser.username;
  const count = db.releaseAllByUser(username);
  res.success({ releasedCount: count }, `Released ${count} lock(s)`);
});

/**
 * POST /annotation-items/:id/ai-review
 * 手动触发 submitted 状态标注项的规则预审，仅负责人可操作。
 */
router.post('/:id/ai-review', requireRole('owner'), (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 只有 submitted 状态可以手动预审。
  if (item.status !== 'submitted') {
    return res.fail(
      `Only submitted annotation items can be AI-reviewed; current status: ${item.status}`,
    );
  }

  const aiResult = executeAndPersistAIReview(item);

  if (aiResult) {
    // 通知审核员预审已完成。
    notifyAIReviewComplete(aiResult.updatedItem, aiResult.reviewRecord);

    res.success(
      {
        item: aiResult.updatedItem,
        review: aiResult.reviewRecord,
      },
      'Rule review completed',
    );
  } else {
    res.fail('Rule review skipped: related template was not found or has no fields');
  }
});

/**
 * PUT /annotation-items/:id/archive
 * 归档已审核通过的标注项，仅负责人或审核员可操作。
 */
router.put('/:id/archive', (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  // 仅负责人或审核员可以归档。
  if (req.currentUser.role !== 'owner' && req.currentUser.role !== 'reviewer') {
    return res.fail('Annotators cannot archive annotation items', 403);
  }

  // 只有审核通过的项可以归档。
  if (item.status !== 'reviewed') {
    return res.fail('Only approved annotation items can be archived');
  }

  if (item.archived) {
    return res.fail('Annotation item is already archived');
  }

  const now = new Date().toISOString();
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: req.currentUser?.username || 'unknown',
    actionType: 'archive',
    fromStatus: item.status,
    toStatus: item.status,
    reason: 'Review approved; archived',
    timestamp: now,
  };

  const updated = db.updateById('annotation-items', item.id, {
    archived: true,
    archivedAt: now,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  res.success(updated, 'Annotation item archived');
});

/**
 * PUT /annotation-items/:id/unarchive
 * 取消标注项归档，仅负责人可操作。
 */
router.put('/:id/unarchive', requireRole('owner'), (req, res) => {
  const item = db.getById('annotation-items', req.params.id);
  if (!item) {
    return res.notFound('Annotation item not found');
  }

  if (!item.archived) {
    return res.fail('Annotation item is not archived');
  }

  const now = new Date().toISOString();
  const historyRecord = {
    id: `h${Date.now()}`,
    operator: req.currentUser?.username || 'unknown',
    actionType: 'unarchive',
    fromStatus: item.status,
    toStatus: item.status,
    reason: 'Unarchived',
    timestamp: now,
  };

  const updated = db.updateById('annotation-items', item.id, {
    archived: false,
    archivedAt: null,
    auditHistory: [...(item.auditHistory || []), historyRecord],
  });

  res.success(updated, 'Annotation item unarchived');
});

module.exports = router;

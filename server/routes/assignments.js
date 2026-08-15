/**
 * 任务分配接口：执行、清除和查询任务分配结果。
 */
const express = require('express');
const db = require('../store/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  ASSIGNMENT_STRATEGY,
  executeAssignment,
  clearAssignment,
  getAssignmentStats,
  getAssignableItems,
  getAnnotators,
} = require('../services/assignmentEngine');
const { notifyTaskAssigned } = require('../services/notificationService');
const { canTaskExposeWorkItems } = require('../utils/itemTimeliness');

const router = express.Router();

/**
 * GET /api/assignments/annotators
 * 获取所有标注员列表（owner 可用）
 */
router.get('/annotators', requireRole('owner'), (req, res) => {
  const annotators = getAnnotators();
  res.success(annotators);
});

router.get('/reviewers', requireRole('owner'), (req, res) => {
  const reviewers = db.find('users', { role: 'reviewer' }).map(({ password, ...rest }) => rest);
  res.success(reviewers);
});

/**
 * GET /api/tasks/:taskId/assign/stats
 * 获取任务分配统计信息
 */
router.get('/tasks/:taskId/assign/stats', requireRole('owner'), (req, res) => {
  const { taskId } = req.params;

  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('任务不存在');
  }

  const stats = getAssignmentStats(taskId);
  res.success(stats);
});

/**
 * GET /api/tasks/:taskId/assign/items
 * 获取待分配数据列表
 * Query: ?status=pending&includeAssigned=false
 */
router.get('/tasks/:taskId/assign/items', requireRole('owner'), (req, res) => {
  const { taskId } = req.params;
  const { status, includeAssigned } = req.query;

  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('任务不存在');
  }

  const statuses = status ? status.split(',') : ['pending'];
  const items = getAssignableItems(taskId, {
    includeAssigned: includeAssigned === 'true',
    statuses,
  });

  // 只返回分配相关字段，不返回完整数据
  const simplified = items.map((item) => ({
    id: item.id,
    taskId: item.taskId,
    status: item.status,
    annotator: item.annotator,
    rawDataPreview: JSON.stringify(item.rawData).slice(0, 100),
  }));

  res.success({ items: simplified, total: simplified.length });
});

router.get('/tasks/:taskId/review-assign/items', requireRole('owner'), (req, res) => {
  const { taskId } = req.params;
  const { status, includeAssigned } = req.query;

  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('任务不存在');
  }

  const statuses = status ? String(status).split(',') : ['submitted', 'pending_review'];
  const allItems = db.find('annotation-items', { taskId });
  const items = allItems.filter((item) => {
    if (item.archived) return false;
    if (!statuses.includes(item.status)) return false;
    if (includeAssigned !== 'true' && item.reviewer !== null) return false;
    return true;
  });

  const simplified = items.map((item) => ({
    id: item.id,
    taskId: item.taskId,
    status: item.status,
    annotator: item.annotator,
    reviewer: item.reviewer,
    submittedAt: item.submittedAt,
    rawDataPreview: JSON.stringify(item.rawData).slice(0, 100),
  }));

  res.success({ items: simplified, total: simplified.length });
});

router.post('/tasks/:taskId/review-assign', requireRole('owner'), (req, res) => {
  const { taskId } = req.params;
  const { assignments = [] } = req.body;
  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('任务不存在');
  }
  if (!canTaskExposeWorkItems(task)) {
    return res.fail('任务未发布，不能分配审核项', 403);
  }
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.fail('审核分配列表不能为空');
  }

  const reviewerSet = new Set(db.find('users', { role: 'reviewer' }).map((user) => user.username));
  const now = new Date().toISOString();
  const details = [];
  let assigned = 0;

  for (const { itemId, reviewer } of assignments) {
    const item = db.getById('annotation-items', itemId);
    if (!item) {
      details.push({ itemId, reviewer, success: false, reason: '数据项不存在' });
      continue;
    }
    if (item.taskId !== taskId) {
      details.push({ itemId, reviewer, success: false, reason: '数据项不属于该任务' });
      continue;
    }
    if (!reviewerSet.has(reviewer)) {
      details.push({ itemId, reviewer, success: false, reason: '审核员不存在' });
      continue;
    }
    if (!['submitted', 'pending_review'].includes(item.status)) {
      details.push({ itemId, reviewer, success: false, reason: '当前状态不允许分配审核' });
      continue;
    }

    const historyRecord = {
      id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      operator: req.currentUser.username,
      actionType: 'assign_reviewer',
      fromStatus: item.status,
      toStatus: item.status,
      reason: `负责人分配审核员 ${reviewer}`,
      timestamp: now,
    };
    db.updateById('annotation-items', item.id, {
      reviewer,
      auditHistory: [...(item.auditHistory || []), historyRecord],
    });
    assigned++;
    details.push({ itemId, reviewer, success: true });
  }

  res.success({ assigned, details }, '审核分配成功');
});

/**
 * POST /api/tasks/:taskId/assign
 * 执行任务分配
 *
 * 请求体：
 *   {
 *     strategy: 'even_split' | 'manual',
 *     annotators: ['user1', 'user2', ...],  // 标注员用户名列表
 *     options: {
 *       perPerson: 0,                       // 按量均分：每人数量
 *       assignments: [{itemId, annotator}], // 手动指定：分配列表
 *     }
 *   }
 */
router.post('/tasks/:taskId/assign', requireRole('owner'), (req, res) => {
  const { taskId } = req.params;
  const { strategy, annotators, options = {} } = req.body;

  // 验证任务已发布：未发布的任务不能进行分配
  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('任务不存在');
  }
  if (!canTaskExposeWorkItems(task)) {
    return res.fail('任务未发布，不能进行分配。请先发布任务后再分配。', 403);
  }

  if (!strategy) {
    return res.fail('请指定分配策略');
  }

  // 验证策略
  const validStrategies = Object.values(ASSIGNMENT_STRATEGY);
  if (!validStrategies.includes(strategy)) {
    return res.fail(`不支持的分配策略：${strategy}，可选值：${validStrategies.join(', ')}`);
  }

  // 验证标注员列表（manual 策略在 options.assignments 中提供）
  if (strategy !== 'manual' && (!annotators || annotators.length === 0)) {
    return res.fail('标注员列表不能为空');
  }

  // 验证标注员是否真实存在
  if (strategy !== 'manual') {
    const allAnnotators = getAnnotators().map((a) => a.username);
    for (const a of annotators) {
      if (!allAnnotators.includes(a)) {
        return res.fail(`标注员 "${a}" 不存在`);
      }
    }
  }

  const result = executeAssignment(taskId, { strategy, annotators, options });

  if (result.error) {
    return res.fail(result.error);
  }

  // 将任务分配结果实时通知相关标注员和审核员。
  if (annotators && annotators.length > 0) {
    notifyTaskAssigned(taskId, annotators, result);
  }

  res.success(result, '分配成功');
});

/**
 * POST /api/tasks/:taskId/assign/clear
 * 清除任务分配
 *
 * 请求体：
 *   {
 *     itemIds: ['id1', 'id2']  // 可选，为空则清除全部未开始标注的
 *   }
 */
router.post('/tasks/:taskId/assign/clear', requireRole('owner'), (req, res) => {
  const { taskId } = req.params;
  const { itemIds = [] } = req.body;

  const task = db.getById('tasks', taskId);
  if (!task) {
    return res.notFound('任务不存在');
  }

  const result = clearAssignment(taskId, { itemIds });
  res.success(result, `已清除 ${result.cleared} 条数据的分配`);
});

module.exports = router;

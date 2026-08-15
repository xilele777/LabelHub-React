/**
 * 任务分配引擎：按策略分配标注项，并记录任务的分配状态。
 */
const db = require('../store/db');
const { canTaskExposeWorkItems } = require('../utils/itemTimeliness');

/** 分配策略枚举。 */
const ASSIGNMENT_STRATEGY = {
  EVEN_SPLIT: 'even_split', // 按量均分
  MANUAL: 'manual', // 手动指定
};

/** 按状态和分配情况查询任务中的候选标注项。 */
function getAssignableItems(taskId, options = {}) {
  const { includeAssigned = false, statuses = ['pending'] } = options;
  const allItems = db.find('annotation-items', { taskId });

  return allItems.filter((item) => {
    // 按状态过滤。
    if (statuses.length > 0 && !statuses.includes(item.status)) return false;
    // 默认排除已分配项。
    if (!includeAssigned && item.annotator !== null) return false;
    return true;
  });
}

/** 获取不含密码字段的标注员列表。 */
function getAnnotators() {
  const users = db.find('users', { role: 'annotator' });
  return users.map(({ password, ...rest }) => rest);
}

/** 将待分配项尽量均匀地分给指定标注员，可限制每人数量。 */
function evenSplitAssign(taskId, annotatorUsernames, options = {}) {
  const { perPerson = 0 } = options;

  if (!annotatorUsernames || annotatorUsernames.length === 0) {
    return { error: '标注员列表不能为空' };
  }

  // 只处理尚未分配的数据。
  const assignableItems = getAssignableItems(taskId);
  if (assignableItems.length === 0) {
    return { error: '没有待分配的数据' };
  }

  // 未指定每人数量时，按标注员人数均分全部候选项。
  const itemsPerPerson =
    perPerson > 0
      ? Math.min(perPerson, Math.ceil(assignableItems.length / annotatorUsernames.length))
      : Math.ceil(assignableItems.length / annotatorUsernames.length);

  const details = [];
  let itemIndex = 0;
  const now = new Date().toISOString();

  for (const username of annotatorUsernames) {
    const count = Math.min(itemsPerPerson, assignableItems.length - itemIndex);
    if (count <= 0) break;

    const assignedItems = [];
    for (let i = 0; i < count && itemIndex < assignableItems.length; i++, itemIndex++) {
      const item = assignableItems[itemIndex];
      const historyRecord = {
        id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        operator: 'system',
        actionType: 'assign_annotator',
        fromStatus: item.status,
        toStatus: item.status,
        reason: `按量均分分配给 ${username}`,
        timestamp: now,
      };
      db.updateById('annotation-items', item.id, {
        annotator: username,
        auditHistory: [...(item.auditHistory || []), historyRecord],
      });
      assignedItems.push(item.id);
    }

    details.push({
      annotator: username,
      count: assignedItems.length,
      items: assignedItems,
    });
  }

  return {
    assigned: itemIndex,
    details,
    remaining: assignableItems.length - itemIndex,
  };
}

/** 按标注项与用户名的映射执行手动分配。 */
function manualAssign(taskId, assignments) {
  if (!assignments || assignments.length === 0) {
    return { error: '分配列表不能为空' };
  }

  const now = new Date().toISOString();
  const details = [];
  let assignedCount = 0;

  for (const { itemId, annotator } of assignments) {
    const item = db.getById('annotation-items', itemId);
    if (!item) {
      details.push({ itemId, annotator, success: false, reason: '数据项不存在' });
      continue;
    }
    if (item.taskId !== taskId) {
      details.push({ itemId, annotator, success: false, reason: '数据项不属于该任务' });
      continue;
    }

    const historyRecord = {
      id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      operator: 'system',
      actionType: 'assign_annotator',
      fromStatus: item.status,
      toStatus: item.status,
      reason: `手动分配给 ${annotator}`,
      timestamp: now,
    };

    db.updateById('annotation-items', item.id, {
      annotator,
      auditHistory: [...(item.auditHistory || []), historyRecord],
    });

    details.push({ itemId, annotator, success: true });
    assignedCount++;
  }

  return { assigned: assignedCount, details };
}

/** 清除指定标注项的分配；未指定 ID 时处理任务中的全部候选项。 */
function clearAssignment(taskId, options = {}) {
  const { itemIds = [] } = options;
  const allItems = db.find('annotation-items', { taskId });
  const itemsToClear =
    itemIds.length > 0 ? allItems.filter((item) => itemIds.includes(item.id)) : allItems;

  const now = new Date().toISOString();
  let cleared = 0;

  for (const item of itemsToClear) {
    if (item.annotator === null) continue;
    // 已开始标注的数据不能清除分配。
    if (item.status !== 'pending' && item.status !== 'draft') continue;

    const historyRecord = {
      id: `h${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
      operator: 'system',
      actionType: 'unassign_annotator',
      fromStatus: item.status,
      toStatus: item.status,
      reason: `清除分配（原标注员：${item.annotator}）`,
      timestamp: now,
    };
    db.updateById('annotation-items', item.id, {
      annotator: null,
      auditHistory: [...(item.auditHistory || []), historyRecord],
    });
    cleared++;
  }

  return { cleared };
}

/** 按标注员和状态汇总任务分配情况。 */
function getAssignmentStats(taskId) {
  const allItems = db.find('annotation-items', { taskId });
  const annotators = getAnnotators();

  const total = allItems.length;
  const assigned = allItems.filter((i) => i.annotator !== null).length;
  const unassigned = total - assigned;

  // 按标注员统计。
  const byAnnotator = {};
  for (const a of annotators) {
    byAnnotator[a.username] = allItems.filter((i) => i.annotator === a.username).length;
  }
  // 统计未分配项。
  byAnnotator['(未分配)'] = unassigned;

  // 按状态统计。
  const byStatus = {};
  for (const item of allItems) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
  }

  return { total, assigned, unassigned, byAnnotator, byStatus };
}

/** 校验任务状态并按配置选择对应的分配策略。 */
function executeAssignment(taskId, config) {
  const { strategy, annotators = [], options = {} } = config;

  // 任务必须存在。
  const task = db.getById('tasks', taskId);
  if (!task) {
    return { error: '任务不存在' };
  }

  // 只有开放中的任务可以分配。
  if (!canTaskExposeWorkItems(task)) {
    return { error: '任务未发布，不能进行分配。请先发布任务后再分配标注员。' };
  }

  let result;
  switch (strategy) {
    case ASSIGNMENT_STRATEGY.EVEN_SPLIT:
      result = evenSplitAssign(taskId, annotators, options);
      break;
    case ASSIGNMENT_STRATEGY.MANUAL:
      result = manualAssign(taskId, options.assignments || []);
      break;
    default:
      return { error: `不支持的分配策略：${strategy}` };
  }

  // 分配成功后记录实际使用的配置。
  if (!result.error) {
    const existingConfig = task.assignmentConfig || {};
    db.updateById('tasks', taskId, {
      assignmentConfig: {
        ...existingConfig,
        strategy,
        annotators,
        options,
        lastAssignedAt: new Date().toISOString(),
        lastResult: { assigned: result.assigned },
      },
    });
  }

  return result;
}

module.exports = {
  ASSIGNMENT_STRATEGY,
  getAssignableItems,
  getAnnotators,
  evenSplitAssign,
  manualAssign,
  clearAssignment,
  getAssignmentStats,
  executeAssignment,
};

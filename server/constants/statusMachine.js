/**
 * 标注项和任务的状态机定义及迁移校验。
 * 前后端状态规则需要保持一致，修改后应同步检查前端实现。
 */

// 标注项状态。
const DATA_ITEM_STATUS = {
  PENDING: 'pending',
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_REVIEW: 'pending_review',
  REVIEWED: 'reviewed',
  REJECTED: 'rejected',
};

/**
 * 标注项允许的状态迁移，键为当前状态，值为可进入的目标状态。
 */
const DATA_ITEM_TRANSITIONS = {
  // 允许从 pending 直接提交（无需先保存草稿）；服务端提交后会同步完成规则预审并进入待人工审核
  [DATA_ITEM_STATUS.PENDING]: [
    DATA_ITEM_STATUS.DRAFT,
    DATA_ITEM_STATUS.SUBMITTED,
    DATA_ITEM_STATUS.PENDING_REVIEW,
  ],
  [DATA_ITEM_STATUS.DRAFT]: [DATA_ITEM_STATUS.SUBMITTED, DATA_ITEM_STATUS.PENDING],
  // 服务端同步完成规则预审：submitted 可直接到 pending_review。
  [DATA_ITEM_STATUS.SUBMITTED]: [
    DATA_ITEM_STATUS.PENDING_REVIEW,
    DATA_ITEM_STATUS.REVIEWED,
    DATA_ITEM_STATUS.REJECTED,
  ],
  [DATA_ITEM_STATUS.PENDING_REVIEW]: [DATA_ITEM_STATUS.REVIEWED, DATA_ITEM_STATUS.REJECTED],
  [DATA_ITEM_STATUS.REVIEWED]: [],
  [DATA_ITEM_STATUS.REJECTED]: [DATA_ITEM_STATUS.SUBMITTED],
};

// 任务状态。
const TASK_STATUS = {
  DRAFT: 'draft',
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ENDED: 'ended',
};

/**
 * 任务允许的状态迁移，键为当前状态，值为可进入的目标状态。
 */
const TASK_TRANSITIONS = {
  [TASK_STATUS.DRAFT]: [TASK_STATUS.PENDING, TASK_STATUS.IN_PROGRESS],
  [TASK_STATUS.PENDING]: [TASK_STATUS.DRAFT, TASK_STATUS.IN_PROGRESS],
  [TASK_STATUS.IN_PROGRESS]: [TASK_STATUS.COMPLETED, TASK_STATUS.ENDED],
  [TASK_STATUS.COMPLETED]: [],
  [TASK_STATUS.ENDED]: [],
};

// 状态迁移校验。

/**
 * 根据状态迁移表校验目标状态，并返回失败原因。
 */
function validateTransition(transitions, currentStatus, targetStatus) {
  // 当前状态不存在于状态机中。
  if (!Object.prototype.hasOwnProperty.call(transitions, currentStatus)) {
    return {
      valid: false,
      reason: `未知当前状态: "${currentStatus}"`,
    };
  }

  const allowed = transitions[currentStatus];

  // 目标状态不在允许的迁移列表中。
  if (!allowed.includes(targetStatus)) {
    return {
      valid: false,
      reason: `非法状态转换: "${currentStatus}" → "${targetStatus}"，允许的目标状态: [${allowed.length ? allowed.join(', ') : '无（终态）'}]`,
    };
  }

  return { valid: true, reason: '' };
}

module.exports = {
  DATA_ITEM_STATUS,
  DATA_ITEM_TRANSITIONS,
  TASK_STATUS,
  TASK_TRANSITIONS,
  validateTransition,
};

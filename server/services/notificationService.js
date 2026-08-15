/**
 * Socket.IO 实时通知服务。
 * 负责业务通知的生成、权限范围和 WebSocket 房间管理。
 * 用户、角色和任务房间分别用于定向通知、角色广播和任务进度刷新。
 */
const { Server } = require('socket.io');
const { decodeToken } = require('../middleware/auth');
const db = require('../store/db');

let io = null;

/** 通知类型枚举。 */
const NOTIFICATION_TYPE = {
  // 审核相关
  REVIEW_APPROVED: 'review_approved', // 审核通过
  REVIEW_REJECTED: 'review_rejected', // 审核驳回
  AI_REVIEW_COMPLETE: 'ai_review_complete', // 规则预审完成（兼容旧事件名）

  // 任务分配相关
  TASK_ASSIGNED: 'task_assigned', // 新任务分配
  TASK_UNASSIGNED: 'task_unassigned', // 任务分配取消

  // 任务进度相关
  TASK_SUBMITTED: 'task_submitted', // 标注已提交
  TASK_RESUBMITTED: 'task_resubmitted', // 标注已重新提交
  TASK_STATUS_CHANGED: 'task_status_changed', // 任务状态变更
  TASK_DUE_SOON: 'task_due_soon',
  OWNER_MESSAGE: 'owner_message', // 负责人主动发布
};

/** 通知优先级。 */
const NOTIFICATION_PRIORITY = {
  [NOTIFICATION_TYPE.REVIEW_REJECTED]: 'high',
  [NOTIFICATION_TYPE.REVIEW_APPROVED]: 'medium',
  [NOTIFICATION_TYPE.AI_REVIEW_COMPLETE]: 'low',
  [NOTIFICATION_TYPE.TASK_ASSIGNED]: 'high',
  [NOTIFICATION_TYPE.TASK_UNASSIGNED]: 'medium',
  [NOTIFICATION_TYPE.TASK_SUBMITTED]: 'low',
  [NOTIFICATION_TYPE.TASK_RESUBMITTED]: 'medium',
  [NOTIFICATION_TYPE.TASK_STATUS_CHANGED]: 'low',
  [NOTIFICATION_TYPE.TASK_DUE_SOON]: 'high',
  [NOTIFICATION_TYPE.OWNER_MESSAGE]: 'medium',
};

/** 各通知类型的默认标题。 */
const NOTIFICATION_TITLE = {
  [NOTIFICATION_TYPE.REVIEW_APPROVED]: '审核通过',
  [NOTIFICATION_TYPE.REVIEW_REJECTED]: '审核驳回',
  [NOTIFICATION_TYPE.AI_REVIEW_COMPLETE]: '规则预审完成',
  [NOTIFICATION_TYPE.TASK_ASSIGNED]: '新任务分配',
  [NOTIFICATION_TYPE.TASK_UNASSIGNED]: '任务分配取消',
  [NOTIFICATION_TYPE.TASK_SUBMITTED]: '标注已提交',
  [NOTIFICATION_TYPE.TASK_RESUBMITTED]: '标注已重新提交',
  [NOTIFICATION_TYPE.TASK_STATUS_CHANGED]: '任务状态变更',
  [NOTIFICATION_TYPE.TASK_DUE_SOON]: '任务即将逾期',
  [NOTIFICATION_TYPE.OWNER_MESSAGE]: '负责人通知',
};

/** 补齐通知 ID、时间、优先级等通用字段。 */
function createNotification({ type, title, message, data = {}, sender = null, targetUsers = [] }) {
  return {
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    title: title || NOTIFICATION_TITLE[type] || '系统通知',
    message,
    priority: NOTIFICATION_PRIORITY[type] || 'low',
    data,
    sender,
    targetUsers,
    timestamp: new Date().toISOString(),
    read: false,
  };
}

function buildRecipientNotification(username, notification) {
  const user = db.findOne('users', { username });
  return {
    ...notification,
    id: `${notification.id}_${username}`,
    recipientUserId: user?.id || null,
    recipientUsername: username,
  };
}

function persistNotificationForUser(username, notification) {
  const persisted = buildRecipientNotification(username, notification);
  try {
    return db.insertNotification(persisted);
  } catch (err) {
    console.error('[WS] 持久化通知失败:', err.message);
    return persisted;
  }
}

function canDeliverNotificationToUser(username, notification) {
  const user = db.findOne('users', { username });
  if (notification.type === NOTIFICATION_TYPE.OWNER_MESSAGE) return true;
  if (user?.role === 'annotator') {
    return [
      NOTIFICATION_TYPE.REVIEW_APPROVED,
      NOTIFICATION_TYPE.REVIEW_REJECTED,
      NOTIFICATION_TYPE.TASK_DUE_SOON,
    ].includes(notification.type);
  }
  if (user?.role === 'reviewer') {
    return [NOTIFICATION_TYPE.TASK_RESUBMITTED, NOTIFICATION_TYPE.TASK_DUE_SOON].includes(
      notification.type,
    );
  }
  return true;
}

function getVisibleNotificationTypesForUser(user) {
  if (user?.role === 'annotator') {
    return [
      NOTIFICATION_TYPE.REVIEW_APPROVED,
      NOTIFICATION_TYPE.REVIEW_REJECTED,
      NOTIFICATION_TYPE.TASK_DUE_SOON,
      NOTIFICATION_TYPE.OWNER_MESSAGE,
    ];
  }
  if (user?.role === 'reviewer') {
    return [
      NOTIFICATION_TYPE.TASK_RESUBMITTED,
      NOTIFICATION_TYPE.TASK_DUE_SOON,
      NOTIFICATION_TYPE.OWNER_MESSAGE,
    ];
  }
  return null;
}

/**
 * 初始化 Socket.IO 服务器
 * @param {import('http').Server} server - HTTP 服务器实例
 * @param {object} [corsOptions] - 与 Express 共用的 CORS 配置（含 origin 校验与 credentials）
 */
function initNotificationService(server, corsOptions) {
  io = new Server(server, {
    cors: corsOptions || {
      origin: (origin, callback) => {
        // 未传入配置时的兜底：仅允许本地开发来源
        if (
          !origin ||
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:')
        ) {
          callback(null, true);
        } else {
          callback(new Error('CORS not allowed'), false);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Socket.IO path，避免与 API 路由冲突
    path: '/socket.io/',
    // 连接超时和重连配置
    connectTimeout: 10000,
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  // Redis 多进程适配器。
  try {
    const { getRedis } = require('../utils/redis');
    const redis = getRedis();
    if (redis) {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const pubClient = redis.duplicate();
      const subClient = redis.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[WS] Redis 多进程适配器已启用');
    }
  } catch (err) {
    // 未安装适配器时保留单进程模式。
    if (err.code !== 'MODULE_NOT_FOUND') {
      console.warn('[WS] Redis 适配器初始化失败:', err.message);
    }
  }

  // WebSocket 认证。
  io.use((socket, next) => {
    // 从握手请求中获取 token
    const token =
      socket.handshake.auth.token ||
      socket.handshake.query.token ||
      extractTokenFromHeaders(socket.handshake.headers);

    if (!token) {
      // 允许未认证连接，但限制功能
      socket.data.user = null;
      return next();
    }

    const decoded = decodeToken(token);
    if (!decoded) {
      return next(new Error('认证失败：token 无效或已过期'));
    }

    const user = db.getById('users', decoded.userId);
    if (!user) {
      return next(new Error('用户不存在'));
    }

    const { password, ...userInfo } = user;
    socket.data.user = userInfo;
    next();
  });

  // 连接和房间管理。
  io.on('connection', (socket) => {
    const user = socket.data.user;

    if (!user) {
      console.log(`[WS] 匿名连接: ${socket.id}`);
      return;
    }

    console.log(`[WS] 用户连接: ${user.username} (${user.role}) - ${socket.id}`);

    socket.join(`user:${user.id}`);
    socket.join(`user:username:${user.username}`);

    socket.join(`role:${user.role}`);

    // 任务房间按业务归属加入，不能由客户端任意订阅。
    joinTaskRooms(socket, user);

    // 客户端事件。

    // 客户端请求加入特定任务房间：必须校验当前用户是否有权访问该任务，避免跨用户订阅造成通知串号
    socket.on('join:task', (taskId) => {
      if (!canAccessTaskRoom(user, taskId)) {
        console.warn(`[WS] 拒绝 ${user.username} 加入无权限任务房间: ${taskId}`);
        socket.emit('join:task_denied', { taskId, message: '无权订阅该任务通知' });
        return;
      }

      socket.join(`task:${taskId}`);
      console.log(`[WS] ${user.username} 加入任务房间: ${taskId}`);
    });

    socket.on('leave:task', (taskId) => {
      socket.leave(`task:${taskId}`);
    });

    socket.on('notification:read', (notificationId) => {
      db.markNotificationReadForUser(user.username, notificationId);
      socket.emit('notification:read_ack', {
        id: notificationId,
        readAt: new Date().toISOString(),
      });
    });

    socket.on('notification:read_all', () => {
      const visibleTypes = getVisibleNotificationTypesForUser(user);
      if (visibleTypes) {
        db.markAllNotificationsReadForUserByTypes(user.username, visibleTypes);
      } else {
        db.markAllNotificationsReadForUser(user.username);
      }
      socket.emit('notification:read_all_ack', { readAt: new Date().toISOString() });
    });

    socket.on('notification:unread_count', () => {
      const visibleTypes = getVisibleNotificationTypesForUser(user);
      const count = visibleTypes
        ? db.getUnreadNotificationCountForUserByTypes(user.username, visibleTypes)
        : db.getUnreadNotificationCountForUser(user.username);
      socket.emit('notification:unread_count_response', {
        count,
      });
    });

    socket.on('disconnect', (reason) => {
      console.log(`[WS] 用户断开: ${user.username} - 原因: ${reason}`);
      socket.leave(`user:${user.id}`);
      socket.leave(`user:username:${user.username}`);
      socket.leave(`role:${user.role}`);
    });
  });

  console.log('[WS] Socket.IO 通知服务已启动');
  return io;
}

/** 从请求头提取 Bearer 令牌。 */
function extractTokenFromHeaders(headers) {
  const authHeader = headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

/**
 * 判断用户是否有权加入任务房间。
 * 任务房间只用于刷新/进度类场景，不能作为个人通知的权限边界。
 */
function canAccessTaskRoom(user, taskId) {
  if (!user || !taskId) return false;

  if (user.role === 'owner') {
    return Boolean(db.getById('tasks', taskId));
  }

  if (user.role === 'annotator') {
    return db.find('annotation-items', { taskId, annotator: user.username }).length > 0;
  }

  if (user.role === 'reviewer') {
    return db
      .getAll('annotation-items')
      .some(
        (item) =>
          item.taskId === taskId &&
          (item.reviewer === user.username ||
            (item.reviewer === null && item.status === 'pending_review')),
      );
  }

  return false;
}

/**
 * 获取指定任务当前对应的审核员用户名列表。
 * - 已分配 reviewer：仅通知该 reviewer
 * - 未分配 pending_review：通知可处理该任务待审数据的审核员
 */
function getReviewerUsernamesForItem(item) {
  if (item?.reviewer) {
    return [item.reviewer];
  }

  return db.find('users', { role: 'reviewer' }).map((user) => user.username);
}

function getUsernamesByRole(role) {
  return db.find('users', { role }).map((user) => user.username);
}

function getUsernamesForTask(taskId) {
  return db
    .getAll('users')
    .filter((user) => canAccessTaskRoom(user, taskId))
    .map((user) => user.username);
}

function getAllUsernames() {
  return db.getAll('users').map((user) => user.username);
}

/**
 * 向一组用户名发送通知，并在通知体中写入 targetUsers，便于前端/日志明确归属。
 */
function notifyUsersByUsername(usernames, notification) {
  const targetUsers = [...new Set((usernames || []).filter(Boolean))];
  if (targetUsers.length === 0) return [];

  const targetedNotification = {
    ...notification,
    targetUsers,
  };

  const persistedNotifications = [];
  for (const username of targetUsers) {
    if (!canDeliverNotificationToUser(username, targetedNotification)) {
      continue;
    }
    const persisted = persistNotificationForUser(username, targetedNotification);
    persistedNotifications.push(persisted);
    if (io) {
      io.to(`user:username:${username}`).emit('notification', persisted);
    }
  }

  return persistedNotifications;
}

/** 按用户角色和任务归属加入可访问的任务房间。 */
function joinTaskRooms(socket, user) {
  try {
    if (user.role === 'owner') {
      // Owner 加入所有任务房间
      const tasks = db.getAll('tasks');
      for (const task of tasks) {
        socket.join(`task:${task.id}`);
      }
    } else if (user.role === 'annotator') {
      // 标注员加入自己被分配的任务房间
      const items = db.find('annotation-items', { annotator: user.username });
      const taskIds = [...new Set(items.map((item) => item.taskId))];
      for (const taskId of taskIds) {
        socket.join(`task:${taskId}`);
      }
    } else if (user.role === 'reviewer') {
      // 审核员加入自己负责审核的任务房间；NULL 不能通过 db.find 的 "=" 查询匹配，需在内存中过滤
      const items = db.find('annotation-items', { reviewer: user.username });
      const unassignedPendingReview = db
        .getAll('annotation-items')
        .filter((item) => item.status === 'pending_review' && item.reviewer === null);
      const allItems = [...items, ...unassignedPendingReview];
      const taskIds = [...new Set(allItems.map((item) => item.taskId))];
      for (const taskId of taskIds) {
        socket.join(`task:${taskId}`);
      }
    }
  } catch (err) {
    console.error('[WS] 加入任务房间失败:', err.message);
  }
}

// 通知发送方法。

/** 向指定用户 ID 发送并持久化通知。 */
function notifyUser(userId, notification) {
  const user = db.getById('users', userId);
  if (!user) return null;
  if (!canDeliverNotificationToUser(user.username, notification)) return null;
  const targetedNotification = {
    ...notification,
    targetUsers: notification.targetUsers?.length ? notification.targetUsers : [user.username],
  };
  const persisted = persistNotificationForUser(user.username, targetedNotification);
  if (io) {
    io.to(`user:${userId}`).emit('notification', persisted);
  }
  return persisted;
}

/** 按用户名发送通知。 */
function notifyUserByUsername(username, notification) {
  return notifyUsersByUsername([username], notification);
}

/** 向指定角色房间广播通知。 */
function notifyRole(role, notification) {
  return notifyUsersByUsername(getUsernamesByRole(role), notification);
}

/** 向指定任务房间广播通知。 */
function notifyTask(taskId, notification) {
  return notifyUsersByUsername(getUsernamesForTask(taskId), notification);
}

/** 向全部连接广播通知。 */
function broadcastNotification(notification) {
  return notifyUsersByUsername(getAllUsernames(), notification);
}

// 业务通知方法。

/** 将审核通过结果推送给对应标注员。 */
function notifyReviewApproved(item, reviewer) {
  const task = db.getById('tasks', item.taskId);
  const notification = createNotification({
    type: NOTIFICATION_TYPE.REVIEW_APPROVED,
    title: '审核通过',
    message: `您提交的标注「${task?.name || item.taskId}」已通过审核`,
    data: {
      dataItemId: item.id,
      taskId: item.taskId,
      taskName: task?.name,
      reviewer: reviewer.username,
      reviewedAt: item.reviewedAt,
    },
    sender: reviewer.username,
  });

  // 只推送给该标注项所属标注员，避免同任务其他用户收到
  if (item.annotator) {
    notifyUserByUsername(item.annotator, notification);
  }

  return notification;
}

/** 将审核驳回结果以高优先级推送给对应标注员。 */
function notifyReviewRejected(item, reviewer) {
  const task = db.getById('tasks', item.taskId);
  const notification = createNotification({
    type: NOTIFICATION_TYPE.REVIEW_REJECTED,
    title: '审核驳回',
    message: `您提交的标注「${task?.name || item.taskId}」已被驳回，原因：${item.rejectReason || '未说明'}`,
    data: {
      dataItemId: item.id,
      taskId: item.taskId,
      taskName: task?.name,
      reviewer: reviewer.username,
      rejectReason: item.rejectReason,
      reviewedAt: item.reviewedAt,
    },
    sender: reviewer.username,
  });

  // 只推送给该标注项所属标注员（高优先级，需立即可见），避免同任务其他用户收到
  if (item.annotator) {
    notifyUserByUsername(item.annotator, notification);
  }

  return notification;
}

/** 将任务分配结果推送给相关标注员和审核员。 */
function notifyTaskAssigned(taskId, annotatorUsernames, assignmentResult) {
  const task = db.getById('tasks', taskId);
  const notifications = [];

  for (const username of annotatorUsernames) {
    const detail = assignmentResult.details?.find((d) => d.annotator === username);
    const count = detail?.count || detail?.success || 0;

    const notification = createNotification({
      type: NOTIFICATION_TYPE.TASK_ASSIGNED,
      title: '新任务分配',
      message: `您被分配了任务「${task?.name || taskId}」的 ${count} 条数据，请尽快标注`,
      data: {
        taskId,
        taskName: task?.name,
        assignedCount: count,
        strategy: assignmentResult.strategy,
      },
      sender: 'system',
    });

    notifyUserByUsername(username, notification);
    notifications.push(notification);
  }

  // 通知审核员有新数据待审核
  const reviewers = db.find('users', { role: 'reviewer' });
  for (const reviewer of reviewers) {
    const { password, ...reviewerInfo } = reviewer;
    const notification = createNotification({
      type: NOTIFICATION_TYPE.TASK_STATUS_CHANGED,
      title: '任务更新',
      message: `任务「${task?.name || taskId}」已分配 ${assignmentResult.assigned} 条数据`,
      data: {
        taskId,
        taskName: task?.name,
        assignedCount: assignmentResult.assigned,
      },
      sender: 'system',
    });
    notifyUserByUsername(reviewerInfo.username, notification);
  }

  return notifications;
}

/** 将新提交的标注通知对应审核员。 */
function notifyAnnotationSubmitted(item, annotator) {
  const task = db.getById('tasks', item.taskId);
  const notification = createNotification({
    type: NOTIFICATION_TYPE.TASK_SUBMITTED,
    title: '标注已提交',
    message: `标注员 ${annotator.username} 提交了任务「${task?.name || item.taskId}」的标注，等待审核`,
    data: {
      dataItemId: item.id,
      taskId: item.taskId,
      taskName: task?.name,
      annotator: annotator.username,
      submittedAt: item.submittedAt,
    },
    sender: annotator.username,
  });

  // 只推送给该标注项对应的审核员；未指定 reviewer 时，推送给可处理未分配待审项的审核员
  notifyUsersByUsername(getReviewerUsernamesForItem(item), notification);

  return notification;
}

/** 将重新提交的标注通知对应审核员。 */
function notifyAnnotationResubmitted(item, annotator) {
  const task = db.getById('tasks', item.taskId);
  const notification = createNotification({
    type: NOTIFICATION_TYPE.TASK_RESUBMITTED,
    title: '标注已重新提交',
    message: `标注员 ${annotator.username} 重新提交了任务「${task?.name || item.taskId}」的标注`,
    data: {
      dataItemId: item.id,
      taskId: item.taskId,
      taskName: task?.name,
      annotator: annotator.username,
      submittedAt: item.submittedAt,
    },
    sender: annotator.username,
  });

  // 只推送给该标注项对应的审核员；未指定 reviewer 时，推送给可处理未分配待审项的审核员
  notifyUsersByUsername(getReviewerUsernamesForItem(item), notification);

  return notification;
}

/** 将规则预审结果通知对应审核员。 */
function notifyAIReviewComplete(item, reviewRecord) {
  const task = db.getById('tasks', item.taskId);
  const notification = createNotification({
    type: NOTIFICATION_TYPE.AI_REVIEW_COMPLETE,
    title: '规则预审完成',
    message: `任务「${task?.name || item.taskId}」的数据项已完成规则预审，评分 ${reviewRecord.score}/100，请进行人工审核`,
    data: {
      dataItemId: item.id,
      taskId: item.taskId,
      taskName: task?.name,
      reviewId: reviewRecord.id,
      score: reviewRecord.score,
      reviewStatus: reviewRecord.reviewStatus,
    },
    sender: '规则系统',
  });

  // 只推送给该标注项对应的审核员；未指定 reviewer 时，推送给可处理未分配待审项的审核员
  notifyUsersByUsername(getReviewerUsernamesForItem(item), notification);

  return notification;
}

/** 获取已初始化的 Socket.IO 实例。 */
function getIO() {
  return io;
}

module.exports = {
  NOTIFICATION_TYPE,
  NOTIFICATION_PRIORITY,
  initNotificationService,
  getIO,
  // 通用发送方法
  notifyUser,
  notifyUserByUsername,
  notifyUsersByUsername,
  notifyRole,
  notifyTask,
  broadcastNotification,
  // 业务通知方法
  notifyReviewApproved,
  notifyReviewRejected,
  notifyTaskAssigned,
  notifyAnnotationSubmitted,
  notifyAnnotationResubmitted,
  notifyAIReviewComplete,
  createNotification,
};

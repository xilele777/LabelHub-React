/** 通知查询、已读、发布和撤回接口。 */
const express = require('express');
const db = require('../store/db');
const { requireAuth } = require('../middleware/auth');
const {
  NOTIFICATION_TYPE,
  createNotification,
  notifyUsersByUsername,
} = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

const ROLE_VISIBLE_TYPES = {
  annotator: [
    NOTIFICATION_TYPE.REVIEW_REJECTED,
    NOTIFICATION_TYPE.TASK_DUE_SOON,
    NOTIFICATION_TYPE.OWNER_MESSAGE,
  ],
  reviewer: [
    NOTIFICATION_TYPE.TASK_RESUBMITTED,
    NOTIFICATION_TYPE.TASK_DUE_SOON,
    NOTIFICATION_TYPE.OWNER_MESSAGE,
  ],
};

const VALID_TARGET_ROLES = ['owner', 'annotator', 'reviewer'];

function getVisibleTypes(req) {
  return ROLE_VISIBLE_TYPES[req.currentUser.role] || null;
}

function resolveTargetUsers({ targetRoles = [], targetUsernames = [] }) {
  const users = db.getAll('users');
  const roleSet = new Set((targetRoles || []).filter(Boolean));
  const usernameSet = new Set((targetUsernames || []).filter(Boolean));
  return users
    .filter((user) => roleSet.has(user.role) || usernameSet.has(user.username))
    .map((user) => user.username);
}

function summarizePublishedNotifications(rows) {
  const groups = new Map();

  for (const row of rows) {
    const publishId = row.data?.publishId || row.id;
    const current = groups.get(publishId) || {
      id: publishId,
      title: row.title,
      message: row.message,
      priority: row.priority,
      sender: row.sender,
      targetRoles: row.data?.targetRoles || [],
      targetUsernames: row.data?.targetUsernames || [],
      timestamp: row.timestamp,
      revokedAt: row.data?.revokedAt || null,
      revokedBy: row.data?.revokedBy || null,
      totalRecipients: 0,
      readCount: 0,
      unreadCount: 0,
      deletedCount: 0,
      recipients: [],
    };

    current.totalRecipients += 1;
    if (row.read) current.readCount += 1;
    if (row.deleted) current.deletedCount += 1;
    if (row.data?.revokedAt && !current.revokedAt) {
      current.revokedAt = row.data.revokedAt;
      current.revokedBy = row.data.revokedBy || null;
    }
    current.recipients.push({
      id: row.id,
      username: row.recipientUsername,
      read: row.read,
      readAt: row.readAt,
      deleted: row.deleted,
      deletedAt: row.deletedAt,
    });

    groups.set(publishId, current);
  }

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      unreadCount: Math.max(0, item.totalRecipients - item.readCount),
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

router.get('/', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const username = req.currentUser.username;
  const visibleTypes = getVisibleTypes(req);

  const items = visibleTypes
    ? db.getNotificationsForUserByTypes(username, visibleTypes, { limit })
    : db.getNotificationsForUser(username, { limit });
  const unreadCount = visibleTypes
    ? db.getUnreadNotificationCountForUserByTypes(username, visibleTypes)
    : db.getUnreadNotificationCountForUser(username);
  const total = visibleTypes
    ? db.getNotificationCountForUserByTypes(username, visibleTypes)
    : db.getNotificationCountForUser(username);

  res.success({ items, total, unreadCount });
});

router.get('/published', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.fail('仅负责人可以管理发布通知', 403);
  }

  const rows = db.getOwnerPublishedNotificationRows(null, {
    limit: Number(req.query.limit) || 500,
  });
  const items = summarizePublishedNotifications(rows);
  res.success({ items, total: items.length });
});

router.get('/published/:publishId', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.fail('仅负责人可以管理发布通知', 403);
  }

  const rows = db.getPublishedNotificationRowsByPublishId(null, req.params.publishId);
  const item = summarizePublishedNotifications(rows)[0];
  if (!item) {
    return res.notFound('发布记录不存在');
  }

  res.success(item);
});

router.get('/unread-count', (req, res) => {
  const visibleTypes = getVisibleTypes(req);
  const unreadCount = visibleTypes
    ? db.getUnreadNotificationCountForUserByTypes(req.currentUser.username, visibleTypes)
    : db.getUnreadNotificationCountForUser(req.currentUser.username);
  res.success({ unreadCount });
});

router.post('/publish', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.fail('仅负责人可以发布通知', 403);
  }

  const title = String(req.body.title || '').trim();
  const message = String(req.body.message || '').trim();
  const targetRoles = Array.isArray(req.body.targetRoles) ? req.body.targetRoles : [];
  const targetUsernames = Array.isArray(req.body.targetUsernames) ? req.body.targetUsernames : [];
  const priority = ['high', 'medium', 'low'].includes(req.body.priority)
    ? req.body.priority
    : 'medium';

  if (!title) return res.fail('通知标题不能为空');
  if (!message) return res.fail('通知内容不能为空');

  const invalidRoles = targetRoles.filter((role) => !VALID_TARGET_ROLES.includes(role));
  if (invalidRoles.length > 0) {
    return res.fail(`无效的目标角色：${invalidRoles.join(', ')}`);
  }

  const allUsers = db.getAll('users');
  const existingUsernames = new Set(allUsers.map((user) => user.username));
  const invalidUsernames = targetUsernames.filter((username) => !existingUsernames.has(username));
  if (invalidUsernames.length > 0) {
    return res.fail(`目标用户不存在：${invalidUsernames.join(', ')}`);
  }

  const recipients = resolveTargetUsers({ targetRoles, targetUsernames });
  if (recipients.length === 0) {
    return res.fail('请至少指定一个接收角色或接收人员');
  }

  const publishId = `pub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const notification = createNotification({
    type: NOTIFICATION_TYPE.OWNER_MESSAGE,
    title,
    message,
    data: {
      publishId,
      targetRoles,
      targetUsernames,
      publishedBy: req.currentUser.username,
    },
    sender: req.currentUser.username,
  });
  notification.priority = priority;

  const delivered = notifyUsersByUsername(recipients, notification);
  res.success({ publishId, recipients, delivered: delivered.length }, '通知发布成功');
});

router.put('/published/:publishId/revoke', (req, res) => {
  if (req.currentUser.role !== 'owner') {
    return res.fail('仅负责人可以撤回发布通知', 403);
  }

  const publishId = req.params.publishId;
  const rows = db.getPublishedNotificationRowsByPublishId(null, publishId);
  if (rows.length === 0) {
    return res.notFound('发布记录不存在');
  }

  const firstRevoked = rows.find((row) => row.data?.revokedAt);
  if (firstRevoked) {
    return res.fail('该通知已撤回');
  }

  const now = new Date().toISOString();
  const updated = db.updatePublishedNotificationData(null, publishId, (row) => ({
    ...row,
    data: {
      ...(row.data || {}),
      revokedAt: now,
      revokedBy: req.currentUser.username,
    },
    deleted: true,
    deletedAt: now,
  }));

  res.success({ publishId, updated, revokedAt: now }, '通知已撤回');
});

router.put('/read-all', (req, res) => {
  const visibleTypes = getVisibleTypes(req);
  const updated = visibleTypes
    ? db.markAllNotificationsReadForUserByTypes(req.currentUser.username, visibleTypes)
    : db.markAllNotificationsReadForUser(req.currentUser.username);
  res.success({ updated }, '全部通知已读');
});

router.put('/:id/read', (req, res) => {
  const ok = db.markNotificationReadForUser(req.currentUser.username, req.params.id);
  if (!ok) {
    return res.notFound('通知不存在');
  }
  res.success({ id: req.params.id }, '通知已读');
});

router.delete('/', (req, res) => {
  const visibleTypes = getVisibleTypes(req);
  const deleted = visibleTypes
    ? db.clearNotificationsForUserByTypes(req.currentUser.username, visibleTypes)
    : db.clearNotificationsForUser(req.currentUser.username);
  res.success({ deleted }, '通知已清空');
});

router.delete('/:id', (req, res) => {
  const ok = db.deleteNotificationForUser(req.currentUser.username, req.params.id);
  if (!ok) {
    return res.notFound('通知不存在');
  }
  res.success({ id: req.params.id }, '通知已删除');
});

module.exports = router;

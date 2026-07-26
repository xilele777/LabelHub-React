/**
 * WebSocket 通知客户端服务
 *
 * 基于 Socket.IO Client，管理与后端的 WebSocket 连接：
 *   - 登录后自动连接，登出后自动断开
 *   - 接收实时通知并转发到通知 store
 *   - 支持加入/离开任务房间
 *   - 自动重连机制
 */
import { io, Socket } from 'socket.io-client';
import { useNotificationStore } from '../store/useNotificationStore';
import { logger } from '../utils/logger';

// 默认开发环境直连后端，避免经 Vite 代理转发 WebSocket 产生噪音；生产环境可通过 VITE_WS_URL 覆盖。
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

let socket: Socket | null = null;
let activeToken: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;

/**
 * 通知类型枚举（与后端保持一致）
 */
export const NOTIFICATION_TYPE = {
  REVIEW_APPROVED: 'review_approved',
  REVIEW_REJECTED: 'review_rejected',
  AI_REVIEW_COMPLETE: 'ai_review_complete',
  TASK_ASSIGNED: 'task_assigned',
  TASK_UNASSIGNED: 'task_unassigned',
  TASK_SUBMITTED: 'task_submitted',
  TASK_RESUBMITTED: 'task_resubmitted',
  TASK_STATUS_CHANGED: 'task_status_changed',
  TASK_DUE_SOON: 'task_due_soon',
  OWNER_MESSAGE: 'owner_message',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

/**
 * 通知优先级
 */
export const NOTIFICATION_PRIORITY = {
  high: 'high',
  medium: 'medium',
  low: 'low',
} as const;

export type NotificationPriority =
  (typeof NOTIFICATION_PRIORITY)[keyof typeof NOTIFICATION_PRIORITY];

/**
 * 通知对象接口
 */
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  data: Record<string, unknown>;
  sender: string | null;
  targetUsers: string[];
  timestamp: string;
  read: boolean;
}

/**
 * 连接 WebSocket 服务器
 * @param token - JWT token
 */
export function connectNotificationWS(token: string): void {
  if (socket?.connected && activeToken === token) {
    logger.log('[WS] 已连接，跳过重复连接');
    return;
  }

  if (socket) {
    socket.disconnect();
    socket = null;
  }

  activeToken = token;
  socket = io(WS_URL, {
    path: '/socket.io/',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    autoConnect: true,
  });

  // ─── 连接事件 ──────────────────────────────────

  socket.on('connect', () => {
    logger.log('[WS] 连接成功:', socket?.id);
    reconnectAttempts = 0;
    const store = useNotificationStore.getState();
    store.setConnected(true);
    void store.fetchNotifications();
  });

  socket.on('disconnect', (reason) => {
    logger.log('[WS] 连接断开:', reason);
    useNotificationStore.getState().setConnected(false);

    // 断开后刷新 token，为重连准备最新凭证
    const freshToken = localStorage.getItem('token');
    if (freshToken && freshToken !== activeToken) {
      logger.log('[WS] 检测到 token 变化，更新重连凭证');
      activeToken = freshToken;
      if (socket) {
        socket.auth = { token: freshToken };
      }
    }
  });

  socket.on('connect_error', (error) => {
    logger.error('[WS] 连接错误:', error.message);
    reconnectAttempts++;
    useNotificationStore.getState().setConnected(false);

    // 重连时刷新 token：用户可能已重新登录或 token 已更新
    const freshToken = localStorage.getItem('token');
    if (freshToken && freshToken !== activeToken) {
      logger.log('[WS] 检测到新 token，更新连接凭证');
      activeToken = freshToken;
      if (socket) {
        socket.auth = { token: freshToken };
      }
    }

    // token 已不存在（用户已登出），停止重连
    if (!freshToken) {
      logger.log('[WS] 无 token，停止重连');
      socket?.disconnect();
      return;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('[WS] 达到最大重连次数，停止重连');
      socket?.disconnect();
    }
  });

  // ─── 通知事件 ──────────────────────────────────

  socket.on('notification', (notification: Notification) => {
    if (!isNotificationForCurrentUser(notification)) {
      logger.warn('[WS] 已丢弃非当前用户通知:', notification.type, notification.title);
      return;
    }

    logger.log('[WS] 收到通知:', notification.type, notification.title);

    // 将通知推送到 store
    const store = useNotificationStore.getState();
    store.addNotification(notification);

    // 根据优先级决定是否播放提示音或弹出桌面通知
    if (notification.priority === 'high') {
      showDesktopNotification(notification);
    }
  });

  // ─── 其他事件 ──────────────────────────────────

  socket.on('notification:read_ack', (data) => {
    logger.log('[WS] 通知已读确认:', data);
  });

  socket.on('notification:read_all_ack', () => {
    logger.log('[WS] 全部已读确认');
  });
}

/**
 * 断开 WebSocket 连接
 */
export function disconnectNotificationWS(): void {
  if (socket) {
    // 先禁用自动重连，防止断开后又自动重连
    socket.disconnect();
    socket = null;
    activeToken = null;
    reconnectAttempts = 0;
    logger.log('[WS] 已断开连接');
  }
}

/**
 * 加入任务房间
 * @param taskId - 任务ID
 */
export function joinTaskRoom(taskId: string): void {
  if (socket?.connected) {
    socket.emit('join:task', taskId);
    logger.log('[WS] 加入任务房间:', taskId);
  }
}

/**
 * 离开任务房间
 * @param taskId - 任务ID
 */
export function leaveTaskRoom(taskId: string): void {
  if (socket?.connected) {
    socket.emit('leave:task', taskId);
  }
}

/**
 * 标记通知已读
 * @param notificationId - 通知ID
 */
export function markNotificationRead(notificationId: string): void {
  if (socket?.connected) {
    socket.emit('notification:read', notificationId);
  }
}

/**
 * 标记所有通知已读
 */
export function markAllNotificationsRead(): void {
  if (socket?.connected) {
    socket.emit('notification:read_all');
  }
}

/**
 * 获取 Socket 实例（用于高级操作）
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * 防御性校验：即使服务端误广播，前端也只接收 targetUsers 包含当前用户的通知。
 * 兼容旧通知：targetUsers 为空时放行。
 */
function isNotificationForCurrentUser(notification: Notification): boolean {
  if (!notification.targetUsers || notification.targetUsers.length === 0) {
    return true;
  }

  try {
    const saved = localStorage.getItem('user');
    const currentUser = saved ? JSON.parse(saved) : null;
    const currentIdentifiers = [currentUser?.username, currentUser?.id].filter(Boolean);
    return notification.targetUsers.some((target) => currentIdentifiers.includes(target));
  } catch {
    return false;
  }
}

/**
 * 显示桌面通知（浏览器 Notification API）
 */
function showDesktopNotification(notification: Notification): void {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    createDesktopNotification(notification);
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        createDesktopNotification(notification);
      }
    });
  }
}

/**
 * 创建浏览器桌面通知
 */
function createDesktopNotification(notification: Notification): void {
  try {
    const desktopNotif = new window.Notification(notification.title, {
      body: notification.message,
      icon: '/vite.svg',
      tag: notification.id,
    });

    desktopNotif.onclick = () => {
      window.focus();
      desktopNotif.close();
    };

    // 5秒后自动关闭
    setTimeout(() => desktopNotif.close(), 5000);
  } catch {
    // 某些浏览器可能不支持
  }
}

/**
 * 请求桌面通知权限
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.requestPermission();
}

// 通知数据、未读数量和通知读取状态。
import { create } from 'zustand';
import { logger } from '../utils/logger';
import * as notificationApi from '../api/notification';

export type NotificationPriority = 'high' | 'medium' | 'low';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  data: Record<string, unknown>;
  sender: string | null;
  targetUsers: string[];
  timestamp: string;
  read: boolean;
}

export interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
  panelOpen: boolean;
  connected: boolean;
  currentUserId: string | null;
  loading: boolean;
  error: string | null;
}

/** 派生字段：随 notifications 同步维护（Pinia 版为 computed） */
interface NotificationDerived {
  hasUnread: boolean;
  latestNotification: NotificationItem | undefined;
}

interface NotificationActions {
  addNotification(notification: NotificationItem): void;
  fetchNotifications(): Promise<void>;
  markAsRead(id: string): void;
  markAllAsRead(): void;
  clearAll(): void;
  removeNotification(id: string): void;
  togglePanel(): void;
  setPanelOpen(open: boolean): void;
  setConnected(nextConnected: boolean): void;
  setCurrentUser(userId: string | null): void;
  clearUserStorage(): void;
}

export type NotificationStore = NotificationState & NotificationDerived & NotificationActions;

const MAX_NOTIFICATIONS = 100;
const STORAGE_PREFIX = 'notif_';

export const NOTIFICATION_COLOR_MAP: Record<string, string> = {
  review_approved: '#52c41a',
  review_rejected: '#ff4d4f',
  ai_review_complete: '#722ed1',
  task_assigned: '#1890ff',
  task_unassigned: '#faad14',
  task_submitted: '#13c2c2',
  task_resubmitted: '#eb2f96',
  task_status_changed: '#8c8c8c',
  task_due_soon: '#ff4d4f',
  owner_message: '#1677ff',
};

function getStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function getStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function saveToLocalStorage(userId: string | null, notifications: NotificationItem[]): void {
  if (!userId) return;
  try {
    getStorage()?.setItem(getStorageKey(userId), JSON.stringify(notifications));
  } catch {
    // 存储不可用或空间不足时不影响通知功能。
  }
}

function loadFromLocalStorage(userId: string): NotificationItem[] {
  try {
    const raw = getStorage()?.getItem(getStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as NotificationItem[]).slice(0, MAX_NOTIFICATIONS) : [];
  } catch {
    return [];
  }
}

function removeFromLocalStorage(userId: string): void {
  try {
    getStorage()?.removeItem(getStorageKey(userId));
  } catch {
    // 清理失败时忽略，不影响主流程。
  }
}

function withDerived(notifications: NotificationItem[]) {
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  return {
    notifications,
    unreadCount,
    hasUnread: unreadCount > 0,
    latestNotification: notifications[0],
  };
}

/** 截断通知列表、更新未读数并持久化。 */
function buildSyncPatch(currentUserId: string | null, nextNotifications: NotificationItem[]) {
  const notifications = nextNotifications.slice(0, MAX_NOTIFICATIONS);
  saveToLocalStorage(currentUserId, notifications);
  return withDerived(notifications);
}

export function createInitialNotificationState(): NotificationState & NotificationDerived {
  return {
    notifications: [],
    unreadCount: 0,
    panelOpen: false,
    connected: false,
    currentUserId: null,
    loading: false,
    error: null,
    hasUnread: false,
    latestNotification: undefined,
  };
}

export const useNotificationStore = create<NotificationStore>()((set, get) => ({
  ...createInitialNotificationState(),

  addNotification(notification) {
    const { notifications, currentUserId } = get();
    if (notifications.some((item) => item.id === notification.id)) return;
    set(buildSyncPatch(currentUserId, [notification, ...notifications]));
  },

  async fetchNotifications(): Promise<void> {
    const { currentUserId } = get();
    if (!currentUserId) return;

    set({ loading: true, error: null });

    try {
      const res = await notificationApi.getNotificationList({ limit: MAX_NOTIFICATIONS });
      const notifications = res.data.items || [];
      const unreadCount = res.data.unreadCount ?? notifications.filter((item) => !item.read).length;
      saveToLocalStorage(currentUserId, notifications);
      set({
        notifications,
        unreadCount,
        hasUnread: unreadCount > 0,
        latestNotification: notifications[0],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch notifications';
      set({ error: message });
      logger.warn('[NotificationStore] Failed to fetch notifications:', err);
    } finally {
      set({ loading: false });
    }
  },

  markAsRead(id) {
    const { notifications, currentUserId } = get();
    set(
      buildSyncPatch(
        currentUserId,
        notifications.map((notification) =>
          notification.id === id ? { ...notification, read: true } : notification,
        ),
      ),
    );
    notificationApi.markNotificationRead(id).catch(() => {});
  },

  markAllAsRead() {
    const { notifications, currentUserId } = get();
    set(
      buildSyncPatch(
        currentUserId,
        notifications.map((notification) => ({ ...notification, read: true })),
      ),
    );
    notificationApi.markAllNotificationsRead().catch(() => {});
  },

  clearAll() {
    set(buildSyncPatch(get().currentUserId, []));
    notificationApi.clearNotifications().catch(() => {});
  },

  removeNotification(id) {
    const { notifications, currentUserId } = get();
    set(
      buildSyncPatch(
        currentUserId,
        notifications.filter((notification) => notification.id !== id),
      ),
    );
    notificationApi.deleteNotification(id).catch(() => {});
  },

  togglePanel() {
    set((state) => ({ panelOpen: !state.panelOpen }));
  },

  setPanelOpen(open) {
    set({ panelOpen: open });
  },

  setConnected(nextConnected) {
    set({ connected: nextConnected });
  },

  setCurrentUser(userId) {
    const { currentUserId, notifications } = get();
    if (currentUserId === userId) return;

    if (currentUserId) {
      saveToLocalStorage(currentUserId, notifications);
    }

    if (!userId) {
      set({
        currentUserId: null,
        panelOpen: false,
        ...withDerived([]),
      });
      return;
    }

    set({
      currentUserId: userId,
      panelOpen: false,
      ...withDerived(loadFromLocalStorage(userId)),
    });
  },

  clearUserStorage() {
    const { currentUserId } = get();
    if (currentUserId) {
      removeFromLocalStorage(currentUserId);
    }
  },
}));

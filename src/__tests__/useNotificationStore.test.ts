/**
 * 通知状态仓库单元测试（Zustand 版）
 *
 * 与 Pinia 版差异：无 setActivePinia；getState() 返回不可变快照，
 * 每次断言前需重新获取。
 *
 * 运行: npx vitest run src/__tests__/useNotificationStore.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useNotificationStore,
  createInitialNotificationState,
} from '../store/useNotificationStore';

describe('useNotificationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useNotificationStore.setState(createInitialNotificationState());
  });

  it('should initialize with empty state', () => {
    const store = useNotificationStore.getState();
    expect(store.notifications).toEqual([]);
    expect(store.unreadCount).toBe(0);
    expect(store.panelOpen).toBe(false);
    expect(store.connected).toBe(false);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.hasUnread).toBe(false);
  });

  it('should add notification correctly', () => {
    useNotificationStore.getState().setCurrentUser('u001');
    useNotificationStore.getState().addNotification({
      id: 'n001',
      type: 'task_assigned',
      title: 'New Task',
      message: 'You have been assigned a new task',
      priority: 'high',
      data: {},
      sender: 'owner',
      targetUsers: ['u001'],
      timestamp: new Date().toISOString(),
      read: false,
    });
    const store = useNotificationStore.getState();
    expect(store.notifications.length).toBe(1);
    expect(store.unreadCount).toBe(1);
    expect(store.hasUnread).toBe(true);
  });

  it('should not add duplicate notifications', () => {
    useNotificationStore.getState().setCurrentUser('u001');
    const notif = {
      id: 'n001',
      type: 'task_assigned',
      title: 'Task',
      message: 'msg',
      priority: 'high' as const,
      data: {},
      sender: 'owner',
      targetUsers: ['u001'],
      timestamp: new Date().toISOString(),
      read: false,
    };
    useNotificationStore.getState().addNotification(notif);
    useNotificationStore.getState().addNotification(notif);
    expect(useNotificationStore.getState().notifications.length).toBe(1);
  });

  it('should mark notification as read', () => {
    useNotificationStore.getState().setCurrentUser('u001');
    useNotificationStore.getState().addNotification({
      id: 'n001',
      type: 'task_assigned',
      title: 'Task',
      message: 'msg',
      priority: 'high',
      data: {},
      sender: 'owner',
      targetUsers: ['u001'],
      timestamp: new Date().toISOString(),
      read: false,
    });
    useNotificationStore.getState().markAsRead('n001');
    const store = useNotificationStore.getState();
    expect(store.notifications[0]?.read).toBe(true);
    expect(store.unreadCount).toBe(0);
  });

  it('should toggle panel', () => {
    expect(useNotificationStore.getState().panelOpen).toBe(false);
    useNotificationStore.getState().togglePanel();
    expect(useNotificationStore.getState().panelOpen).toBe(true);
    useNotificationStore.getState().setPanelOpen(false);
    expect(useNotificationStore.getState().panelOpen).toBe(false);
  });

  it('should clear notifications', () => {
    useNotificationStore.getState().setCurrentUser('u001');
    useNotificationStore.getState().addNotification({
      id: 'n001',
      type: 'task_assigned',
      title: 'Task',
      message: 'msg',
      priority: 'low',
      data: {},
      sender: 'owner',
      targetUsers: ['u001'],
      timestamp: new Date().toISOString(),
      read: false,
    });
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications.length).toBe(0);
  });

  it('should set error state', () => {
    const store = useNotificationStore.getState();
    expect(store.error).toBeNull();
    expect(store.loading).toBe(false);
  });
});

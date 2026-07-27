/**
 * MainLayout 冒烟测试：按角色渲染菜单 + Outlet 出子页 + 通知 WS 连接生命周期。
 *
 * mock 边界：notificationWebSocket 服务（部分 mock，保留常量导出）、
 * preloadTemplateSchemas（避免真实请求）、通知 store 的 fetchNotifications。
 *
 * 运行: npx vitest run src/__tests__/MainLayout.smoke.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import MainLayout from '../layouts/MainLayout';
import { connectNotificationWS, disconnectNotificationWS } from '../services/notificationWebSocket';
import { useNotificationStore } from '../store/useNotificationStore';
import { Role } from '../types';
import { resetSessionState, signIn } from './helpers/smoke';

vi.mock('../services/notificationWebSocket', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/notificationWebSocket')>()),
  connectNotificationWS: vi.fn(),
  disconnectNotificationWS: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  getSocket: vi.fn(() => null),
}));

vi.mock('../utils/templateSchemaHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/templateSchemaHelper')>()),
  preloadTemplateSchemas: vi.fn().mockResolvedValue(undefined),
}));

const fetchNotifications = vi.fn().mockResolvedValue(undefined);

function renderLayout() {
  const router = createMemoryRouter([
    {
      path: '/',
      element: <MainLayout />,
      children: [{ index: true, element: <div>outlet-stub</div> }],
    },
  ]);
  return render(<RouterProvider router={router} />);
}

describe('MainLayout 冒烟', () => {
  beforeEach(() => {
    resetSessionState();
    vi.mocked(connectNotificationWS).mockClear();
    vi.mocked(disconnectNotificationWS).mockClear();
    fetchNotifications.mockClear();
    useNotificationStore.setState({ notifications: [], fetchNotifications });
  });

  it('ADMIN 渲染管理端菜单，Outlet 渲染子页面', async () => {
    signIn();
    renderLayout();

    expect(await screen.findByText('outlet-stub')).toBeTruthy();
    expect(screen.getByText('概览')).toBeTruthy();
    expect(screen.getByText('任务')).toBeTruthy();
    expect(screen.getByText('用户管理')).toBeTruthy();
    expect(screen.getByText('admin')).toBeTruthy();
  });

  it('ANNOTATOR 只看到角色内菜单（无用户管理）', async () => {
    signIn({ id: 'u002', username: 'anno', role: Role.ANNOTATOR });
    renderLayout();

    expect(await screen.findByText('标注工作台')).toBeTruthy();
    expect(screen.queryByText('用户管理')).toBeNull();
    expect(screen.queryByText('任务')).toBeNull();
  });

  it('登录态下建立通知 WS 连接并拉取通知，卸载时断开', async () => {
    signIn();
    const { unmount } = renderLayout();

    await waitFor(() => {
      expect(connectNotificationWS).toHaveBeenCalledWith('test-token');
      expect(fetchNotifications).toHaveBeenCalled();
    });

    unmount();
    expect(disconnectNotificationWS).toHaveBeenCalled();
  });
});

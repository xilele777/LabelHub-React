/**
 * Login 页冒烟测试：渲染 + 登录成功跳转 + 失败提示。
 *
 * mock 边界：api/auth.loginApi（store.login 动态 import 同样命中 vi.mock），
 * useAuthStore 真实运行，路由用 createMemoryRouter 承接跳转断言。
 *
 * 运行: npx vitest run src/__tests__/Login.smoke.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import Login from '../pages/Login';
import { loginApi } from '../api/auth';
import { useAuthStore } from '../store/useAuthStore';
import { Role } from '../types';
import { ADMIN_USER, resetSessionState } from './helpers/smoke';

vi.mock('../api/auth', () => ({
  loginApi: vi.fn(),
}));

const mockedLoginApi = vi.mocked(loginApi);

function renderLogin(initialEntry = '/login') {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <Login /> },
      { path: '/dashboard', element: <div>dashboard-stub</div> },
      { path: '/annotate', element: <div>annotate-stub</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('Login 冒烟', () => {
  beforeEach(() => {
    resetSessionState();
    mockedLoginApi.mockReset();
  });

  it('渲染登录表单（标题 + 账号密码输入框 + 登录按钮）', () => {
    renderLogin();

    expect(screen.getByText('LabelHub')).toBeTruthy();
    expect(screen.getByPlaceholderText('用户名')).toBeTruthy();
    expect(screen.getByPlaceholderText('密码')).toBeTruthy();
    expect(screen.getByRole('button', { name: /登\s*录/ })).toBeTruthy();
  });

  it('登录成功后按角色默认路径跳转（ADMIN → /dashboard）', async () => {
    mockedLoginApi.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: { token: 'tk-1', user: ADMIN_USER },
    });
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('dashboard-stub')).toBeTruthy();
    expect(mockedLoginApi).toHaveBeenCalledWith({ username: 'admin', password: '123456' });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('登录成功后优先跳转 redirect 参数指向的安全路径', async () => {
    mockedLoginApi.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: { token: 'tk-2', user: { id: 'u002', username: 'anno', role: Role.ANNOTATOR } },
    });
    renderLogin('/login?redirect=%2Fannotate');

    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'anno' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('annotate-stub')).toBeTruthy();
  });

  it('登录失败展示错误提示且停留在登录页', async () => {
    mockedLoginApi.mockRejectedValue(new Error('用户名或密码错误'));
    const router = renderLogin();

    fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }));

    expect(await screen.findByText('用户名或密码错误')).toBeTruthy();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

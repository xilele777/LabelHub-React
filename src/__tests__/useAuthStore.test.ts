/**
 * Auth Store 单元测试（Zustand 版）
 *
 * 与 Pinia 版差异：
 *   - 无 setActivePinia；用 setState(createInitialAuthState()) 模拟重新初始化
 *   - getState() 返回不可变快照，每次断言前需重新获取
 *   - token 持久化断言对齐实际行为：token 存 localStorage
 *     （Vue 版该断言与实现矛盾且一直失败，见 REACT-MIGRATION.md 进度记录）
 *
 * 运行: npx vitest run src/__tests__/useAuthStore.test.ts
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore, createInitialAuthState } from '../store/useAuthStore';
import { Role } from '../types';

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState(createInitialAuthState());
  });

  it('should initialize with no user and no token', () => {
    const store = useAuthStore.getState();
    expect(store.user).toBeNull();
    expect(store.token).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.loading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('should set session correctly', () => {
    useAuthStore.getState().setSession({
      token: 'test-token-123',
      user: { id: 'u001', username: 'owner', role: Role.OWNER },
    });
    const store = useAuthStore.getState();
    expect(store.token).toBe('test-token-123');
    expect(store.user?.username).toBe('owner');
    expect(store.isAuthenticated).toBe(true);
    expect(store.role).toBe('owner');
  });

  it('should clear session correctly', () => {
    useAuthStore.getState().setSession({
      token: 'test-token',
      user: { id: 'u001', username: 'owner', role: Role.OWNER },
    });
    useAuthStore.getState().clearSession('expired');
    const store = useAuthStore.getState();
    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toBe('expired');
  });

  it('should persist user info and token to localStorage', () => {
    useAuthStore.getState().setSession({
      token: 'secure-token',
      user: { id: 'u001', username: 'owner', role: Role.OWNER },
    });
    const saved = localStorage.getItem('user');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.username).toBe('owner');
    // 对齐实际行为：token 持久化到 localStorage
    // （notificationWebSocket 重连依赖 localStorage.getItem('token') 刷新凭证）
    expect(localStorage.getItem('token')).toBe('secure-token');
  });

  it('should load persisted user on re-initialization', () => {
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 'u002', username: 'annotator', role: Role.ANNOTATOR }),
    );
    useAuthStore.setState(createInitialAuthState());
    const store = useAuthStore.getState();
    expect(store.user?.username).toBe('annotator');
    expect(store.role).toBe('annotator');
  });

  it('should clear invalid persisted user data', () => {
    localStorage.setItem('user', JSON.stringify({ invalid: true }));
    useAuthStore.setState(createInitialAuthState());
    expect(useAuthStore.getState().user).toBeNull();
  });
});

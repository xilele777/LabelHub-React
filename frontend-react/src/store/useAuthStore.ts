import { create } from 'zustand';
import type { UserInfo } from '../types';
import { AUTH_EXPIRED_EVENT } from '../api/authEvents';
import { resetUnauthorizedRedirect } from '../api/request';

export interface AuthState {
  user: UserInfo | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  /** 派生字段：由 setSession/clearSession/setUser 同步维护 */
  isAuthenticated: boolean;
  role: UserInfo['role'] | null;
}

interface AuthActions {
  setSession(payload: { token: string; user: UserInfo }): void;
  clearSession(message?: string): void;
  setUser(nextUser: UserInfo | null): void;
  login(username: string, password: string): Promise<UserInfo | null>;
  logout(): Promise<void>;
}

export type AuthStore = AuthState & AuthActions;

const USER_KEY = 'user';
const TOKEN_KEY = 'token';

function getStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function loadPersistedUser(): UserInfo | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const saved = storage.getItem(USER_KEY);
    if (!saved) return null;

    const user = JSON.parse(saved) as Partial<UserInfo>;
    if (!user.id || !user.username || !user.role) {
      storage.removeItem(USER_KEY);
      return null;
    }

    return user as UserInfo;
  } catch {
    storage.removeItem(USER_KEY);
    return null;
  }
}

function derive(user: UserInfo | null, token: string | null) {
  return {
    isAuthenticated: Boolean(token && user),
    role: user?.role ?? null,
  };
}

/** 从 localStorage 恢复初始状态；测试中用于模拟 store 重新初始化 */
export function createInitialAuthState(): AuthState {
  const user = loadPersistedUser();
  const token = getStorage()?.getItem(TOKEN_KEY) ?? null;
  return { user, token, loading: false, error: null, ...derive(user, token) };
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
  ...createInitialAuthState(),

  setSession(payload) {
    resetUnauthorizedRedirect();

    const storage = getStorage();
    storage?.setItem(USER_KEY, JSON.stringify(payload.user));
    storage?.setItem(TOKEN_KEY, payload.token);

    set({
      user: payload.user,
      token: payload.token,
      error: null,
      ...derive(payload.user, payload.token),
    });
  },

  clearSession(message) {
    const storage = getStorage();
    storage?.removeItem(USER_KEY);
    storage?.removeItem(TOKEN_KEY);

    set({
      user: null,
      token: null,
      loading: false,
      error: message ?? null,
      ...derive(null, null),
    });
  },

  setUser(nextUser) {
    const storage = getStorage();
    if (storage) {
      if (nextUser) {
        storage.setItem(USER_KEY, JSON.stringify(nextUser));
      } else {
        storage.removeItem(USER_KEY);
      }
    }

    set((state) => ({ user: nextUser, ...derive(nextUser, state.token) }));
  },

  async login(username, password) {
    set({ loading: true, error: null });

    try {
      const { loginApi } = await import('../api/auth');
      const res = await loginApi({ username, password });
      get().setSession(res.data);
      set({ loading: false });
      return res.data.user;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '登录失败';
      set({ loading: false, error: message });
      return null;
    }
  },

  async logout() {
    set({ loading: true, error: null });

    try {
      const { releaseAllItems } = await import('../api/annotation');
      await releaseAllItems();
    } catch {
      // Releasing item locks should not block logout.
    }

    get().clearSession();
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_EXPIRED_EVENT, () => {
    useAuthStore.getState().clearSession('登录已过期，请重新登录');
  });
}

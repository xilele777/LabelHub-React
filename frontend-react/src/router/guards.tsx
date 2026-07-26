import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Role } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { getDefaultPath, hasRouteRole } from '../utils/roleHelper';

/** 登录守卫：未登录跳转 /login 并携带回跳地址（等价 Vue router.beforeEach 的登录检查） */
export function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    const fullPath = location.pathname + location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(fullPath)}`} replace />;
  }

  return children;
}

/** 角色守卫：无对应角色跳转 /403（等价 Vue 路由 meta.roles 检查） */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const role = useAuthStore((state) => state.role);

  if (roles.length > 0 && !hasRouteRole(role, roles)) {
    return <Navigate to="/403" replace />;
  }

  return children;
}

/** 登录页守卫：已登录访问 /login 时跳转角色默认首页 */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  if (isAuthenticated && user) {
    return <Navigate to={getDefaultPath(user.role)} replace />;
  }

  return children;
}

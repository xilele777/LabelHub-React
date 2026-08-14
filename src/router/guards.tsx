// 路由访问控制，处理登录状态和角色权限校验。
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { Role } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import { getDefaultPath, hasRouteRole } from '../utils/roleHelper';

/** 未登录时跳转登录页，并保留原地址。 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    const fullPath = location.pathname + location.search;
    return <Navigate to={`/login?redirect=${encodeURIComponent(fullPath)}`} replace />;
  }

  return children;
}

/** 当前角色无权访问时跳转无权限页面。 */
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

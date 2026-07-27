import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RedirectIfAuthed, RequireAuth, RequireRole } from './guards';
import { asyncRoutes, renderRouteElement, type RouteHandle } from './routes';

// 入口体积预算约束：MainLayout/Login 携带 antd 组件与 socket.io 依赖，
// 必须懒加载以将组件库排除出入口预加载链（对齐 Vue 版 313kB 基线的分包策略）
const MainLayout = lazy(() => import('../layouts/MainLayout'));
const Login = lazy(() => import('../pages/Login'));
const Forbidden = lazy(() => import('../pages/Exception/Forbidden'));
const NotFound = lazy(() => import('../pages/Exception/NotFound'));

export { asyncRoutes };
export type { RouteHandle };

export const router = createBrowserRouter(
  [
    {
      path: '/login',
      element: (
        <RedirectIfAuthed>
          <Login />
        </RedirectIfAuthed>
      ),
      handle: { title: '登录' } satisfies RouteHandle,
    },
    {
      path: '/403',
      element: (
        <RequireAuth>
          <Forbidden />
        </RequireAuth>
      ),
      handle: { title: '无权限' } satisfies RouteHandle,
    },
    {
      path: '/',
      element: (
        <RequireAuth>
          <MainLayout />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        ...asyncRoutes.map((route) => ({
          path: route.path,
          element: <RequireRole roles={route.roles}>{renderRouteElement(route)}</RequireRole>,
          handle: { title: route.title } satisfies RouteHandle,
        })),
      ],
    },
    {
      path: '*',
      element: <NotFound />,
      handle: { title: '页面不存在' } satisfies RouteHandle,
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

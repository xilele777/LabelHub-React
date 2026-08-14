// 创建应用路由并挂载访问控制组件。
import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RedirectIfAuthed, RequireAuth, RequireRole } from './guards';
import { asyncRoutes, renderRouteElement, type RouteHandle } from './routes';

// 主布局和登录页依赖较大的组件库与通信模块，按路由懒加载以控制入口体积。
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

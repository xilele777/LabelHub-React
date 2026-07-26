import { createBrowserRouter, Navigate } from 'react-router';
import MainLayout from '../layouts/MainLayout';
import Login from '../pages/Login';
import Forbidden from '../pages/Exception/Forbidden';
import NotFound from '../pages/Exception/NotFound';
import { RedirectIfAuthed, RequireAuth, RequireRole } from './guards';
import { asyncRoutes, renderRouteElement, type RouteHandle } from './routes';

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

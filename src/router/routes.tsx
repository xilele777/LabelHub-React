// 集中定义页面路由、懒加载组件和路由元信息。
import { lazy, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Role } from '../types';

/** 路由标题等元信息，布局通过 useMatches 读取。 */
export interface RouteHandle {
  title: string;
}

export interface AsyncRouteConfig {
  path: string;
  name: string;
  title: string;
  roles: Role[];
  /** 页面组件。页面默认按路由懒加载。 */
  Component: LazyExoticComponent<ComponentType> | ComponentType;
}

/** 挂载在主布局下的业务路由。 */
export const asyncRoutes: AsyncRouteConfig[] = [
  {
    path: 'dashboard',
    name: 'Dashboard',
    title: '仪表盘',
    roles: [Role.ADMIN, Role.ANNOTATOR, Role.REVIEWER],
    Component: lazy(() => import('../pages/Dashboard')),
  },
  {
    path: 'tasks',
    name: 'TaskList',
    title: '任务列表',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/TaskList')),
  },
  {
    path: 'tasks/create',
    name: 'TaskCreate',
    title: '创建任务',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/TaskForm')),
  },
  {
    path: 'tasks/detail',
    name: 'TaskDetail',
    title: '任务详情',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/TaskDetail')),
  },
  {
    path: 'tasks/edit',
    name: 'TaskEdit',
    title: '编辑任务',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/TaskForm')),
  },
  {
    path: 'archive',
    name: 'TaskArchive',
    title: '任务归档',
    roles: [Role.ADMIN, Role.ANNOTATOR, Role.REVIEWER],
    Component: lazy(() => import('../pages/TaskArchive')),
  },
  {
    path: 'templates',
    name: 'TemplateManage',
    title: '模板管理',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/TemplateManage')),
  },
  {
    path: 'templates/builder',
    name: 'TemplateBuilder',
    title: '模板搭建',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/TemplateBuilder')),
  },
  {
    path: 'annotate',
    name: 'AnnotationWorkbench',
    title: '标注工作台',
    roles: [Role.ANNOTATOR],
    Component: lazy(() => import('../pages/AnnotationWorkbench')),
  },
  {
    path: 'review',
    name: 'ReviewWorkbench',
    title: '审核工作台',
    roles: [Role.REVIEWER],
    Component: lazy(() => import('../pages/ReviewWorkbench')),
  },
  {
    path: 'export',
    name: 'DataExport',
    title: '数据导出',
    roles: [Role.ADMIN, Role.REVIEWER],
    Component: lazy(() => import('../pages/DataExport')),
  },
  {
    path: 'statistics',
    name: 'StatisticsBoard',
    title: '统计看板',
    roles: [Role.ADMIN, Role.REVIEWER],
    Component: lazy(() => import('../pages/StatisticsBoard')),
  },
  {
    path: 'monitoring',
    name: 'MonitoringBoard',
    title: '性能监控',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/MonitoringBoard')),
  },
  {
    path: 'users',
    name: 'UserManage',
    title: '用户管理',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/UserManage')),
  },
  {
    path: 'notifications/publish',
    name: 'NotificationPublish',
    title: '通知发布',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/NotificationPublish')),
  },
  {
    path: 'notifications/manage',
    name: 'NotificationManage',
    title: '通知管理',
    roles: [Role.ADMIN],
    Component: lazy(() => import('../pages/NotificationManage')),
  },
];

export function renderRouteElement(route: AsyncRouteConfig): ReactNode {
  const PageComponent = route.Component;
  return <PageComponent />;
}

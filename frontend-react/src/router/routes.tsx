import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import { Role } from '../types';
import PlaceholderPage from '../pages/PlaceholderPage';

/** 路由 handle 元信息（等价 Vue RouteMeta），MainLayout 经 useMatches 读取 title */
export interface RouteHandle {
  title: string;
}

export interface AsyncRouteConfig {
  path: string;
  name: string;
  title: string;
  roles: Role[];
  /** 页面组件；阶段 3 迁移完成前为 null，路由层自动落到占位页 */
  Component: LazyExoticComponent<ComponentType> | ComponentType | null;
}

/**
 * 业务路由表（挂在 MainLayout 下）。
 * 阶段 3 迁移页面时：Component 从 null 换成 lazy(() => import('../pages/Xxx'))。
 */
export const asyncRoutes: AsyncRouteConfig[] = [
  {
    path: 'dashboard',
    name: 'Dashboard',
    title: '仪表盘',
    roles: [Role.ADMIN, Role.ANNOTATOR, Role.REVIEWER],
    Component: null,
  },
  {
    path: 'tasks',
    name: 'TaskList',
    title: '任务列表',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'tasks/create',
    name: 'TaskCreate',
    title: '创建任务',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'tasks/detail',
    name: 'TaskDetail',
    title: '任务详情',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'tasks/edit',
    name: 'TaskEdit',
    title: '编辑任务',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'archive',
    name: 'TaskArchive',
    title: '任务归档',
    roles: [Role.ADMIN, Role.ANNOTATOR, Role.REVIEWER],
    Component: null,
  },
  {
    path: 'templates',
    name: 'TemplateManage',
    title: '模板管理',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'templates/builder',
    name: 'TemplateBuilder',
    title: '模板搭建',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'annotate',
    name: 'AnnotationWorkbench',
    title: '标注工作台',
    roles: [Role.ANNOTATOR],
    Component: null,
  },
  {
    path: 'review',
    name: 'ReviewWorkbench',
    title: '审核工作台',
    roles: [Role.REVIEWER],
    Component: null,
  },
  {
    path: 'export',
    name: 'DataExport',
    title: '数据导出',
    roles: [Role.ADMIN, Role.REVIEWER],
    Component: null,
  },
  {
    path: 'statistics',
    name: 'StatisticsBoard',
    title: '统计看板',
    roles: [Role.ADMIN, Role.REVIEWER],
    Component: null,
  },
  {
    path: 'monitoring',
    name: 'MonitoringBoard',
    title: '性能监控',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'users',
    name: 'UserManage',
    title: '用户管理',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'notifications/publish',
    name: 'NotificationPublish',
    title: '通知发布',
    roles: [Role.ADMIN],
    Component: null,
  },
  {
    path: 'notifications/manage',
    name: 'NotificationManage',
    title: '通知管理',
    roles: [Role.ADMIN],
    Component: null,
  },
];

export function renderRouteElement(route: AsyncRouteConfig): ReactNode {
  const PageComponent = route.Component;
  if (!PageComponent) return <PlaceholderPage title={route.title} />;
  return <PageComponent />;
}

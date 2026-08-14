// 主布局，提供导航、用户菜单、通知入口和页面内容区域。
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  Dropdown,
  Empty,
  Layout,
  Menu,
  Popover,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  ExportOutlined,
  FieldTimeOutlined,
  InboxOutlined,
  LineChartOutlined,
  LogoutOutlined,
  NotificationOutlined,
  RobotOutlined,
  SendOutlined,
  SwapOutlined,
  SyncOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserDeleteOutlined,
  UserOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useMatches, useNavigate } from 'react-router';
import { Role } from '../types';
import { useAuthStore } from '../store/useAuthStore';
import {
  NOTIFICATION_COLOR_MAP,
  type NotificationItem,
  useNotificationStore,
} from '../store/useNotificationStore';
import { useAnnotationStore } from '../store/useAnnotationStore';
import { hasRouteRole } from '../utils/roleHelper';
import { ROLE_META } from '../utils/statusMeta';
import { preloadTemplateSchemas } from '../utils/templateSchemaHelper';
import {
  connectNotificationWS,
  disconnectNotificationWS,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notificationWebSocket';
import ErrorBoundary from '../components/ErrorBoundary';
import NetworkStatusBar from '../components/NetworkStatusBar';
import SkeletonLoader from '../components/SkeletonLoader';
import type { RouteHandle } from '../router/routes';
import './MainLayout.css';

interface NavItem {
  key: string;
  label: string;
  path: string;
  roles: Role[];
  icon: ReactNode;
  match?: string[];
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: '概览',
    path: '/dashboard',
    roles: [Role.ADMIN, Role.ANNOTATOR, Role.REVIEWER],
    icon: <DashboardOutlined />,
  },
  {
    key: 'annotate',
    label: '标注工作台',
    path: '/annotate',
    roles: [Role.ANNOTATOR],
    icon: <EditOutlined />,
  },
  {
    key: 'review',
    label: '审核工作台',
    path: '/review',
    roles: [Role.REVIEWER],
    icon: <AuditOutlined />,
  },
  {
    key: 'tasks',
    label: '任务',
    path: '/tasks',
    match: ['/tasks'],
    roles: [Role.ADMIN],
    icon: <InboxOutlined />,
  },
  {
    key: 'archive',
    label: '归档',
    path: '/archive',
    roles: [Role.ADMIN, Role.ANNOTATOR, Role.REVIEWER],
    icon: <InboxOutlined />,
  },
  {
    key: 'templates',
    label: '模板',
    path: '/templates',
    roles: [Role.ADMIN],
    icon: <EditOutlined />,
  },
  {
    key: 'template-builder',
    label: '搭建',
    path: '/templates/builder',
    roles: [Role.ADMIN],
    icon: <SendOutlined />,
  },
  {
    key: 'statistics',
    label: '统计',
    path: '/statistics',
    roles: [Role.ADMIN, Role.REVIEWER],
    icon: <BarChartOutlined />,
  },
  {
    key: 'monitoring',
    label: '监控',
    path: '/monitoring',
    roles: [Role.ADMIN],
    icon: <LineChartOutlined />,
  },
  {
    key: 'export',
    label: '导出',
    path: '/export',
    roles: [Role.ADMIN, Role.REVIEWER],
    icon: <ExportOutlined />,
  },
  {
    key: 'users',
    label: '用户管理',
    path: '/users',
    roles: [Role.ADMIN],
    icon: <TeamOutlined />,
  },
  {
    key: 'notification-publish',
    label: '发通知',
    path: '/notifications/publish',
    roles: [Role.ADMIN],
    icon: <SendOutlined />,
  },
  {
    key: 'notification-manage',
    label: '通知管理',
    path: '/notifications/manage',
    roles: [Role.ADMIN],
    icon: <NotificationOutlined />,
  },
];

const NOTIFICATION_LABEL_MAP: Record<string, string> = {
  review_approved: '通过',
  review_rejected: '驳回',
  ai_review_complete: '规则预审',
  task_assigned: '分配',
  task_unassigned: '取消分配',
  task_submitted: '提交',
  task_resubmitted: '重新提交',
  task_status_changed: '状态变更',
  task_due_soon: '即将逾期',
  owner_message: '负责人',
};

const NOTIFICATION_ICON_MAP: Record<string, ReactNode> = {
  review_approved: <CheckCircleOutlined />,
  review_rejected: <CloseCircleOutlined />,
  ai_review_complete: <RobotOutlined />,
  task_assigned: <UserAddOutlined />,
  task_unassigned: <UserDeleteOutlined />,
  task_submitted: <SendOutlined />,
  task_resubmitted: <SyncOutlined />,
  task_status_changed: <SwapOutlined />,
  task_due_soon: <FieldTimeOutlined />,
  owner_message: <NotificationOutlined />,
};

function getNotificationLabel(type: string): string {
  return NOTIFICATION_LABEL_MAP[type] || '通知';
}

function getNotificationIcon(type: string): ReactNode {
  return NOTIFICATION_ICON_MAP[type] || <BellOutlined />;
}

function getNotificationColor(type: string): string {
  return NOTIFICATION_COLOR_MAP[type] || '#8c8c8c';
}

function getStringData(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value ? value : null;
}

function getNotificationLink(notification: NotificationItem): string | null {
  const taskId = getStringData(notification.data, 'taskId');
  const dataItemId = getStringData(notification.data, 'dataItemId');
  const phase = getStringData(notification.data, 'phase');

  if (notification.type === 'review_rejected') {
    if (taskId && dataItemId) {
      return `/annotate?taskId=${encodeURIComponent(taskId)}&dataItemId=${encodeURIComponent(dataItemId)}`;
    }
    return taskId ? `/annotate?taskId=${encodeURIComponent(taskId)}` : '/annotate';
  }

  if (notification.type === 'task_resubmitted') {
    if (taskId && dataItemId) {
      return `/review?taskId=${encodeURIComponent(taskId)}&dataItemId=${encodeURIComponent(dataItemId)}`;
    }
    return taskId ? `/review?taskId=${encodeURIComponent(taskId)}` : '/review';
  }

  if (notification.type === 'task_submitted' || notification.type === 'ai_review_complete') {
    return taskId ? `/review?taskId=${encodeURIComponent(taskId)}` : '/review';
  }

  if (notification.type === 'task_status_changed') {
    return taskId ? `/tasks/detail?id=${encodeURIComponent(taskId)}` : '/tasks';
  }

  if (notification.type === 'task_due_soon') {
    if (phase === 'review') {
      return taskId ? `/review?taskId=${encodeURIComponent(taskId)}` : '/review';
    }
    return taskId ? `/annotate?taskId=${encodeURIComponent(taskId)}` : '/annotate';
  }

  if (notification.type === 'task_assigned') {
    return taskId ? `/annotate?taskId=${encodeURIComponent(taskId)}` : '/annotate';
  }

  return null;
}

function formatRelativeTime(timestamp: string): string {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return '';

  const diff = Date.now() - time;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

/** 每个登录会话只预加载一次模板结构。 */
let templateSchemasPreloaded = false;

export default function MainLayout() {
  const location = useLocation();
  const matches = useMatches();
  const navigate = useNavigate();

  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);

  const notifications = useNotificationStore((state) => state.notifications);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const panelOpen = useNotificationStore((state) => state.panelOpen);
  const connected = useNotificationStore((state) => state.connected);
  const notificationStore = useNotificationStore.getState;

  // 小屏幕自动折叠侧边栏，避免固定侧栏遮挡内容。
  const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const onMobileChange = (event: MediaQueryListEvent) => setCollapsed(event.matches);
    mobileQuery.addEventListener('change', onMobileChange);
    return () => mobileQuery.removeEventListener('change', onMobileChange);
  }, []);

  const role = user?.role;
  const menuItems = useMemo<MenuProps['items']>(() => {
    if (!role) return [];
    return NAV_ITEMS.filter((item) => hasRouteRole(role, item.roles)).map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label,
      onClick: () => void navigate(item.path),
    }));
  }, [role, navigate]);

  const selectedKeys = useMemo(() => {
    const match = NAV_ITEMS.filter((item) => hasRouteRole(role, item.roles))
      .filter((item) =>
        (item.match ?? [item.path]).some(
          (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
        ),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    return match ? [match.key] : [];
  }, [role, location.pathname]);

  const currentTitle = useMemo(() => {
    const withTitle = [...matches]
      .reverse()
      .find((match) => (match.handle as RouteHandle | undefined)?.title);
    return (withTitle?.handle as RouteHandle | undefined)?.title || 'LabelHub';
  }, [matches]);

  const roleInfo = role ? ROLE_META[role] : null;

  // 通知连接跟随当前登录状态建立和释放。
  const userId = user?.id;
  useEffect(() => {
    const store = notificationStore();
    if (userId && token) {
      store.setCurrentUser(userId);
      store.setPanelOpen(false);
      void store.fetchNotifications();
      connectNotificationWS(token);

      if (!templateSchemasPreloaded) {
        templateSchemasPreloaded = true;
        void preloadTemplateSchemas();
      }

      return () => {
        disconnectNotificationWS();
        notificationStore().setConnected(false);
      };
    }

    templateSchemasPreloaded = false;
    disconnectNotificationWS();
    store.setConnected(false);
    store.setCurrentUser(null);
    return undefined;
  }, [userId, token, notificationStore]);

  // 路由切换时将实际滚动容器回到顶部。
  const contentRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  async function handleLogout() {
    // 清除会话前先释放编辑锁，此时请求仍带有有效凭证。
    await useAnnotationStore.getState().releaseAllMyItems();
    disconnectNotificationWS();
    const store = notificationStore();
    store.setConnected(false);
    store.setCurrentUser(null);
    await logout();
    await navigate('/login', { replace: true });
  }

  function handleMarkAllRead() {
    notificationStore().markAllAsRead();
    markAllNotificationsRead();
  }

  async function handleNotificationClick(notification: NotificationItem) {
    const store = notificationStore();
    store.markAsRead(notification.id);
    markNotificationRead(notification.id);

    const link = getNotificationLink(notification);
    if (!link) return;

    store.setPanelOpen(false);
    await navigate(link);
  }

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'status',
      disabled: true,
      icon: connected ? <WifiOutlined /> : <DisconnectOutlined />,
      label: connected ? '实时已连接' : '实时未连接',
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => void handleLogout(),
    },
  ];

  const notificationPanel = (
    <div className="notification-panel">
      <div className="notification-panel__header">
        <div className="notification-panel__title">
          <span>通知</span>
          {unreadCount > 0 && <Tag color="red">{unreadCount} 条未读</Tag>}
        </div>
        <div className="notification-panel__tools">
          <Tooltip title={connected ? '实时通知已连接' : '实时通知未连接'}>
            {connected ? (
              <WifiOutlined className="notification-panel__status notification-panel__status--online" />
            ) : (
              <DisconnectOutlined className="notification-panel__status notification-panel__status--offline" />
            )}
          </Tooltip>
          {unreadCount > 0 && (
            <Button
              type="link"
              size="small"
              icon={<CheckOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                handleMarkAllRead();
              }}
            >
              全部已读
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                notificationStore().clearAll();
              }}
            >
              清空
            </Button>
          )}
        </div>
      </div>

      <div className="notification-panel__body">
        {notifications.length === 0 ? (
          <Empty className="notification-panel__empty" description="暂无通知" />
        ) : (
          notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`notification-panel__item${item.read ? '' : ' notification-panel__item--unread'}`}
              style={
                { '--notification-color': getNotificationColor(item.type) } as React.CSSProperties
              }
              onClick={() => void handleNotificationClick(item)}
            >
              <span className="notification-panel__item-icon">
                {getNotificationIcon(item.type)}
              </span>
              <span className="notification-panel__item-main">
                <span className="notification-panel__item-title">
                  <span className="notification-panel__item-name">{item.title}</span>
                  <Tag
                    color={getNotificationColor(item.type)}
                    className="notification-panel__item-tag"
                  >
                    {getNotificationLabel(item.type)}
                  </Tag>
                  {item.priority === 'high' && (
                    <Tag color="red" className="notification-panel__item-tag">
                      重要
                    </Tag>
                  )}
                </span>
                <span className="notification-panel__item-message">{item.message}</span>
                <span className="notification-panel__item-meta">
                  {formatRelativeTime(item.timestamp)}
                  {item.sender && item.sender !== 'system' && item.sender !== '规则系统'
                    ? ` 来自 ${item.sender}`
                    : null}
                </span>
              </span>
              <Tooltip title="删除">
                <Button
                  type="text"
                  size="small"
                  className="notification-panel__delete"
                  icon={<DeleteOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    notificationStore().removeNotification(item.id);
                  }}
                />
              </Tooltip>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    // 只在主布局中提供消息、通知和弹窗上下文，避免扩大入口加载体积。
    <AntdApp>
      {/* 无障碍：跳过导航直达内容的隐藏链接（Tab 聚焦时可见） */}
      <a href="#main-content" className="skip-to-content">
        跳至内容
      </a>
      <Layout className={`labelhub-layout${collapsed ? ' labelhub-layout--collapsed' : ''}`}>
        <Layout.Sider
          className="labelhub-layout__sider"
          width={184}
          collapsedWidth={72}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="light"
        >
          <div className="labelhub-layout__brand">
            <span className="labelhub-layout__brand-logo" aria-hidden="true">
              <span className="labelhub-layout__brand-dot labelhub-layout__brand-dot--blue" />
              <span className="labelhub-layout__brand-dot labelhub-layout__brand-dot--red" />
              <span className="labelhub-layout__brand-dot labelhub-layout__brand-dot--yellow" />
              <span className="labelhub-layout__brand-dot labelhub-layout__brand-dot--green" />
            </span>
            <span className="labelhub-layout__brand-mark">{collapsed ? 'LH' : 'LabelHub'}</span>
          </div>
          <Menu theme="light" mode="inline" selectedKeys={selectedKeys} items={menuItems} />
        </Layout.Sider>
        <Layout className="labelhub-layout__main">
          <NetworkStatusBar />
          <Layout.Header className="labelhub-layout__header">
            <div className="labelhub-layout__title">
              <Typography.Text strong className="labelhub-layout__route-title">
                {currentTitle}
              </Typography.Text>
            </div>
            <div className="labelhub-layout__actions">
              <Popover
                open={panelOpen}
                onOpenChange={(open) => notificationStore().setPanelOpen(open)}
                trigger="click"
                placement="bottomRight"
                arrow={false}
                content={notificationPanel}
              >
                <Badge count={unreadCount} size="small" offset={[-3, 3]}>
                  <Button
                    type="text"
                    className="labelhub-layout__icon-button"
                    title="通知"
                    icon={<BellOutlined />}
                  />
                </Badge>
              </Popover>

              <Dropdown placement="bottomRight" menu={{ items: userMenuItems }}>
                <button className="labelhub-layout__user" type="button">
                  <Avatar size="small" icon={<UserOutlined />} />
                  <span className="labelhub-layout__username">{user?.username ?? '-'}</span>
                  {roleInfo && (
                    <Tag color={roleInfo.color} className="labelhub-layout__role">
                      {roleInfo.label}
                    </Tag>
                  )}
                </button>
              </Dropdown>
            </div>
          </Layout.Header>
          <Layout.Content
            id="main-content"
            className="labelhub-layout__content"
            ref={contentRef as React.Ref<HTMLElement>}
          >
            <ErrorBoundary>
              {/* 列表页的筛选条件和滚动位置由各自的 store 保存。 */}
              <div className="labelhub-layout__page" key={location.pathname}>
                <Suspense fallback={<SkeletonLoader />}>
                  <Outlet />
                </Suspense>
              </div>
            </ErrorBoundary>
          </Layout.Content>
        </Layout>
      </Layout>
    </AntdApp>
  );
}

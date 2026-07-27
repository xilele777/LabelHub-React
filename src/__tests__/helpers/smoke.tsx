/**
 * 页面冒烟测试共享工具：任务数据工厂 + store 重置。
 *
 * 冒烟测试的 mock 边界约定：
 *   - 页面直调的 API 模块用 vi.mock 替换（如 api/task）
 *   - store 的 fetch action 用 setState 直接覆盖为 vi.fn()（zustand 允许替换 action 字段，
 *     比 mock api 模块更薄，测试只关心「组件 ↔ store」这一层）
 *   - WebSocket service 用部分 mock（importOriginal 展开后覆盖连接函数）
 */
import {
  Role,
  TaskStatus,
  TaskType,
  TaskOverdueStrategy,
  type TaskItem,
  type UserInfo,
} from '../../types';
import { useAuthStore } from '../../store/useAuthStore';
import { useListCacheStore, createInitialListCacheState } from '../../store/useListCacheStore';

export function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  // exactOptionalPropertyTypes 下 Partial 展开会引入 `| undefined`，测试工厂统一断言收窄
  return {
    id: 't001',
    name: '街景图像分类',
    description: '测试任务',
    type: TaskType.IMAGE_CLASSIFICATION,
    owner: 'owner',
    templateId: 'tpl001',
    templateName: '图像分类模板',
    instructions: '按说明标注',
    status: TaskStatus.IN_PROGRESS,
    createdAt: '2026-07-20T08:00:00.000Z',
    startsAt: null,
    dueAt: null,
    reminderHours: 24,
    overdueStrategy: TaskOverdueStrategy.REMIND_ONLY,
    reviewStartsAt: null,
    reviewDueAt: null,
    reviewReminderHours: 24,
    reviewOverdueStrategy: TaskOverdueStrategy.REMIND_ONLY,
    annotationTimeoutHours: 24,
    reviewTimeoutHours: 24,
    ...overrides,
  } as TaskItem;
}

export const ADMIN_USER: UserInfo = { id: 'u001', username: 'admin', role: Role.ADMIN };

/** 预置登录态（isAuthenticated 由 token+user 派生） */
export function signIn(user: UserInfo = ADMIN_USER) {
  useAuthStore.getState().setSession({ token: 'test-token', user });
}

/** 各测试间重置持久化与会话级 store，避免用例串味 */
export function resetSessionState() {
  localStorage.clear();
  useAuthStore.setState({
    user: null,
    token: null,
    loading: false,
    error: null,
    isAuthenticated: false,
    role: null,
  });
  useListCacheStore.setState(createInitialListCacheState());
}

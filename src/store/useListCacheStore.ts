import { create } from 'zustand';
import type { TaskStatus } from '../types';

/**
 * 列表页筛选/分页状态缓存。
 *
 * 替代 Vue 版 `<keep-alive include="TaskListPage,TemplateManagePage">`：React 没有原生的组件实例缓存，
 * 列表页在跳转到详情/编辑页时会真实卸载，回来时筛选条件与页码会丢失。这里把这部分状态放到 store，
 * 页面挂载时用它做初值，从而复现"从详情页返回仍停在原筛选与页码"的体验。
 *
 * 会话级：clearSession（登出 / 登录过期）时整体重置，避免残留到下一个登录用户。
 */

export interface TaskListCache {
  keyword: string;
  status: TaskStatus | null;
  page: number;
}

export interface TemplateManageCache {
  keyword: string;
  page: number;
}

interface ListCacheState {
  taskList: TaskListCache;
  templateManage: TemplateManageCache;
}

interface ListCacheActions {
  setTaskListCache(patch: Partial<TaskListCache>): void;
  setTemplateManageCache(patch: Partial<TemplateManageCache>): void;
  resetListCache(): void;
}

export type ListCacheStore = ListCacheState & ListCacheActions;

export function createInitialListCacheState(): ListCacheState {
  return {
    taskList: { keyword: '', status: null, page: 1 },
    templateManage: { keyword: '', page: 1 },
  };
}

export const useListCacheStore = create<ListCacheStore>()((set) => ({
  ...createInitialListCacheState(),

  setTaskListCache(patch) {
    set((state) => ({ taskList: { ...state.taskList, ...patch } }));
  },

  setTemplateManageCache(patch) {
    set((state) => ({ templateManage: { ...state.templateManage, ...patch } }));
  },

  resetListCache() {
    set(createInitialListCacheState());
  },
}));

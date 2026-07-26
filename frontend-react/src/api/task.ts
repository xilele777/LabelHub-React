/**
 * 任务相关 API
 */
import { get, post, put, del } from './request';
import type { TaskItem } from '../types';

export interface TaskListResult {
  items: TaskItem[];
  total: number;
}

/** 获取任务列表 */
export function getTaskList(params?: Record<string, unknown>) {
  return get<TaskListResult>('/tasks', params);
}

/** 获取单个任务 */
export function getTask(id: string) {
  return get<TaskItem>(`/tasks/${id}`);
}

/** 创建任务 */
export function createTask(data: Partial<TaskItem>) {
  return post<TaskItem>('/tasks', data);
}

/** 更新任务 */
export function updateTask(id: string, data: Partial<TaskItem>) {
  return put<TaskItem>(`/tasks/${id}`, data);
}

/** 删除任务 */
export function deleteTask(id: string) {
  return del<void>(`/tasks/${id}`);
}

/** 归档任务 */
export function archiveTask(id: string) {
  return put<TaskItem>(`/tasks/${id}/archive`, {});
}

/** 取消归档任务 */
export function unarchiveTask(id: string) {
  return put<TaskItem>(`/tasks/${id}/unarchive`, {});
}

/** 获取已归档任务列表 */
export function getArchivedTaskList(params?: Record<string, unknown>) {
  return get<TaskListResult>('/tasks', { ...params, archived: 'true' });
}

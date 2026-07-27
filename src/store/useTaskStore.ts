import { create } from 'zustand';
import { TaskStatus, type TaskItem } from '../types';
import * as taskApi from '../api/task';

export { TaskStatus };
export type { TaskItem };

export interface TaskState {
  tasks: TaskItem[];
  archivedTasks: TaskItem[];
  loading: boolean;
  error: string | null;
}

/** 派生字段：随 tasks 同步维护（Pinia 版为 computed） */
interface TaskDerived {
  activeTasks: TaskItem[];
  runningTasks: TaskItem[];
  taskTotal: number;
}

interface TaskActions {
  fetchTasks(): Promise<void>;
  fetchArchivedTasks(): Promise<void>;
  addTask(task: Partial<TaskItem>): Promise<void>;
  updateTask(id: string, updates: Partial<TaskItem>): Promise<void>;
  deleteTask(id: string): Promise<void>;
  publishTask(id: string): Promise<void>;
  endTask(id: string): Promise<void>;
  archiveTask(id: string): Promise<void>;
  unarchiveTask(id: string): Promise<void>;
}

export type TaskStore = TaskState & TaskDerived & TaskActions;

function withDerived(tasks: TaskItem[]) {
  return {
    tasks,
    activeTasks: tasks.filter((task) => !task.archived),
    runningTasks: tasks.filter((task) => task.status === TaskStatus.IN_PROGRESS),
    taskTotal: tasks.length,
  };
}

export function createInitialTaskState(): TaskState & TaskDerived {
  return {
    tasks: [],
    archivedTasks: [],
    loading: false,
    error: null,
    activeTasks: [],
    runningTasks: [],
    taskTotal: 0,
  };
}

export const useTaskStore = create<TaskStore>()((set, get) => {
  function replaceTask(nextTask: TaskItem) {
    set(withDerived(get().tasks.map((task) => (task.id === nextTask.id ? nextTask : task))));
  }

  return {
    ...createInitialTaskState(),

    async fetchTasks(): Promise<void> {
      set({ loading: true, error: null });
      try {
        const res = await taskApi.getTaskList();
        set(withDerived(res.data.items));
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '获取任务列表失败' });
      } finally {
        set({ loading: false });
      }
    },

    async fetchArchivedTasks(): Promise<void> {
      set({ loading: true, error: null });
      try {
        const res = await taskApi.getArchivedTaskList();
        set({ archivedTasks: res.data.items });
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '获取归档任务列表失败' });
      } finally {
        set({ loading: false });
      }
    },

    async addTask(task): Promise<void> {
      set({ loading: true, error: null });
      try {
        const res = await taskApi.createTask(task);
        set(withDerived([res.data, ...get().tasks]));
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '创建任务失败' });
        throw err;
      } finally {
        set({ loading: false });
      }
    },

    async updateTask(id, updates): Promise<void> {
      set({ error: null });
      try {
        const res = await taskApi.updateTask(id, updates);
        replaceTask(res.data);
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '更新任务失败' });
        throw err;
      }
    },

    async deleteTask(id): Promise<void> {
      set({ error: null });
      try {
        await taskApi.deleteTask(id);
        set(withDerived(get().tasks.filter((task) => task.id !== id)));
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '删除任务失败' });
      }
    },

    async publishTask(id): Promise<void> {
      set({ error: null });
      try {
        const res = await taskApi.updateTask(id, { status: TaskStatus.IN_PROGRESS });
        replaceTask(res.data);
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '发布任务失败' });
        throw err;
      }
    },

    async endTask(id): Promise<void> {
      set({ error: null });
      try {
        const res = await taskApi.updateTask(id, { status: TaskStatus.ENDED });
        replaceTask(res.data);
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '结束任务失败' });
        throw err;
      }
    },

    async archiveTask(id): Promise<void> {
      set({ error: null });
      try {
        const res = await taskApi.archiveTask(id);
        const { tasks, archivedTasks } = get();
        set({
          ...withDerived(tasks.filter((task) => task.id !== id)),
          archivedTasks: [res.data, ...archivedTasks],
        });
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '归档任务失败' });
        throw err;
      }
    },

    async unarchiveTask(id): Promise<void> {
      set({ error: null });
      try {
        const res = await taskApi.unarchiveTask(id);
        const { tasks, archivedTasks } = get();
        set({
          ...withDerived([res.data, ...tasks]),
          archivedTasks: archivedTasks.filter((task) => task.id !== id),
        });
      } catch (err: unknown) {
        set({ error: err instanceof Error ? err.message : '取消归档失败' });
        throw err;
      }
    },
  };
});

// 模板列表及模板编辑相关的全局状态。
import { create } from 'zustand';
import type { TemplateItem } from '../types';
import * as templateApi from '../api/template';

export type { TemplateItem };

export interface TemplateState {
  templates: TemplateItem[];
  loading: boolean;
  error: string | null;
}

/** 派生字段：随 templates 同步维护（Pinia 版为 computed） */
interface TemplateDerived {
  templateCount: number;
  templateMap: Map<string, TemplateItem>;
}

interface TemplateActions {
  fetchTemplates(): Promise<void>;
  addTemplate(template: TemplateItem): Promise<void>;
  updateTemplate(id: string, updates: Partial<TemplateItem>): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
}

export type TemplateStore = TemplateState & TemplateDerived & TemplateActions;

let nextId = 100;

function withDerived(templates: TemplateItem[]) {
  return {
    templates,
    templateCount: templates.length,
    templateMap: new Map(templates.map((template) => [template.id, template])),
  };
}

export function createInitialTemplateState(): TemplateState & TemplateDerived {
  return {
    templates: [],
    loading: false,
    error: null,
    templateCount: 0,
    templateMap: new Map(),
  };
}

export const useTemplateStore = create<TemplateStore>()((set, get) => ({
  ...createInitialTemplateState(),

  async fetchTemplates(): Promise<void> {
    set({ loading: true, error: null });
    try {
      const res = await templateApi.getTemplateList();
      set(withDerived(res.data.items));
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : '获取模板列表失败' });
    } finally {
      set({ loading: false });
    }
  },

  async addTemplate(template): Promise<void> {
    set({ loading: true, error: null });
    try {
      const res = await templateApi.createTemplate(template);
      set(withDerived([res.data, ...get().templates]));
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : '创建模板失败' });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  async updateTemplate(id, updates): Promise<void> {
    set({ error: null });
    try {
      const res = await templateApi.updateTemplate(id, updates);
      set(
        withDerived(get().templates.map((template) => (template.id === id ? res.data : template))),
      );
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : '更新模板失败' });
      throw err;
    }
  },

  async deleteTemplate(id): Promise<void> {
    set({ error: null });
    try {
      await templateApi.deleteTemplate(id);
      set(withDerived(get().templates.filter((template) => template.id !== id)));
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : '删除模板失败' });
      throw err;
    }
  },
}));

export function generateTemplateId(): string {
  return 'tpl' + String(nextId++).padStart(3, '0');
}

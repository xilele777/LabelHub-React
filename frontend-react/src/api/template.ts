/**
 * 模板相关 API
 */
import { get, post, put, del } from './request';
import type { TemplateItem, AnnotationTemplate } from '../types';

export interface TemplateListResult {
  items: TemplateItem[];
  total: number;
}

/** 获取模板列表 */
export function getTemplateList(params?: Record<string, unknown>) {
  return get<TemplateListResult>('/templates', params);
}

/** 获取单个模板 */
export function getTemplate(id: string) {
  return get<TemplateItem>(`/templates/${id}`);
}

/** 创建模板 */
export function createTemplate(data: Partial<TemplateItem> & { schema?: AnnotationTemplate }) {
  return post<TemplateItem>('/templates', data);
}

/** 更新模板 */
export function updateTemplate(
  id: string,
  data: Partial<TemplateItem> & { schema?: AnnotationTemplate },
) {
  return put<TemplateItem>(`/templates/${id}`, data);
}

/** 删除模板 */
export function deleteTemplate(id: string) {
  return del<void>(`/templates/${id}`);
}

/** 获取用户列表（供下拉选择负责人用） */
export function getUserList() {
  return get<{ items: Array<{ id: string; username: string; role: string }>; total: number }>(
    '/users',
  );
}

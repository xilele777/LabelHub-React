/**
 * 模板字段取值与规则的纯函数工具（表单渲染与预审引擎共用）
 */
import type { FieldOption, TemplateField } from '../../types';

export function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function getOptions(field: TemplateField) {
  if (!('options' in field)) return [];
  return (field.options as FieldOption[]).map((option) => ({
    label: option.label,
    value: option.value,
  }));
}

export function getDirection(field: TemplateField) {
  return 'direction' in field && field.direction ? field.direction : 'vertical';
}

export function getTitleLevel(field: TemplateField) {
  const level = getNumberField(field, 'level', 4);
  return Math.min(Math.max(level ?? 4, 1), 5);
}

export function getStringField(field: TemplateField, key: string, fallback = '') {
  const value = (field as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : fallback;
}

export function getNumberField(field: TemplateField, key: string, fallback?: number) {
  const value = (field as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : fallback;
}

export function getBooleanField(field: TemplateField, key: string) {
  return Boolean((field as unknown as Record<string, unknown>)[key]);
}

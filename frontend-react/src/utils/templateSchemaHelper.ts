/**
 * 模板 Schema 辅助工具
 * 根据模板 ID 获取完整的标注模板 Schema。
 *
 * 数据来源：API GET /api/templates/:id（服务端返回的 fields 字段）
 * 本地维护一份内存缓存，避免重复请求。
 */
import { logger } from './logger';
import { type AnnotationTemplate, type TemplateField, type TemplateItem } from '../types';
import * as templateApi from '../api/template';

/** 内存缓存：templateId → AnnotationTemplate */
const schemaCache = new Map<string, AnnotationTemplate>();

/**
 * 将服务端模板数据（含 fields 数组）转换为 AnnotationTemplate
 */
function serverTemplateToSchema(
  item: TemplateItem & { fields?: TemplateField[] },
): AnnotationTemplate {
  const fields = item.fields || [];
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    fields,
    version: 1,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.createdAt || new Date().toISOString(),
  };
}

/**
 * 根据模板 ID 异步获取标注模板 Schema
 * 优先从缓存读取，缓存未命中则从 API 获取。
 */
export async function getTemplateSchemaAsync(
  templateId: string,
): Promise<AnnotationTemplate | undefined> {
  // 1. 缓存命中
  const cached = schemaCache.get(templateId);
  if (cached) return cached;

  // 2. 从 API 获取
  try {
    const res = await templateApi.getTemplate(templateId);
    const schema = serverTemplateToSchema(res.data as TemplateItem & { fields?: TemplateField[] });
    schemaCache.set(templateId, schema);
    return schema;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[templateSchemaHelper] Failed to fetch template "${templateId}":`, message);
    throw err;
  }
}

/**
 * 同步获取缓存的模板 Schema（不发起 API 请求）
 * 适用于已预加载的场景，若缓存未命中返回 undefined
 */
export function getTemplateSchema(templateId: string): AnnotationTemplate | undefined {
  return schemaCache.get(templateId);
}

/**
 * 预加载：批量获取所有模板 Schema 并写入缓存
 * 建议在应用启动或页面初始化时调用
 */
export async function preloadTemplateSchemas(): Promise<void> {
  try {
    const res = await templateApi.getTemplateList();
    const items = res.data.items || [];
    for (const item of items) {
      const itemWithFields = item as TemplateItem & { fields?: TemplateField[] };
      if (
        itemWithFields.fields &&
        Array.isArray(itemWithFields.fields) &&
        itemWithFields.fields.length > 0
      ) {
        const schema = serverTemplateToSchema(itemWithFields);
        schemaCache.set(schema.id, schema);
      }
    }
    logger.log(`[templateSchemaHelper] Preloaded ${schemaCache.size} template schemas`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('[templateSchemaHelper] Preload failed:', message);
  }
}

/** 清除缓存（用于测试或强制刷新） */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

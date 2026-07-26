import { FieldType, type TemplateField, type FieldOption } from '../../../types';

/** Schema 校验结果 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  fields: TemplateField[];
}

const VALID_FIELD_TYPES = new Set<string>(Object.values(FieldType));

/** 为导入的选项确保稳定 id */
function ensureOptionIds(options: FieldOption[]): FieldOption[] {
  return options.map((opt, i) => ({
    id: opt.id || `opt_imported_${i}`,
    label: typeof opt.label === 'string' ? opt.label : '选项',
    value: typeof opt.value === 'string' ? opt.value : `val_${i}`,
  }));
}

/** 为导入的字段确保稳定 id */
function ensureFieldId(id: unknown, index: number): string {
  return typeof id === 'string' && id.trim() ? id.trim() : `field_imported_${index}`;
}

/**
 * 校验并清洗导入的 Schema 数据
 *
 * 校验策略：
 *   1. 顶层必须是非 null 对象
 *   2. fields 必须是数组
 *   3. 每个字段必须包含合法 type (FieldType 枚举值)
 *   4. 字段属性类型逐一检查，不合法的给默认值而非丢弃整个字段
 *   5. radio/checkbox/select 的 options 缺失时自动补空数组
 *   6. 完全无法解析的字段跳过并收集 error
 */
export function validateImportSchema(raw: unknown): SchemaValidationResult {
  const errors: string[] = [];

  // 1. Top-level must be a non-null object
  if (raw === null || typeof raw !== 'object') {
    return { valid: false, errors: ['导入内容不是有效的 JSON 对象'], fields: [] };
  }

  const data = raw as Record<string, unknown>;

  // 2. fields must be an array
  if (!Array.isArray(data.fields)) {
    return { valid: false, errors: ['缺少 fields 字段或 fields 不是数组'], fields: [] };
  }

  // 3. Validate each field
  const sanitizedFields: TemplateField[] = [];

  data.fields.forEach((item: unknown, index: number) => {
    if (item === null || typeof item !== 'object') {
      errors.push(`fields[${index}]: 不是有效对象，已跳过`);
      return;
    }

    const field = item as Record<string, unknown>;

    // 3a. type is required and must be a known FieldType
    if (typeof field.type !== 'string' || !VALID_FIELD_TYPES.has(field.type)) {
      errors.push(`fields[${index}]: type 缺失或不合法 ("${String(field.type)}")，已跳过`);
      return;
    }

    // 3b. Build a safe base
    const id = ensureFieldId(field.id, index);
    const type = field.type as FieldType;
    const label = typeof field.label === 'string' ? field.label : '';
    const fieldKey = typeof field.fieldKey === 'string' ? field.fieldKey : '';
    const required = typeof field.required === 'boolean' ? field.required : false;
    const placeholder = typeof field.placeholder === 'string' ? field.placeholder : '';
    const description = typeof field.description === 'string' ? field.description : '';

    const base = { id, type, fieldKey, label, required, placeholder, description };

    // 3c. Type-specific validation
    switch (type) {
      case FieldType.INPUT: {
        const maxLength = typeof field.maxLength === 'number' ? field.maxLength : undefined;
        sanitizedFields.push({ ...base, type, maxLength } as TemplateField);
        break;
      }

      case FieldType.TEXTAREA: {
        const autoSize = typeof field.autoSize === 'boolean' ? field.autoSize : undefined;
        const maxLength = typeof field.maxLength === 'number' ? field.maxLength : undefined;
        sanitizedFields.push({ ...base, type, autoSize, maxLength } as TemplateField);
        break;
      }

      case FieldType.RADIO: {
        if (!Array.isArray(field.options)) {
          errors.push(`fields[${index}]: radio 缺少 options，已自动补空`);
        }
        const options = ensureOptionIds(Array.isArray(field.options) ? field.options : []);
        const direction =
          field.direction === 'horizontal' || field.direction === 'vertical'
            ? field.direction
            : 'vertical';
        sanitizedFields.push({ ...base, type, options, direction } as TemplateField);
        break;
      }

      case FieldType.CHECKBOX: {
        if (!Array.isArray(field.options)) {
          errors.push(`fields[${index}]: checkbox 缺少 options，已自动补空`);
        }
        const options = ensureOptionIds(Array.isArray(field.options) ? field.options : []);
        const direction =
          field.direction === 'horizontal' || field.direction === 'vertical'
            ? field.direction
            : 'horizontal';
        const maxCheck = typeof field.maxCheck === 'number' ? field.maxCheck : undefined;
        sanitizedFields.push({ ...base, type, options, direction, maxCheck } as TemplateField);
        break;
      }

      case FieldType.SELECT: {
        if (!Array.isArray(field.options)) {
          errors.push(`fields[${index}]: select 缺少 options，已自动补空`);
        }
        const options = ensureOptionIds(Array.isArray(field.options) ? field.options : []);
        const searchable = typeof field.searchable === 'boolean' ? field.searchable : false;
        const multiple = typeof field.multiple === 'boolean' ? field.multiple : undefined;
        sanitizedFields.push({ ...base, type, options, searchable, multiple } as TemplateField);
        break;
      }

      case FieldType.RATING: {
        const maxScore =
          typeof field.maxScore === 'number' && field.maxScore > 0 ? field.maxScore : 5;
        const allowHalf = typeof field.allowHalf === 'boolean' ? field.allowHalf : false;
        sanitizedFields.push({ ...base, type, maxScore, allowHalf } as TemplateField);
        break;
      }

      case FieldType.SWITCH: {
        const defaultValue = typeof field.defaultValue === 'boolean' ? field.defaultValue : false;
        const checkedChildren =
          typeof field.checkedChildren === 'string' ? field.checkedChildren : undefined;
        const unCheckedChildren =
          typeof field.unCheckedChildren === 'string' ? field.unCheckedChildren : undefined;
        sanitizedFields.push({
          ...base,
          type,
          defaultValue,
          checkedChildren,
          unCheckedChildren,
        } as TemplateField);
        break;
      }

      case FieldType.TITLE: {
        const content = typeof field.content === 'string' ? field.content : '';
        const level = [1, 2, 3, 4, 5].includes(field.level as number)
          ? (field.level as 1 | 2 | 3 | 4 | 5)
          : 4;
        sanitizedFields.push({
          id,
          type,
          fieldKey: '',
          label,
          content,
          description,
          level,
        } as TemplateField);
        break;
      }

      default: {
        void type;
        errors.push(`fields[${index}]: 不支持的字段类型 "${String(type)}"，已跳过`);
      }
    }
  });

  if (sanitizedFields.length === 0 && data.fields.length > 0) {
    errors.push('所有字段均校验失败，无法恢复任何字段');
  }

  return {
    valid: errors.length === 0,
    errors,
    fields: sanitizedFields,
  };
}

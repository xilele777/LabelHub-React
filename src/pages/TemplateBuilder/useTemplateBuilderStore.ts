import { create } from 'zustand';
import { logger } from '../../utils/logger';
import {
  FieldType,
  TaskType,
  type CheckboxField,
  type FieldOption,
  type InputField,
  type RadioField,
  type RatingField,
  type SelectField,
  type SwitchField,
  type TemplateField,
  type TextareaField,
  type TitleField,
} from '../../types';
import * as templateApi from '../../api/template';
import { clearSchemaCache } from '../../utils/templateSchemaHelper';

export { FieldType, TaskType };
export type {
  CheckboxField,
  FieldOption,
  InputField,
  RadioField,
  RatingField,
  SelectField,
  SwitchField,
  TemplateField,
  TextareaField,
  TitleField,
};

export type TemplateBuilderMode = 'create' | 'edit';

export interface TemplateMeta {
  name: string;
  description: string;
  type: TaskType;
}

export interface TemplateBuilderState {
  fields: TemplateField[];
  selectedFieldId: string | null;
  templateId: string | null;
  mode: TemplateBuilderMode;
  templateMeta: TemplateMeta;
  loading: boolean;
  saving: boolean;
}

interface TemplateBuilderActions {
  addField(type: FieldType): void;
  /** dnd-kit 从物料区拖入画布时按落点插入（Vue 版由 sortablejs clone 机制隐式完成） */
  insertField(field: TemplateField, index: number): void;
  removeField(id: string): void;
  selectField(id: string | null): void;
  updateField(id: string, updates: Partial<TemplateField>): void;
  moveField(fromIndex: number, toIndex: number): void;
  loadFields(nextFields: TemplateField[]): void;
  loadTemplate(id: string): Promise<void>;
  initCreateMode(): void;
  saveTemplate(creator?: string): Promise<string>;
  setTemplateMeta(meta: Partial<TemplateMeta>): void;
  reset(): void;
}

export type TemplateBuilderStore = TemplateBuilderState & TemplateBuilderActions;

let fieldSeq = 0;
let optSeq = 0;

function nextId(): string {
  fieldSeq += 1;
  return `field_${Date.now().toString(36)}_${fieldSeq}`;
}

function nextOptId(): string {
  optSeq += 1;
  return `opt_${Date.now().toString(36)}_${optSeq}`;
}

function makeOption(label: string, value: string): FieldOption {
  return { id: nextOptId(), label, value };
}

function defaultFieldKey(type: FieldType): string {
  return `${type}_${fieldSeq}`;
}

export function createDefaultField(type: FieldType): TemplateField {
  const id = nextId();
  const base = {
    id,
    fieldKey: defaultFieldKey(type),
    label: '',
    required: false,
    placeholder: '',
    description: '',
  };

  switch (type) {
    case FieldType.INPUT:
      return {
        ...base,
        type,
        label: '单行输入',
        placeholder: '请输入',
        maxLength: 200,
      } satisfies InputField;
    case FieldType.TEXTAREA:
      return {
        ...base,
        type,
        label: '多行文本',
        placeholder: '请输入',
        autoSize: true,
      } satisfies TextareaField;
    case FieldType.RADIO:
      return {
        ...base,
        type,
        label: '单选',
        options: [makeOption('选项1', 'opt1'), makeOption('选项2', 'opt2')],
        direction: 'vertical',
      } satisfies RadioField;
    case FieldType.CHECKBOX:
      return {
        ...base,
        type,
        label: '多选',
        options: [makeOption('选项1', 'opt1'), makeOption('选项2', 'opt2')],
        direction: 'horizontal',
      } satisfies CheckboxField;
    case FieldType.SELECT:
      return {
        ...base,
        type,
        label: '下拉选择',
        placeholder: '请选择',
        options: [makeOption('选项1', 'opt1'), makeOption('选项2', 'opt2')],
        searchable: false,
      } satisfies SelectField;
    case FieldType.RATING:
      return { ...base, type, label: '评分', maxScore: 5, allowHalf: false } satisfies RatingField;
    case FieldType.SWITCH:
      return {
        ...base,
        type,
        label: '开关',
        defaultValue: false,
        checkedChildren: '是',
        unCheckedChildren: '否',
      } satisfies SwitchField;
    case FieldType.TITLE:
      return {
        ...base,
        type,
        fieldKey: '',
        label: '说明标题',
        content: '',
        description: '说明文字',
        level: 4,
      } satisfies TitleField;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

const DEFAULT_META: TemplateMeta = {
  name: '新建模板',
  description: '',
  type: TaskType.IMAGE_CLASSIFICATION,
};

export function createInitialBuilderState(): TemplateBuilderState {
  return {
    fields: [],
    selectedFieldId: null,
    templateId: null,
    mode: 'create',
    templateMeta: { ...DEFAULT_META },
    loading: false,
    saving: false,
  };
}

export const useTemplateBuilderStore = create<TemplateBuilderStore>()((set, get) => ({
  ...createInitialBuilderState(),

  addField(type) {
    const field = createDefaultField(type);
    set((state) => ({ fields: [...state.fields, field], selectedFieldId: field.id }));
  },

  insertField(field, index) {
    set((state) => {
      const fields = [...state.fields];
      const clamped = Math.max(0, Math.min(index, fields.length));
      fields.splice(clamped, 0, field);
      return { fields, selectedFieldId: field.id };
    });
  },

  removeField(id) {
    set((state) => ({
      fields: state.fields.filter((field) => field.id !== id),
      selectedFieldId: state.selectedFieldId === id ? null : state.selectedFieldId,
    }));
  },

  selectField(id) {
    set({ selectedFieldId: id });
  },

  updateField(id, updates) {
    set((state) => ({
      fields: state.fields.map((field) =>
        field.id === id ? ({ ...field, ...updates } as TemplateField) : field,
      ),
    }));
  },

  moveField(fromIndex, toIndex) {
    set((state) => {
      const fields = [...state.fields];
      const [removed] = fields.splice(fromIndex, 1);
      if (!removed) return {};
      fields.splice(toIndex, 0, removed);
      return { fields };
    });
  },

  loadFields(nextFields) {
    set((state) => {
      // 同一批字段仅重排（拖拽排序）时保留选中；集合变化（导入/加载）则清空选中
      const sameSet =
        nextFields.length === state.fields.length &&
        nextFields.every((field) => state.fields.some((current) => current.id === field.id));
      const keepSelection =
        sameSet &&
        state.selectedFieldId !== null &&
        nextFields.some((field) => field.id === state.selectedFieldId);
      return { fields: nextFields, selectedFieldId: keepSelection ? state.selectedFieldId : null };
    });
  },

  async loadTemplate(id) {
    set({ loading: true, templateId: id, mode: 'edit' });
    try {
      const res = await templateApi.getTemplate(id);
      const data = res.data;
      set({
        templateMeta: {
          name: data.name || '',
          description: data.description || '',
          type: data.type || TaskType.IMAGE_CLASSIFICATION,
        },
        fields: data.fields || [],
        selectedFieldId: null,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载模板失败';
      logger.error('[TemplateBuilder] Failed to load template:', message);
    } finally {
      set({ loading: false });
    }
  },

  initCreateMode() {
    set({
      templateId: null,
      mode: 'create',
      templateMeta: { ...DEFAULT_META },
      fields: [],
      selectedFieldId: null,
    });
  },

  async saveTemplate(creator) {
    set({ saving: true });
    try {
      const { mode, templateId, templateMeta, fields } = get();
      if (mode === 'create' || !templateId) {
        const payload = {
          name: templateMeta.name || '新建模板',
          description: templateMeta.description || '',
          type: templateMeta.type,
          fieldCount: fields.length,
          fields,
          creator: creator || 'unknown',
        };

        const res = await templateApi.createTemplate(payload);
        set({ templateId: res.data.id, mode: 'edit' });
        clearSchemaCache();
        return res.data.id;
      }

      await templateApi.updateTemplate(templateId, {
        name: templateMeta.name,
        description: templateMeta.description,
        type: templateMeta.type,
        fieldCount: fields.length,
        fields,
      });
      clearSchemaCache();
      return templateId;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '保存模板失败';
      logger.error('[TemplateBuilder] Failed to save template:', message);
      throw err;
    } finally {
      set({ saving: false });
    }
  },

  setTemplateMeta(meta) {
    set((state) => ({ templateMeta: { ...state.templateMeta, ...meta } }));
  },

  reset() {
    set(createInitialBuilderState());
  },
}));

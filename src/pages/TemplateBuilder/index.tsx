// 模板构建器，编辑字段结构、选项和校验规则。
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  AlignLeftOutlined,
  ArrowLeftOutlined,
  AudioOutlined,
  CheckSquareOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownCircleOutlined,
  ExportOutlined,
  FormOutlined,
  HolderOutlined,
  ImportOutlined,
  ReadOutlined,
  SaveOutlined,
  StarOutlined,
  SwapOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  FieldType,
  TaskType,
  type CheckboxField,
  type FieldOption,
  type RadioField,
  type SelectField,
  type TemplateField,
} from '../../types';
import { useAuthStore } from '../../store/useAuthStore';
import {
  createDefaultField,
  useTemplateBuilderStore,
  type TemplateMeta,
} from './useTemplateBuilderStore';
import { validateImportSchema } from './utils/validateSchema';
import PropertyPanel, { type ConfigItem } from './components/PropertyPanel';
import './TemplateBuilder.css';

interface PaletteItem {
  type: FieldType;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

type DragData = { source: 'palette'; type: FieldType } | { source: 'canvas' };

type ActiveDrag = { source: 'palette'; type: FieldType } | { source: 'canvas'; fieldId: string };

const CANVAS_DROP_ID = 'template-canvas';

const taskTypeOptions = [
  { value: TaskType.IMAGE_CLASSIFICATION, label: '图像分类' },
  { value: TaskType.OBJECT_DETECTION, label: '目标检测' },
  { value: TaskType.SEMANTIC_SEGMENTATION, label: '语义分割' },
  { value: TaskType.TEXT_NER, label: '文本 NER' },
];

const paletteItems: PaletteItem[] = [
  { type: FieldType.INPUT, label: '单行输入', icon: FormOutlined },
  { type: FieldType.TEXTAREA, label: '多行文本', icon: AlignLeftOutlined },
  { type: FieldType.RADIO, label: '单选', icon: AudioOutlined },
  { type: FieldType.CHECKBOX, label: '多选', icon: CheckSquareOutlined },
  { type: FieldType.SELECT, label: '下拉选择', icon: DownCircleOutlined },
  { type: FieldType.RATING, label: '评分', icon: StarOutlined },
  { type: FieldType.SWITCH, label: '开关', icon: SwapOutlined },
  { type: FieldType.TITLE, label: '说明块', icon: ReadOutlined },
];

const fieldTypeLabelMap: Record<FieldType, string> = {
  [FieldType.INPUT]: '单行输入',
  [FieldType.TEXTAREA]: '多行文本',
  [FieldType.RADIO]: '单选',
  [FieldType.CHECKBOX]: '多选',
  [FieldType.SELECT]: '下拉选择',
  [FieldType.RATING]: '评分',
  [FieldType.SWITCH]: '开关',
  [FieldType.TITLE]: '说明块',
};

const fieldConfigMap: Record<FieldType, ConfigItem[]> = {
  [FieldType.INPUT]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 category' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'placeholder', label: '占位提示 (placeholder)', type: 'text', placeholder: '请输入' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    { key: 'maxLength', label: '最大长度 (maxLength)', type: 'number', min: 1, placeholder: '200' },
  ],
  [FieldType.TEXTAREA]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 content' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'placeholder', label: '占位提示 (placeholder)', type: 'text', placeholder: '请输入' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    { key: 'autoSize', label: '自适应高度 (autoSize)', type: 'switch' },
  ],
  [FieldType.RADIO]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 category' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    { key: 'options', label: '选项列表 (options)', type: 'options' },
    {
      key: 'direction',
      label: '排列方向',
      type: 'select',
      options: [
        { label: '垂直', value: 'vertical' },
        { label: '水平', value: 'horizontal' },
      ],
    },
  ],
  [FieldType.CHECKBOX]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 tags' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    { key: 'options', label: '选项列表 (options)', type: 'options' },
    {
      key: 'direction',
      label: '排列方向',
      type: 'select',
      options: [
        { label: '垂直', value: 'vertical' },
        { label: '水平', value: 'horizontal' },
      ],
    },
    { key: 'maxCheck', label: '最多可选数 (maxCheck)', type: 'number', min: 1 },
  ],
  [FieldType.SELECT]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 city' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'placeholder', label: '占位提示 (placeholder)', type: 'text', placeholder: '请选择' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    { key: 'options', label: '选项列表 (options)', type: 'options' },
    { key: 'searchable', label: '可搜索 (searchable)', type: 'switch' },
  ],
  [FieldType.RATING]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 score' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    {
      key: 'maxScore',
      label: '最高分 (maxScore)',
      type: 'number',
      min: 1,
      max: 10,
      placeholder: '5',
    },
    { key: 'allowHalf', label: '允许半星 (allowHalf)', type: 'switch' },
  ],
  [FieldType.SWITCH]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 enabled' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '字段标题' },
    { key: 'required', label: '必填 (required)', type: 'switch' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    { key: 'defaultValue', label: '默认值 (defaultValue)', type: 'switch' },
    {
      key: 'checkedChildren',
      label: '开启文字 (checkedChildren)',
      type: 'text',
      placeholder: '是',
    },
    {
      key: 'unCheckedChildren',
      label: '关闭文字 (unCheckedChildren)',
      type: 'text',
      placeholder: '否',
    },
  ],
  [FieldType.TITLE]: [
    { key: 'fieldKey', label: '字段标识 (fieldKey)', type: 'text', placeholder: '如 section1' },
    { key: 'label', label: '标题 (label)', type: 'text', placeholder: '说明标题' },
    { key: 'content', label: '说明正文 (content)', type: 'textarea', placeholder: '说明内容' },
    { key: 'description', label: '补充说明 (description)', type: 'textarea', placeholder: '可选' },
    {
      key: 'level',
      label: '标题级别 (level)',
      type: 'select',
      options: [1, 2, 3, 4, 5].map((value) => ({ label: `H${value}`, value })),
    },
  ],
};

function hasOptions(field: TemplateField): field is RadioField | CheckboxField | SelectField {
  return 'options' in field && Array.isArray(field.options);
}

function getDirection(field: TemplateField): 'horizontal' | 'vertical' {
  if ('direction' in field && field.direction) return field.direction;
  return 'vertical';
}

function getStringField(field: TemplateField, key: string, fallback: string): string {
  const value = (field as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : fallback;
}

function getNumberField(field: TemplateField, key: string, fallback: number): number {
  const value = (field as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : fallback;
}

function cleanFieldForSchema(field: TemplateField): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  Object.entries(field).forEach(([key, value]) => {
    if (value === '' || value === undefined || value === null) return;
    if (key === 'options' && Array.isArray(value)) {
      result.options = (value as FieldOption[]).map(({ label, value: optionValue }) => ({
        label,
        value: optionValue,
      }));
      return;
    }
    result[key] = value;
  });
  return result;
}

function formatSchemaJson(meta: TemplateMeta, fields: TemplateField[]): string {
  return JSON.stringify(
    {
      version: 1,
      meta: {
        name: meta.name,
        description: meta.description,
        type: meta.type,
      },
      fieldCount: fields.length,
      fields: fields.map(cleanFieldForSchema),
    },
    null,
    2,
  );
}

function validateBeforeSave(meta: TemplateMeta, fields: TemplateField[]): string | null {
  if (!meta.name.trim()) {
    return '请填写模板名称';
  }
  if (fields.length === 0) {
    return '请至少添加一个字段';
  }

  const keys = new Set<string>();
  for (const [index, field] of fields.entries()) {
    if (!field.label.trim()) {
      return `第 ${index + 1} 个字段缺少标题`;
    }
    if (field.type === FieldType.TITLE) {
      continue;
    }

    const key = field.fieldKey.trim();
    if (!key) {
      return `字段「${field.label}」缺少字段标识`;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return `字段「${field.label}」的字段标识只能使用字母、数字和下划线，且不能以数字开头`;
    }
    if (keys.has(key)) {
      return `字段标识「${key}」重复`;
    }
    keys.add(key);
  }

  return null;
}

/** 指针命中优先（物料拖入画布场景准确），无命中时退回矩形相交（快速拖动容错） */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
};

function FieldPreview({ field }: { field: TemplateField }) {
  if (field.type === FieldType.INPUT || field.type === FieldType.TEXTAREA) {
    return <>{field.placeholder || '请输入'}</>;
  }
  if (hasOptions(field)) {
    return (
      <Space direction={getDirection(field) === 'horizontal' ? 'horizontal' : 'vertical'} wrap>
        {field.options.map((option) => (
          <Tag key={option.id}>{option.label}</Tag>
        ))}
      </Space>
    );
  }
  if (field.type === FieldType.RATING) {
    return <>最高 {getNumberField(field, 'maxScore', 5)} 分</>;
  }
  if (field.type === FieldType.SWITCH) {
    return (
      <>
        {getStringField(field, 'checkedChildren', '是')} /{' '}
        {getStringField(field, 'unCheckedChildren', '否')}
      </>
    );
  }
  if (field.type === FieldType.TITLE) {
    return <>{getStringField(field, 'content', '') || '说明内容'}</>;
  }
  return null;
}

function PaletteItemButton({
  item,
  onAdd,
}: {
  item: PaletteItem;
  onAdd: (type: FieldType) => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `palette:${item.type}`,
    data: { source: 'palette', type: item.type } satisfies DragData,
  });
  const Icon = item.icon;

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`palette-item${isDragging ? ' drag-chosen' : ''}`}
      onClick={() => onAdd(item.type)}
      {...attributes}
      {...listeners}
    >
      <Icon className="palette-icon" />
      <span>{item.label}</span>
    </button>
  );
}

interface CanvasFieldCardProps {
  field: TemplateField;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function CanvasFieldCard({ field, selected, onSelect, onRemove }: CanvasFieldCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id, data: { source: 'canvas' } satisfies DragData });

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`canvas-field${selected ? ' canvas-field--selected' : ''}${isDragging ? ' drag-ghost' : ''}`}
      onClick={() => onSelect(field.id)}
    >
      <span ref={setActivatorNodeRef} className="field-drag-handle" {...attributes} {...listeners}>
        <HolderOutlined />
      </span>
      <Tag color="blue" className="field-type-tag">
        {fieldTypeLabelMap[field.type]}
      </Tag>

      <div className="field-content">
        <div className="field-title">
          {field.label || fieldTypeLabelMap[field.type]}
          {field.required && field.type !== FieldType.TITLE && (
            <Tag color="red" className="required-tag">
              必填
            </Tag>
          )}
        </div>
        {field.description && <div className="field-description">{field.description}</div>}
        <div className="field-preview">
          <FieldPreview field={field} />
        </div>
      </div>

      <Button
        type="text"
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(field.id);
        }}
      />
    </article>
  );
}

export default function TemplateBuilder() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const fields = useTemplateBuilderStore((state) => state.fields);
  const selectedFieldId = useTemplateBuilderStore((state) => state.selectedFieldId);
  const templateMeta = useTemplateBuilderStore((state) => state.templateMeta);
  const mode = useTemplateBuilderStore((state) => state.mode);
  const loading = useTemplateBuilderStore((state) => state.loading);
  const saving = useTemplateBuilderStore((state) => state.saving);

  const [rightTab, setRightTab] = useState('config');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  // 拖拽结束后浏览器可能补发 click，标记后抑制重复添加。
  const suppressPaletteClickRef = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { setNodeRef: setCanvasRef, isOver: isCanvasOver } = useDroppable({ id: CANVAS_DROP_ID });

  useEffect(() => {
    const templateId = searchParams.get('id');
    const queryMode = searchParams.get('mode');
    const store = useTemplateBuilderStore.getState();

    if (templateId) {
      void store.loadTemplate(templateId);
    } else if (queryMode === 'create' || !store.templateId) {
      store.initCreateMode();
    }

    return () => {
      useTemplateBuilderStore.getState().reset();
    };
  }, [searchParams]);

  const selectedField = useMemo(
    () => fields.find((field) => field.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );
  const isCreateMode = mode === 'create';
  const requiredCount = fields.filter(
    (field) => field.type !== FieldType.TITLE && field.required,
  ).length;
  const titleCount = fields.filter((field) => field.type === FieldType.TITLE).length;
  const currentConfigItems = selectedField ? fieldConfigMap[selectedField.type] : [];
  const selectedOptions = selectedField && hasOptions(selectedField) ? selectedField.options : [];
  const schemaJson = rightTab === 'schema' ? formatSchemaJson(templateMeta, fields) : '';

  function addFieldByClick(type: FieldType) {
    if (suppressPaletteClickRef.current) return;
    useTemplateBuilderStore.getState().addField(type);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    if (!data) return;
    if (data.source === 'palette') {
      setActiveDrag({ source: 'palette', type: data.type });
    } else {
      setActiveDrag({ source: 'canvas', fieldId: String(event.active.id) });
    }
  }

  function finishDrag() {
    setActiveDrag(null);
    suppressPaletteClickRef.current = true;
    setTimeout(() => {
      suppressPaletteClickRef.current = false;
    }, 0);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    finishDrag();
    if (!over) return;

    const data = active.data.current as DragData | undefined;
    const store = useTemplateBuilderStore.getState();
    const currentFields = store.fields;

    if (data?.source === 'palette') {
      const newField = createDefaultField(data.type);
      const overIndex =
        over.id === CANVAS_DROP_ID
          ? currentFields.length
          : currentFields.findIndex((field) => field.id === over.id);
      store.insertField(newField, overIndex < 0 ? currentFields.length : overIndex);
      setRightTab('config');
      return;
    }

    if (active.id === over.id) return;
    const fromIndex = currentFields.findIndex((field) => field.id === active.id);
    const toIndex =
      over.id === CANVAS_DROP_ID
        ? currentFields.length - 1
        : currentFields.findIndex((field) => field.id === over.id);
    if (fromIndex >= 0 && toIndex >= 0) {
      store.moveField(fromIndex, toIndex);
    }
  }

  function updateSelectedField(key: string, value: unknown) {
    if (!selectedField) return;
    useTemplateBuilderStore
      .getState()
      .updateField(selectedField.id, { [key]: value } as Partial<TemplateField>);
  }

  function updateOption(index: number, key: 'label' | 'value', value: string) {
    if (!selectedField || !hasOptions(selectedField)) return;
    const options = selectedField.options.map((option, currentIndex) =>
      currentIndex === index ? { ...option, [key]: value } : option,
    );
    useTemplateBuilderStore
      .getState()
      .updateField(selectedField.id, { options } as Partial<TemplateField>);
  }

  function addOption() {
    if (!selectedField || !hasOptions(selectedField)) return;
    const index = selectedField.options.length + 1;
    const option: FieldOption = {
      id: `opt_${Date.now().toString(36)}_${index}`,
      label: `选项${index}`,
      value: `opt${index}`,
    };
    useTemplateBuilderStore.getState().updateField(selectedField.id, {
      options: [...selectedField.options, option],
    } as Partial<TemplateField>);
  }

  function removeOption(index: number) {
    if (!selectedField || !hasOptions(selectedField)) return;
    const options = selectedField.options.filter((_, currentIndex) => currentIndex !== index);
    useTemplateBuilderStore
      .getState()
      .updateField(selectedField.id, { options } as Partial<TemplateField>);
  }

  function removeSelectedField() {
    if (!selectedField) return;
    useTemplateBuilderStore.getState().removeField(selectedField.id);
  }

  async function handleSave() {
    const validationError = validateBeforeSave(templateMeta, fields);
    if (validationError) {
      message.warning(validationError);
      return;
    }

    const store = useTemplateBuilderStore.getState();
    const wasCreateMode = store.mode === 'create';
    try {
      await store.saveTemplate(useAuthStore.getState().user?.username);
      message.success(wasCreateMode ? '模板创建成功' : '模板已保存');
      await navigate('/templates');
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message ? error.message : '保存失败，请重试';
      message.error(errorMessage);
    }
  }

  function copySchema() {
    if (fields.length === 0) {
      message.warning('画布为空，无法复制');
      return;
    }

    const json = formatSchemaJson(templateMeta, fields);
    navigator.clipboard
      .writeText(json)
      .then(() => message.success('Schema JSON 已复制到剪贴板'))
      .catch(() => message.error('复制失败，请手动复制'));
  }

  function exportSchema() {
    if (fields.length === 0) {
      message.warning('画布为空，无法导出');
      return;
    }

    const blob = new Blob([formatSchemaJson(templateMeta, fields)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `template-schema-${Date.now()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    message.success('Schema 已导出');
  }

  function resetImportModal() {
    setImportText('');
    setImportErrors([]);
  }

  function importSchema(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setImportErrors(['JSON 格式无效']);
      message.error('JSON 格式无效，请检查输入');
      return false;
    }

    const result = validateImportSchema(parsed);
    setImportErrors(result.errors);

    if (result.fields.length === 0) {
      message.error('导入失败：没有可恢复的字段');
      return false;
    }

    useTemplateBuilderStore.getState().loadFields(result.fields);
    message.success(`成功导入 ${result.fields.length} 个字段`);
    resetImportModal();
    setImportOpen(false);
    return true;
  }

  function importSchemaFromText() {
    if (!importText.trim()) return;
    importSchema(importText);
  }

  function importSchemaFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      importSchema(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      setImportErrors(['文件读取失败']);
      message.error('文件读取失败');
    };
    reader.readAsText(file);
    return false;
  }

  const activePaletteItem =
    activeDrag?.source === 'palette'
      ? paletteItems.find((item) => item.type === activeDrag.type)
      : undefined;
  const activeCanvasField =
    activeDrag?.source === 'canvas'
      ? fields.find((field) => field.id === activeDrag.fieldId)
      : undefined;

  return (
    <Spin spinning={loading}>
      <section className="template-builder">
        <header className="builder-toolbar">
          <Space align="center">
            <Button icon={<ArrowLeftOutlined />} onClick={() => void navigate('/templates')}>
              返回
            </Button>
            <Typography.Title level={4} className="builder-title">
              {isCreateMode ? '新建模板' : '编辑模板'}
            </Typography.Title>
          </Space>

          <Space wrap>
            <Tooltip title={isCreateMode ? '创建模板并保存到服务端' : '保存模板到服务端'}>
              <Button
                type="primary"
                loading={saving}
                icon={<SaveOutlined />}
                onClick={() => void handleSave()}
              >
                {isCreateMode ? '创建并保存' : '保存'}
              </Button>
            </Tooltip>
            <Tooltip title="复制当前 Schema JSON">
              <Button disabled={fields.length === 0} icon={<CopyOutlined />} onClick={copySchema}>
                复制 JSON
              </Button>
            </Tooltip>
            <Tooltip title="下载当前 Schema JSON 文件">
              <Button
                disabled={fields.length === 0}
                icon={<ExportOutlined />}
                onClick={exportSchema}
              >
                导出 JSON
              </Button>
            </Tooltip>
            <Tooltip title="从 JSON 文件或文本导入 Schema">
              <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
                导入 JSON
              </Button>
            </Tooltip>
          </Space>
        </header>

        <Card size="small" className="meta-card">
          <Form layout="inline" className="meta-form">
            <Form.Item label="模板名称">
              <Input
                value={templateMeta.name}
                placeholder="请输入模板名称"
                className="meta-input"
                onChange={(event) =>
                  useTemplateBuilderStore.getState().setTemplateMeta({ name: event.target.value })
                }
              />
            </Form.Item>
            <Form.Item label="模板描述">
              <Input
                value={templateMeta.description}
                placeholder="请输入模板描述"
                className="meta-desc-input"
                onChange={(event) =>
                  useTemplateBuilderStore
                    .getState()
                    .setTemplateMeta({ description: event.target.value })
                }
              />
            </Form.Item>
            <Form.Item label="任务类型">
              <Select
                value={templateMeta.type}
                options={taskTypeOptions}
                className="meta-select"
                onChange={(value: TaskType) =>
                  useTemplateBuilderStore.getState().setTemplateMeta({ type: value })
                }
              />
            </Form.Item>
          </Form>
        </Card>

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={finishDrag}
        >
          <div className="builder-main">
            <Card
              title="物料"
              size="small"
              className="palette-card"
              styles={{ body: { padding: '8px 12px' } }}
            >
              <Typography.Text type="secondary" className="palette-hint">
                拖入画布，或点击快速添加
              </Typography.Text>

              <div className="palette-list">
                {paletteItems.map((item) => (
                  <PaletteItemButton key={item.type} item={item} onAdd={addFieldByClick} />
                ))}
              </div>
            </Card>

            <Card
              title="画布"
              size="small"
              className="canvas-card"
              styles={{ body: { padding: '12px 16px' } }}
            >
              <SortableContext
                items={fields.map((field) => field.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  ref={setCanvasRef}
                  className={`canvas-list${fields.length === 0 ? ' canvas-list--empty' : ''}${
                    isCanvasOver && activeDrag?.source === 'palette' ? ' canvas-list--over' : ''
                  }`}
                >
                  {fields.map((field) => (
                    <CanvasFieldCard
                      key={field.id}
                      field={field}
                      selected={field.id === selectedFieldId}
                      onSelect={(id) => useTemplateBuilderStore.getState().selectField(id)}
                      onRemove={(id) => useTemplateBuilderStore.getState().removeField(id)}
                    />
                  ))}

                  {fields.length === 0 && (
                    <div className="canvas-empty">
                      <Empty description="将左侧物料拖入画布开始搭建模板" />
                    </div>
                  )}
                </div>
              </SortableContext>
            </Card>

            <PropertyPanel
              field={selectedField}
              fieldCount={fields.length}
              requiredCount={requiredCount}
              titleCount={titleCount}
              schemaJson={schemaJson}
              typeLabel={selectedField ? fieldTypeLabelMap[selectedField.type] : ''}
              configItems={currentConfigItems}
              fieldOptions={selectedOptions}
              activeTab={rightTab}
              onTabChange={setRightTab}
              onUpdateField={updateSelectedField}
              onUpdateOption={updateOption}
              onAddOption={addOption}
              onRemoveOption={removeOption}
              onDelete={removeSelectedField}
            />
          </div>

          <DragOverlay>
            {activePaletteItem ? (
              <div className="tb-drag-overlay-item">
                <activePaletteItem.icon className="palette-icon" />
                <span>{activePaletteItem.label}</span>
              </div>
            ) : activeCanvasField ? (
              <div className="tb-drag-overlay-card">
                <HolderOutlined className="field-drag-handle" />
                <Tag color="blue" className="field-type-tag">
                  {fieldTypeLabelMap[activeCanvasField.type]}
                </Tag>
                <span className="tb-drag-overlay-label">
                  {activeCanvasField.label || fieldTypeLabelMap[activeCanvasField.type]}
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </section>

      <Modal
        open={importOpen}
        title="导入 Schema"
        width={640}
        okText="导入"
        okButtonProps={{ disabled: !importText.trim() }}
        destroyOnClose
        onOk={importSchemaFromText}
        onCancel={() => {
          resetImportModal();
          setImportOpen(false);
        }}
      >
        <div className="tb-import-body lh-modal-stack">
          <Typography.Text type="secondary">
            粘贴 JSON 或上传文件导入 Schema，导入后会覆盖当前画布内容。
          </Typography.Text>
          <Upload accept=".json" showUploadList={false} beforeUpload={importSchemaFromFile}>
            <Button icon={<UploadOutlined />}>选择 JSON 文件</Button>
          </Upload>
          <Input.TextArea
            value={importText}
            rows={12}
            placeholder='粘贴 JSON，例如 { "fields": [...] }'
            className="tb-json-textarea"
            onChange={(event) => setImportText(event.target.value)}
          />
          {importErrors.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="校验警告"
              description={importErrors.join('\n')}
            />
          )}
        </div>
      </Modal>
    </Spin>
  );
}

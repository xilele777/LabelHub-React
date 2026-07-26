import {
  Button,
  Card,
  Divider,
  Empty,
  Input,
  InputNumber,
  Select,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { FieldOption, TemplateField } from '../../../types';

export interface BaseConfigItem {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'switch' | 'number' | 'select' | 'options';
  placeholder?: string;
}

export interface SelectConfigItem extends BaseConfigItem {
  type: 'select';
  options: Array<{ label: string; value: string | number }>;
}

export interface NumberConfigItem extends BaseConfigItem {
  type: 'number';
  min?: number;
  max?: number;
}

export type ConfigItem = BaseConfigItem | SelectConfigItem | NumberConfigItem;

interface PropertyPanelProps {
  field: TemplateField | null;
  fieldCount: number;
  requiredCount: number;
  titleCount: number;
  schemaJson: string;
  typeLabel: string;
  configItems: ConfigItem[];
  fieldOptions: FieldOption[];
  /** tab 受控：schemaJson 仅在 schema 页激活时由父组件计算（Vue 版 tab 状态未上报导致预览恒空，React 版修正） */
  activeTab: string;
  onTabChange: (tab: string) => void;
  onUpdateField: (key: string, value: unknown) => void;
  onUpdateOption: (index: number, key: 'label' | 'value', value: string) => void;
  onAddOption: () => void;
  onRemoveOption: (index: number) => void;
  onDelete: () => void;
}

export default function PropertyPanel({
  field,
  fieldCount,
  requiredCount,
  titleCount,
  schemaJson,
  typeLabel,
  configItems,
  fieldOptions,
  activeTab,
  onTabChange,
  onUpdateField,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
  onDelete,
}: PropertyPanelProps) {
  const record = field as unknown as Record<string, unknown> | null;

  function asInputString(key: string): string {
    const val = record?.[key];
    return val != null ? String(val) : '';
  }

  function asInputNumber(key: string): number | undefined {
    const val = record?.[key];
    if (val === undefined || val === null || val === '') return undefined;
    const num = Number(val);
    return Number.isFinite(num) ? num : undefined;
  }

  function renderConfigItem(item: ConfigItem) {
    if (item.type === 'switch') {
      return (
        <div key={item.key} className="config-switch-row">
          <Typography.Text type="secondary">{item.label}</Typography.Text>
          <Switch
            size="small"
            checked={Boolean(record?.[item.key])}
            onChange={(checked) => onUpdateField(item.key, checked)}
          />
        </div>
      );
    }

    if (item.type === 'options') {
      return (
        <div key={item.key}>
          <Divider className="compact-divider" />
          <Typography.Text type="secondary">{item.label}</Typography.Text>
          <div className="options-editor">
            {fieldOptions.map((option, idx) => (
              <div key={option.id} className="option-row">
                <Input
                  size="small"
                  value={option.label}
                  placeholder="标签"
                  onChange={(event) => onUpdateOption(idx, 'label', event.target.value)}
                />
                <Input
                  size="small"
                  value={option.value}
                  placeholder="值"
                  onChange={(event) => onUpdateOption(idx, 'value', event.target.value)}
                />
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => onRemoveOption(idx)}
                />
              </div>
            ))}
            <Button block size="small" type="dashed" icon={<PlusOutlined />} onClick={onAddOption}>
              添加选项
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div key={item.key} className="config-field">
        <Typography.Text type="secondary">{item.label}</Typography.Text>
        {item.type === 'text' && (
          <Input
            size="small"
            value={asInputString(item.key)}
            placeholder={item.placeholder}
            onChange={(event) => onUpdateField(item.key, event.target.value)}
          />
        )}
        {item.type === 'textarea' && (
          <Input.TextArea
            size="small"
            value={asInputString(item.key)}
            placeholder={item.placeholder}
            autoSize={{ minRows: 1, maxRows: 3 }}
            onChange={(event) => onUpdateField(item.key, event.target.value)}
          />
        )}
        {item.type === 'number' && (
          <InputNumber
            size="small"
            className="number-input"
            value={asInputNumber(item.key)}
            min={(item as NumberConfigItem).min}
            max={(item as NumberConfigItem).max}
            placeholder={item.placeholder}
            onChange={(value) => onUpdateField(item.key, value ?? undefined)}
          />
        )}
        {item.type === 'select' && (
          <Select
            size="small"
            className="select-input"
            value={record?.[item.key] as string | number | undefined}
            options={(item as SelectConfigItem).options}
            onChange={(value) => onUpdateField(item.key, value)}
          />
        )}
      </div>
    );
  }

  const configPane = (
    <div className="inspector-pane">
      {field ? (
        <>
          <div className="inspector-header">
            <Typography.Title level={5} className="inspector-title">
              {typeLabel}配置
            </Typography.Title>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete}>
              删除
            </Button>
          </div>

          <Divider className="compact-divider" />

          {configItems.map((item) => renderConfigItem(item))}
        </>
      ) : (
        <div className="inspector-empty">
          <Empty description="选择画布中的字段以配置属性" />
        </div>
      )}
    </div>
  );

  const schemaPane = (
    <div className="schema-pane">
      <div className="schema-summary">
        <Tag color="blue">共 {fieldCount} 个字段</Tag>
        <Tag color="red">必填 {requiredCount} 个</Tag>
        <Tag color="orange">说明 {titleCount} 个</Tag>
      </div>
      <pre className="schema-preview">{schemaJson}</pre>
    </div>
  );

  return (
    <Card size="small" className="inspector-card" styles={{ body: { padding: 0 } }}>
      <Tabs
        activeKey={activeTab}
        onChange={onTabChange}
        className="inspector-tabs"
        items={[
          { key: 'config', label: '属性', children: configPane },
          { key: 'schema', label: 'Schema', children: schemaPane },
        ]}
      />
    </Card>
  );
}

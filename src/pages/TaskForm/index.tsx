import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router';
import { AssignmentStrategy, TaskStatus, TaskType, type TaskItem } from '../../types';
import { getUserList } from '../../api/template';
import { useTaskStore } from '../../store/useTaskStore';
import { useTemplateStore } from '../../store/useTemplateStore';
import './TaskForm.css';

interface TaskFormValues {
  name: string;
  description: string;
  type?: TaskType;
  owner?: string;
  templateId?: string;
  instructions: string;
  startsAt: string;
  dueAt: string;
  annotationTimeoutHours: number;
  reviewTimeoutHours: number;
}

const INITIAL_VALUES: TaskFormValues = {
  name: '',
  description: '',
  type: undefined,
  owner: undefined,
  templateId: undefined,
  instructions: '',
  startsAt: '',
  dueAt: '',
  annotationTimeoutHours: 24,
  reviewTimeoutHours: 24,
};

const TASK_TYPE_OPTIONS = [
  { label: '图像分类', value: TaskType.IMAGE_CLASSIFICATION },
  { label: '目标检测', value: TaskType.OBJECT_DETECTION },
  { label: '语义分割', value: TaskType.SEMANTIC_SEGMENTATION },
  { label: '文本 NER', value: TaskType.TEXT_NER },
];

function toLocalInputValue(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export default function TaskForm() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<TaskFormValues>();

  const editId = searchParams.get('id') ?? '';
  const isEdit = Boolean(editId);

  const taskLoading = useTaskStore((state) => state.loading);
  const templates = useTemplateStore((state) => state.templates);
  const templateLoading = useTemplateStore((state) => state.loading);
  const editingTask = useTaskStore((state) => state.tasks.find((task) => task.id === editId));

  const [optionsLoading, setOptionsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [ownerOptions, setOwnerOptions] = useState<Array<{ label: string; value: string }>>([]);

  const loading = taskLoading || templateLoading || optionsLoading;

  // 模板下拉随任务类型联动（Vue 版为 computed(formState.type)）
  const selectedType = Form.useWatch('type', form);
  const templateOptions = useMemo(
    () =>
      templates
        .filter((template) => !selectedType || template.type === selectedType)
        .map((template) => ({ label: template.name, value: template.id })),
    [templates, selectedType],
  );

  const loadOwners = useCallback(async () => {
    setOptionsLoading(true);
    try {
      const res = await getUserList();
      setOwnerOptions(
        (res.data.items || [])
          .filter((user) => user.role === 'owner' || user.role === 'admin')
          .map((user) => ({ label: user.username, value: user.username })),
      );
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '加载负责人失败');
    } finally {
      setOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      useTaskStore.getState().fetchTasks(),
      useTemplateStore.getState().fetchTemplates(),
      loadOwners(),
    ]);
  }, [loadOwners]);

  // 编辑态：任务数据到达（或被其他操作刷新）后回填表单，等价 Vue watch(editingTask)
  useEffect(() => {
    if (!editingTask) return;
    form.setFieldsValue({
      name: editingTask.name,
      description: editingTask.description,
      type: editingTask.type,
      owner: editingTask.owner,
      templateId: editingTask.templateId,
      instructions: editingTask.instructions,
      startsAt: toLocalInputValue(editingTask.startsAt),
      dueAt: toLocalInputValue(editingTask.dueAt),
      annotationTimeoutHours: editingTask.annotationTimeoutHours ?? 24,
      reviewTimeoutHours: editingTask.reviewTimeoutHours ?? 24,
    });
  }, [editingTask, form]);

  async function handleSubmit(values: TaskFormValues) {
    if (values.startsAt && values.dueAt && new Date(values.dueAt) <= new Date(values.startsAt)) {
      message.warning('任务期限必须晚于任务开始');
      return;
    }

    const selectedTemplate = templates.find((template) => template.id === values.templateId);
    const payload: Partial<TaskItem> = {
      name: values.name,
      description: values.description,
      type: values.type,
      owner: values.owner,
      templateId: values.templateId,
      templateName: selectedTemplate?.name ?? '',
      instructions: values.instructions,
      startsAt: fromLocalInputValue(values.startsAt),
      dueAt: fromLocalInputValue(values.dueAt),
      annotationTimeoutHours: values.annotationTimeoutHours,
      reviewTimeoutHours: values.reviewTimeoutHours,
    };

    try {
      if (isEdit && editId) {
        await useTaskStore.getState().updateTask(editId, payload);
        message.success('任务已更新');
      } else {
        await useTaskStore.getState().addTask({
          ...payload,
          status: TaskStatus.DRAFT,
          assignmentConfig: {
            strategy: AssignmentStrategy.EVEN_SPLIT,
            annotators: [],
            options: {},
          },
          archived: false,
          archivedAt: null,
        } as Partial<TaskItem>);
        message.success('任务创建成功');
      }
      await navigate('/tasks');
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : useTaskStore.getState().error || '保存任务失败',
      );
    }
  }

  return (
    <section className="task-form-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            {isEdit ? '编辑任务' : '创建任务'}
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            配置任务基础信息、模板绑定和处理时效。
          </Typography.Text>
        </div>
      </header>

      {errorText && (
        <Alert
          type="error"
          message={errorText}
          showIcon
          closable
          onClose={() => setErrorText('')}
        />
      )}

      <Spin spinning={loading}>
        <Card className="form-card">
          <Form<TaskFormValues>
            form={form}
            initialValues={INITIAL_VALUES}
            layout="vertical"
            autoComplete="off"
            onFinish={(values) => void handleSubmit(values)}
            onValuesChange={(changed: Partial<TaskFormValues>) => {
              // 任务类型变更后原模板可能不再匹配，清空绑定（等价 Vue @change）
              if ('type' in changed) form.setFieldValue('templateId', undefined);
            }}
          >
            <Form.Item
              name="name"
              label="任务名称"
              rules={[{ required: true, message: '请输入任务名称' }]}
            >
              <Input maxLength={50} showCount placeholder="请输入任务名称" />
            </Form.Item>

            <Form.Item
              name="description"
              label="任务描述"
              rules={[{ required: true, message: '请输入任务描述' }]}
            >
              <Input.TextArea maxLength={200} showCount rows={3} placeholder="请输入任务描述" />
            </Form.Item>

            <Form.Item
              name="type"
              label="任务类型"
              rules={[{ required: true, message: '请选择任务类型' }]}
            >
              <Select options={TASK_TYPE_OPTIONS} placeholder="请选择任务类型" />
            </Form.Item>

            <Form.Item
              name="owner"
              label="负责人"
              rules={[{ required: true, message: '请选择负责人' }]}
            >
              <Select options={ownerOptions} loading={optionsLoading} placeholder="请选择负责人" />
            </Form.Item>

            <Form.Item
              name="templateId"
              label="绑定模板"
              rules={[{ required: true, message: '请选择绑定模板' }]}
            >
              <Select
                options={templateOptions}
                loading={templateLoading}
                disabled={!selectedType}
                placeholder={selectedType ? '请选择模板' : '请先选择任务类型'}
              />
            </Form.Item>

            <Form.Item
              name="instructions"
              label="任务说明"
              rules={[{ required: true, message: '请输入任务说明' }]}
            >
              <Input.TextArea
                maxLength={500}
                showCount
                rows={4}
                placeholder="请输入任务说明，如标注规范、注意事项等"
              />
            </Form.Item>

            <Card size="small" title="任务时效" className="time-card">
              <Row gutter={[16, 12]}>
                <Col xs={24} md={12}>
                  <label className="field-label" htmlFor="task-starts-at">
                    任务开始
                  </label>
                  <Form.Item name="startsAt" noStyle>
                    <input id="task-starts-at" className="native-input" type="datetime-local" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <label className="field-label" htmlFor="task-due-at">
                    任务期限
                  </label>
                  <Form.Item name="dueAt" noStyle>
                    <input id="task-due-at" className="native-input" type="datetime-local" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <label className="field-label" htmlFor="task-annotation-timeout">
                    标注项时限（小时）
                  </label>
                  <Form.Item name="annotationTimeoutHours" noStyle>
                    <InputNumber
                      id="task-annotation-timeout"
                      min={0}
                      max={720}
                      className="full-control"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <label className="field-label" htmlFor="task-review-timeout">
                    审核项时限（小时）
                  </label>
                  <Form.Item name="reviewTimeoutHours" noStyle>
                    <InputNumber
                      id="task-review-timeout"
                      min={0}
                      max={720}
                      className="full-control"
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Form.Item className="form-actions">
              <Space>
                <Button type="primary" htmlType="submit" loading={taskLoading}>
                  {isEdit ? '保存修改' : '创建任务'}
                </Button>
                <Button icon={<ArrowLeftOutlined />} onClick={() => void navigate('/tasks')}>
                  返回列表
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Card>
      </Spin>
    </section>
  );
}

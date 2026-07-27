import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { NotificationOutlined, SendOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router';
import { publishNotification, type PublishNotificationParams } from '../../api/notification';
import * as authApi from '../../api/auth';
import { Role, type UserInfo } from '../../types';
import './NotificationPublish.css';

type Priority = NonNullable<PublishNotificationParams['priority']>;

interface PublishFormValues {
  title: string;
  message: string;
  priority: Priority;
  targetRoles: string[];
  targetUsernames: string[];
}

const ROLE_OPTIONS = [
  { label: '负责人', value: Role.OWNER },
  { label: '标注员', value: Role.ANNOTATOR },
  { label: '审核员', value: Role.REVIEWER },
];

const PRIORITY_OPTIONS = [
  { label: '普通', value: 'medium' },
  { label: '重要', value: 'high' },
  { label: '低优先级', value: 'low' },
];

const INITIAL_VALUES: PublishFormValues = {
  title: '',
  message: '',
  priority: 'medium',
  targetRoles: [],
  targetUsernames: [],
};

export default function NotificationPublish() {
  const { message } = App.useApp();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<PublishFormValues>();

  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await authApi.getUserList();
      setUsers(res.data.items || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取用户列表失败');
    } finally {
      setLoadingUsers(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  // 「复制再发」：从查询参数预填标题与内容（等价 Vue onMounted 读取 route.query）
  useEffect(() => {
    const title = searchParams.get('title');
    const messageText = searchParams.get('message');
    if (title) form.setFieldValue('title', title);
    if (messageText) form.setFieldValue('message', messageText);
  }, [searchParams, form]);

  const userOptions = useMemo(
    () =>
      users.map((user) => ({
        label: `${user.username} (${ROLE_OPTIONS.find((role) => role.value === user.role)?.label ?? user.role})`,
        value: user.username,
      })),
    [users],
  );

  async function handleSubmit() {
    const values = await form.validateFields();
    if (values.targetRoles.length === 0 && values.targetUsernames.length === 0) {
      message.warning('请至少选择一个接收角色或接收人员');
      return;
    }

    setSubmitting(true);
    try {
      const res = await publishNotification({
        title: values.title,
        message: values.message,
        priority: values.priority,
        targetRoles: values.targetRoles,
        targetUsernames: values.targetUsernames,
      });
      message.success(`通知已发布，送达 ${res.data.delivered} 人`);
      form.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '发布通知失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="notification-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            <NotificationOutlined className="page-icon" />
            通知发布
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            按角色或指定人员发送站内通知。
          </Typography.Text>
        </div>
        <div className="app-page-tools">
          <Tag color="blue">管理员权限</Tag>
        </div>
      </header>

      <Alert
        type="info"
        showIcon
        message="通知会进入接收人的通知中心，可按角色、指定人员或两者组合发送。"
      />

      <Card size="small" className="form-card">
        <Form<PublishFormValues>
          form={form}
          initialValues={INITIAL_VALUES}
          layout="vertical"
          autoComplete="off"
        >
          <Form.Item
            name="title"
            label="通知标题"
            rules={[{ required: true, message: '请输入通知标题' }]}
          >
            <Input maxLength={60} showCount placeholder="例如：本周审核安排调整" />
          </Form.Item>
          <Form.Item
            name="message"
            label="通知内容"
            rules={[{ required: true, message: '请输入通知内容' }]}
          >
            <Input.TextArea
              rows={6}
              maxLength={500}
              showCount
              placeholder="请输入需要同步给目标人员的内容"
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select className="priority-select" options={PRIORITY_OPTIONS} />
          </Form.Item>
          <Form.Item name="targetRoles" label="按角色发送">
            <Checkbox.Group options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="targetUsernames" label="按人员发送">
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              loading={loadingUsers}
              options={userOptions}
              placeholder="选择指定接收人员"
            />
          </Form.Item>
          <Space wrap className="form-actions">
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={submitting}
              onClick={() => void handleSubmit()}
            >
              发布通知
            </Button>
            <Button onClick={() => form.resetFields()}>重置</Button>
            <Typography.Text type="secondary">
              角色和人员取并集，重复人员只发送一次。
            </Typography.Text>
          </Space>
        </Form>
      </Card>
    </section>
  );
}

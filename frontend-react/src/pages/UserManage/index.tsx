import { useCallback, useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined, UserAddOutlined } from '@ant-design/icons';
import * as authApi from '../../api/auth';
import { Role, type UserInfo } from '../../types';
import { getRoleMeta } from '../../utils/statusMeta';
import './UserManage.css';

const ROLE_OPTIONS = [
  { label: '管理员', value: Role.ADMIN },
  { label: '负责人', value: Role.OWNER },
  { label: '标注员', value: Role.ANNOTATOR },
  { label: '审核员', value: Role.REVIEWER },
];

interface CreateFormValues {
  username: string;
  password: string;
  role?: Role;
}

interface EditFormValues {
  username: string;
  role?: Role;
}

interface PasswordFormValues {
  newPassword: string;
  confirmPassword: string;
}

export default function UserManage() {
  const { message } = App.useApp();

  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserInfo | null>(null);

  const [createForm] = Form.useForm<CreateFormValues>();
  const [editForm] = Form.useForm<EditFormValues>();
  const [passwordForm] = Form.useForm<PasswordFormValues>();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authApi.getUserList();
      setUsers(res.data.items || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  function openCreate() {
    createForm.resetFields();
    setCreateModalOpen(true);
  }

  function openEdit(record: UserInfo) {
    setEditingUser(record);
    editForm.setFieldsValue({ username: record.username, role: record.role });
    setEditModalOpen(true);
  }

  function openPassword(record: UserInfo) {
    setEditingUser(record);
    passwordForm.resetFields();
    setPasswordModalOpen(true);
  }

  async function handleCreate() {
    const values = await createForm.validateFields();
    setSubmitting(true);
    try {
      await authApi.createUser({
        username: values.username,
        password: values.password,
        role: values.role as Role,
      });
      message.success('用户创建成功');
      setCreateModalOpen(false);
      await fetchUsers();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '创建用户失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit() {
    if (!editingUser) return;
    const values = await editForm.validateFields();
    setSubmitting(true);
    try {
      await authApi.updateUser(editingUser.id, { username: values.username, role: values.role });
      message.success('用户更新成功');
      setEditModalOpen(false);
      setEditingUser(null);
      await fetchUsers();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新用户失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangePassword() {
    if (!editingUser) return;
    const values = await passwordForm.validateFields();
    setSubmitting(true);
    try {
      await authApi.changePassword(editingUser.id, { newPassword: values.newPassword });
      message.success('密码修改成功');
      setPasswordModalOpen(false);
      setEditingUser(null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await authApi.deleteUser(id);
      message.success('用户删除成功');
      await fetchUsers();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除用户失败');
    }
  }

  const columns: TableColumnsType<UserInfo> = [
    { title: '用户名', dataIndex: 'username', key: 'username', ellipsis: true },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 104,
      render: (_: unknown, record: UserInfo) => {
        const meta = getRoleMeta(record.role);
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: 'ID', dataIndex: 'id', key: 'id', width: 140, ellipsis: true, responsive: ['lg'] },
    {
      title: '操作',
      key: 'action',
      width: 176,
      render: (_: unknown, record: UserInfo) => (
        <Space size="small" wrap>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => openPassword(record)}>
            改密
          </Button>
          <Popconfirm
            title={`确定删除用户 ${record.username} 吗？`}
            onConfirm={() => void handleDelete(record.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <section className="user-manage-page app-page">
      <header className="app-page-header">
        <div className="app-page-title">
          <Typography.Title level={4} className="page-title">
            用户管理
          </Typography.Title>
          <Typography.Text className="app-page-desc" type="secondary">
            维护平台用户和角色权限。
          </Typography.Text>
        </div>
        <div className="app-page-tools">
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchUsers()}>
            刷新
          </Button>
          <Button type="primary" icon={<UserAddOutlined />} onClick={openCreate}>
            新增用户
          </Button>
        </div>
      </header>

      <Card size="small" className="app-table-card" styles={{ body: { padding: 0 } }}>
        <Table<UserInfo>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={users}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      </Card>

      <Modal
        open={createModalOpen}
        title="新增用户"
        width={520}
        okText="创建"
        confirmLoading={submitting}
        onOk={() => void handleCreate()}
        onCancel={() => setCreateModalOpen(false)}
      >
        <Form<CreateFormValues>
          form={createForm}
          layout="vertical"
          autoComplete="off"
          className="modal-form"
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 2, message: '用户名至少 2 个字符' },
            ]}
          >
            <Input maxLength={30} placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 4, message: '密码至少 4 位' },
            ]}
          >
            <Input.Password maxLength={50} placeholder="请输入密码" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={ROLE_OPTIONS} placeholder="请选择角色" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editModalOpen}
        title="编辑用户"
        width={520}
        okText="保存"
        confirmLoading={submitting}
        onOk={() => void handleEdit()}
        onCancel={() => setEditModalOpen(false)}
      >
        <Form<EditFormValues>
          form={editForm}
          layout="vertical"
          autoComplete="off"
          className="modal-form"
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, message: '请输入用户名' },
              { min: 2, message: '用户名至少 2 个字符' },
            ]}
          >
            <Input maxLength={30} placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={ROLE_OPTIONS} placeholder="请选择角色" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={passwordModalOpen}
        title="修改密码"
        width={520}
        okText="确认修改"
        confirmLoading={submitting}
        onOk={() => void handleChangePassword()}
        onCancel={() => setPasswordModalOpen(false)}
      >
        <Form<PasswordFormValues>
          form={passwordForm}
          layout="vertical"
          autoComplete="off"
          className="modal-form"
        >
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 4, message: '密码至少 4 位' },
            ]}
          >
            <Input.Password maxLength={50} placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_rule, value: string) {
                  if (!value || value === getFieldValue('newPassword')) return Promise.resolve();
                  return Promise.reject(new Error('两次密码输入不一致'));
                },
              }),
            ]}
          >
            <Input.Password maxLength={50} placeholder="请再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

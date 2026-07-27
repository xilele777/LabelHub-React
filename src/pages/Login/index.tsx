import { Alert, App, Button, Card, Form, Input, Spin, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuthStore } from '../../store/useAuthStore';
import { getDefaultPath } from '../../utils/roleHelper';
import './Login.css';

interface LoginFormValues {
  account: string;
  passcode: string;
}

function getSafeRedirect(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (value === '/login' || value.startsWith('/login?')) return fallback;
  return value;
}

function LoginInner() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const login = useAuthStore((state) => state.login);

  async function handleFinish(values: LoginFormValues) {
    const user = await login(values.account, values.passcode);
    if (!user) {
      message.error(useAuthStore.getState().error || '用户名或密码错误');
      return;
    }

    message.success('登录成功');
    const defaultPath = getDefaultPath(user.role);
    const redirect = getSafeRedirect(searchParams.get('redirect'), defaultPath);
    await navigate(redirect, { replace: true });
  }

  return (
    <main className="login-page">
      <Spin spinning={loading}>
        <Card className="login-card">
          <div className="login-card__header">
            <Typography.Title level={3} className="login-card__title">
              LabelHub
            </Typography.Title>
            <Typography.Text type="secondary">数据标注平台</Typography.Text>
          </div>

          {error && <Alert type="error" message={error} showIcon className="login-card__alert" />}

          <Form<LoginFormValues> size="large" autoComplete="off" onFinish={handleFinish}>
            <input
              type="text"
              name="username"
              autoComplete="username"
              className="login-card__hidden-input"
            />
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              className="login-card__hidden-input"
            />

            <Form.Item name="account" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input
                placeholder="用户名"
                autoComplete="off"
                disabled={loading}
                prefix={<UserOutlined />}
              />
            </Form.Item>

            <Form.Item name="passcode" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                placeholder="密码"
                autoComplete="new-password"
                disabled={loading}
                prefix={<LockOutlined />}
              />
            </Form.Item>

            <Form.Item className="login-card__submit">
              <Button type="primary" htmlType="submit" block loading={loading}>
                登录
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Spin>
    </main>
  );
}

// AntdApp 就地包裹（Login 位于 MainLayout 之外）：为 useApp() 提供上下文，
// 且保持该依赖留在 Login 懒加载 chunk 内、不进入口 App.tsx
export default function Login() {
  return (
    <App>
      <LoginInner />
    </App>
  );
}

import { Card, ConfigProvider, Descriptions, Tag, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { buildRequestKey } from '@/api/request';
import { Role } from '@/types';

// 阶段 1 自检页：故意引用搬运层（api/types），让 vite build 真实覆盖这些模块。
// 阶段 2 接入路由后由 MainLayout/Login 替换。
const sampleKey = buildRequestKey('/tasks', { page: 1, status: 'draft' });
const roles = Object.values(Role);

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <Card title="LabelHub React 迁移骨架" style={{ maxWidth: 640, margin: '48px auto' }}>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="应用版本">{__APP_VERSION__}</Descriptions.Item>
          <Descriptions.Item label="api/request 自检">{sampleKey}</Descriptions.Item>
          <Descriptions.Item label="types/Role 自检">
            {roles.map((role) => (
              <Tag key={role}>{role}</Tag>
            ))}
          </Descriptions.Item>
        </Descriptions>
        <Typography.Text type="secondary">阶段 1 骨架 — 框架无关层已搬运</Typography.Text>
      </Card>
    </ConfigProvider>
  );
}

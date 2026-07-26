import { Result, Typography } from 'antd';
import { ToolOutlined } from '@ant-design/icons';

/**
 * 阶段 3 页面迁移完成前的占位组件。
 * 路由/权限/布局已就绪，各页面迁移后在 router/routes.tsx 里替换为真实组件（React.lazy）。
 */
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <Result
      icon={<ToolOutlined />}
      title={title}
      subTitle="该页面正在从 Vue 迁移到 React（阶段 3），当前为路由占位。"
      extra={<Typography.Text type="secondary">路由与权限校验已生效</Typography.Text>}
    />
  );
}

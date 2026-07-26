import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';

const googleTheme = {
  token: {
    colorPrimary: '#1a73e8',
    colorSuccess: '#188038',
    colorWarning: '#f9ab00',
    colorError: '#d93025',
    colorInfo: '#129eaf',
    colorText: '#202124',
    colorTextSecondary: '#5f6368',
    colorBorder: '#e0e3eb',
    borderRadius: 8,
    fontFamily: "Inter, Roboto, 'Google Sans', 'Segoe UI', Arial, sans-serif",
  },
};

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={googleTheme}>
      {/* antd App 上下文：使 message/modal/notification 静态方法继承主题 */}
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  );
}

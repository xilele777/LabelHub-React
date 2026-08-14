// 应用根组件，提供全局上下文并承载路由内容。
import { Suspense } from 'react';
import { ConfigProvider } from 'antd';
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

// 顶层路由加载期间使用轻量的占位内容，避免在入口额外引入页面组件。
function AppLoading() {
  return (
    <div className="app-boot-loading">
      <span className="app-boot-spinner" aria-label="加载中" />
    </div>
  );
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={googleTheme}>
      {/* 消息、通知和弹窗上下文由需要它们的页面分别提供。 */}
      <Suspense fallback={<AppLoading />}>
        <RouterProvider router={router} />
      </Suspense>
    </ConfigProvider>
  );
}

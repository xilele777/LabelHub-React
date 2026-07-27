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

// 顶层路由 chunk（MainLayout/Login）加载期的 fallback。
// 不可使用 SkeletonLoader —— 它依赖 antd，会把组件库拉回入口预加载链
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
      {/* antd 的 App 上下文组件不在此全局挂载（体积原因），
          由 MainLayout 与 Login 在各自懒加载 chunk 内就地提供 */}
      <Suspense fallback={<AppLoading />}>
        <RouterProvider router={router} />
      </Suspense>
    </ConfigProvider>
  );
}

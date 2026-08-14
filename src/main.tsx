// 应用入口，挂载根组件并加载全局样式。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import './assets/global.css';
import App from './App';
import { router } from './router';
import { setUnauthorizedHandler } from './api/request';
import { initWebVitals } from './services/webVitals';
import { logger } from './utils/logger';

// 会话过期时回到登录页，并保留当前地址以便登录后返回。
setUnauthorizedHandler(() => {
  const { location } = router.state;
  if (location.pathname === '/login') return;

  const fullPath = location.pathname + location.search;
  void router.navigate(`/login?redirect=${encodeURIComponent(fullPath)}`, { replace: true });
});

// 生产环境上报未被组件错误边界捕获的全局异常。
if (import.meta.env.PROD) {
  const report = (message: string, stack: string | undefined, info: string) => {
    try {
      const payload = JSON.stringify({
        message,
        stack,
        info,
        url: window.location.href,
        timestamp: new Date().toISOString(),
      });
      navigator.sendBeacon('/api/error-report', payload);
    } catch {
      // 上报失败不能影响页面的正常运行。
    }
  };

  window.addEventListener('error', (event) => {
    logger.error('[Global Error]', event.error ?? event.message);
    report(
      event.message,
      event.error instanceof Error ? event.error.stack : undefined,
      'window.onerror',
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.error('[Unhandled Rejection]', event.reason);
    const reason = event.reason;
    report(
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
      'unhandledrejection',
    );
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 采集核心网页指标，仅在生产环境上报。
initWebVitals();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'antd/dist/reset.css';
import './assets/global.css';
import App from './App';
import { router } from './router';
import { setUnauthorizedHandler } from './api/request';
import { initWebVitals } from './services/webVitals';
import { logger } from './utils/logger';

// 401 会话过期：跳转登录页并携带回跳地址（等价 Vue main.ts 的 router.replace）
setUnauthorizedHandler(() => {
  const { location } = router.state;
  if (location.pathname === '/login') return;

  const fullPath = location.pathname + location.search;
  void router.navigate(`/login?redirect=${encodeURIComponent(fullPath)}`, { replace: true });
});

// ─── 全局错误上报（渲染错误由 ErrorBoundary 捕获；这里兜底事件回调/异步错误） ───
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
      // Silently fail — error reporting itself should not cause errors.
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

// Core Web Vitals 采集（仅生产环境上报）
initWebVitals();

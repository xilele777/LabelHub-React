import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

const ENDPOINT = '/api/web-vitals';

function report(metric: Metric) {
  try {
    const payload = JSON.stringify({
      name: metric.name,
      // CLS 是无量纲小数，放大 1000 倍取整便于聚合；其余指标单位为 ms
      value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
      rating: metric.rating,
      id: metric.id,
      navigationType: metric.navigationType,
      page: window.location.pathname,
      timestamp: Date.now(),
    });

    // sendBeacon 在页面卸载时仍可靠发送且不阻塞主线程；不可用时退化为 keepalive fetch
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, payload);
    } else {
      void fetch(ENDPOINT, { method: 'POST', body: payload, keepalive: true });
    }
  } catch {
    // 监控上报自身不应产生错误
  }
}

/** 采集 Core Web Vitals（LCP / INP / CLS）与辅助指标（FCP / TTFB）并上报 */
export function initWebVitals() {
  if (!import.meta.env.PROD) return;
  onLCP(report);
  onINP(report);
  onCLS(report);
  onFCP(report);
  onTTFB(report);
}

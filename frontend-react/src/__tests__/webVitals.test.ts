/**
 * webVitals service 单元测试：指标注册、上报载荷、环境开关。
 *
 * 端到端链路（真实浏览器 sendBeacon → server 落库）由部署冒烟覆盖，
 * 这里验证 service 自身行为：PROD 才注册、CLS 放大 1000 取整、beacon 载荷字段。
 *
 * 运行: npx vitest run src/__tests__/webVitals.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Metric } from 'web-vitals';

type MetricHandler = (metric: Metric) => void;
const handlers: Record<string, MetricHandler> = {};

vi.mock('web-vitals', () => ({
  onLCP: vi.fn((cb: MetricHandler) => {
    handlers.LCP = cb;
  }),
  onINP: vi.fn((cb: MetricHandler) => {
    handlers.INP = cb;
  }),
  onCLS: vi.fn((cb: MetricHandler) => {
    handlers.CLS = cb;
  }),
  onFCP: vi.fn((cb: MetricHandler) => {
    handlers.FCP = cb;
  }),
  onTTFB: vi.fn((cb: MetricHandler) => {
    handlers.TTFB = cb;
  }),
}));

import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals';
import { initWebVitals } from '../services/webVitals';

function makeMetric(overrides: Partial<Metric>): Metric {
  return {
    name: 'LCP',
    value: 1234.56,
    rating: 'good',
    delta: 0,
    entries: [],
    id: 'v1-123',
    navigationType: 'navigate',
    ...overrides,
  } as Metric;
}

describe('webVitals service', () => {
  const sendBeacon = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(handlers).forEach((key) => delete handlers[key]);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('非生产环境不注册任何指标采集', () => {
    vi.stubEnv('PROD', false);
    initWebVitals();

    expect(onLCP).not.toHaveBeenCalled();
    expect(onCLS).not.toHaveBeenCalled();
  });

  it('生产环境注册 LCP/INP/CLS/FCP/TTFB 五项指标', () => {
    vi.stubEnv('PROD', true);
    initWebVitals();

    expect(onLCP).toHaveBeenCalledTimes(1);
    expect(onINP).toHaveBeenCalledTimes(1);
    expect(onCLS).toHaveBeenCalledTimes(1);
    expect(onFCP).toHaveBeenCalledTimes(1);
    expect(onTTFB).toHaveBeenCalledTimes(1);
  });

  it('指标触发时经 sendBeacon 上报到 /api/web-vitals，ms 指标取整', () => {
    vi.stubEnv('PROD', true);
    initWebVitals();

    handlers.LCP!(makeMetric({ name: 'LCP', value: 1234.56 }));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [endpoint, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(endpoint).toBe('/api/web-vitals');
    const payload = JSON.parse(body);
    expect(payload.name).toBe('LCP');
    expect(payload.value).toBe(1235);
    expect(payload.rating).toBe('good');
    expect(payload.page).toBeDefined();
    expect(payload.timestamp).toBeTypeOf('number');
  });

  it('CLS 为无量纲小数，上报前放大 1000 倍取整', () => {
    vi.stubEnv('PROD', true);
    initWebVitals();

    handlers.CLS!(makeMetric({ name: 'CLS', value: 0.1234 }));

    const [, body] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(JSON.parse(body).value).toBe(123);
  });
});

/**
 * Prometheus 指标中间件
 *
 * 收集:
 *   - http_request_duration_seconds  (Histogram: 请求延迟)
 *   - http_requests_total            (Counter: 请求总数，按 method/status/route 分组)
 *   - http_requests_in_flight        (Gauge: 当前处理中的请求数)
 *
 * 暴露端点: GET /api/metrics
 */

const client = require('prom-client');

// 默认标签。
const defaultLabels = {
  app: 'labelhub',
};
client.register.setDefaultLabels(defaultLabels);

// Node.js 默认指标。
client.collectDefaultMetrics({
  prefix: 'labelhub_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// HTTP 指标。
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'http_requests_in_flight',
  help: 'Current number of HTTP requests being processed',
});

// 指标中间件。
function metricsMiddleware(req, res, next) {
  // 排除监控接口自身，避免指标统计递归。
  if (req.path === '/api/metrics' || req.path === '/api/health') {
    return next();
  }

  const start = process.hrtime.bigint();
  httpRequestsInFlight.inc();

  // 响应完成后记录最终路由和状态码。
  res.on('finish', () => {
    httpRequestsInFlight.dec();

    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path || req.path || 'unknown';
    const statusCode = String(res.statusCode);
    const method = req.method;

    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationSeconds);
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
  });

  next();
}

// 指标端点。
async function metricsEndpoint(_req, res) {
  try {
    res.set('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.send(metrics);
  } catch (err) {
    res.status(500).json({ code: 500, message: 'Failed to collect metrics', data: null });
  }
}

module.exports = { metricsMiddleware, metricsEndpoint };

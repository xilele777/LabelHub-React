const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');

// Middleware
// 兼容 Node.js 直接运行（加载 .js, module.exports = fn）和 tsx 运行（加载 .ts, export default → { default: fn }）
const _responseMiddleware = require('./middleware/response');
const responseMiddleware = _responseMiddleware.default || _responseMiddleware;
const _requestId = require('./middleware/requestId');
const requestId = _requestId.default || _requestId;
const _securityHeaders = require('./middleware/securityHeaders');
const securityHeaders = _securityHeaders.default || _securityHeaders;
const requestLogger = require('./middleware/requestLogger');
const { authMiddleware } = require('./middleware/auth');
const { globalLimiter } = require('./middleware/apiRateLimit');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const taskRoutes = require('./routes/tasks');
const templateRoutes = require('./routes/templates');
const annotationItemRoutes = require('./routes/annotationItems');
const reviewRoutes = require('./routes/reviews');
const assignmentRoutes = require('./routes/assignments');
const notificationRoutes = require('./routes/notifications');
const monitoringRoutes = require('./routes/monitoring');

// Notification Service (WebSocket)
const { initNotificationService } = require('./services/notificationService');
const { startTimelinessReminderService } = require('./services/timelinessReminderService');

// Logging
const { logger } = require('./utils/logger');

// DB
const db = require('./store/db');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

function buildCorsOptions() {
  const configuredOrigins = process.env.CORS_ORIGIN || process.env.CORS_ORIGINS;
  if (configuredOrigins) {
    const allowList = configuredOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    return {
      origin(origin, callback) {
        if (!origin || allowList.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS origin blocked: ${origin}`));
      },
      credentials: true,
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGIN is required when NODE_ENV=production');
  }

  // 开发环境：显式允许前端开发服务器地址
  return {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
  };
}

// ─── Global middleware ────────────────────────────────────
app.use(requestId); // Correlate requests across logs and responses
app.use(requestLogger); // Log every request (MUST be after requestId)
app.use(compression()); // Gzip/brotli response compression
app.use(cookieParser()); // Parse cookies for httpOnly token auth
app.use(securityHeaders); // Basic hardening headers
app.use(globalLimiter); // API rate limiting
app.use(cors(buildCorsOptions())); // Allow configured frontend origins
app.use(responseMiddleware); // Unified response helpers (MUST be before json parser so res.fail is always available)
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies
app.use(authMiddleware); // Attach currentUser to req

// ─── Auto-seed on first run ────────────────────────────────
if (!db.isSeeded()) {
  logger.info('Database is empty, running seed...');
  require('./seed');
}

// ─── Routes ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/annotation-items', annotationItemRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', monitoringRoutes);
app.use('/api', assignmentRoutes);

// ─── Swagger API docs ────────────────────────────────────
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./utils/swagger');
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'LabelHub API Documentation',
  }),
);
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));

// ─── Prometheus metrics ──────────────────────────────────
const { metricsMiddleware, metricsEndpoint } = require('./middleware/metrics');
app.use(metricsMiddleware);
app.get('/api/metrics', metricsEndpoint);

// ─── Health check ─────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const checks = {
    db: { ok: false },
    redis: { ok: false, available: false },
  };

  // Probe database
  try {
    db.count('users');
    checks.db = { ok: true };
  } catch (err) {
    checks.db = { ok: false, error: err.message };
  }

  // Probe Redis
  try {
    const { getRedis } = require('./utils/redis');
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      checks.redis = { ok: true, available: true };
    } else {
      checks.redis = { ok: true, available: false };
    }
  } catch (err) {
    checks.redis = { ok: false, available: true, error: err.message };
  }

  const allOk = checks.db.ok && checks.redis.ok;
  const status = allOk ? 'ok' : 'degraded';

  res.status(allOk ? 200 : 503).json({
    code: allOk ? 200 : 503,
    message: status === 'ok' ? 'healthy' : 'service degraded',
    data: {
      status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
      collections: {
        users: db.count('users'),
        tasks: db.count('tasks'),
        templates: db.count('templates'),
        annotationItems: db.count('annotation-items'),
        reviews: db.count('reviews'),
      },
    },
  });
});

// ─── 404 fallback ─────────────────────────────────────────
app.use('/api', (req, res) => {
  res.notFound(`API route not found: ${req.method} ${req.originalUrl}`);
});

// ─── 前端静态托管 + SPA history 路由 ─────────────────────
// 构建产物在项目根目录的 dist/(server/ 的上一层)
const distDir = path.join(__dirname, '..', 'dist');
app.use(express.static(distDir));
// 非 API、非静态文件的请求统一返回 index.html,交给前端路由处理(React Router history 模式)
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next(err);
  });
});

// ─── Global error handler ─────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  if (typeof res.fail === 'function') {
    res.fail(err.message || '服务器内部错误', 500);
  } else {
    res.status(500).json({ code: 500, message: err.message || '服务器内部错误', data: null });
  }
});

// ─── Start server ─────────────────────────────────────────
// 防止慢请求导致连接挂起
server.setTimeout(30_000, (socket) => {
  if (!socket.destroyed) {
    socket.write('HTTP/1.1 408 Request Timeout\r\n\r\n');
    socket.destroy();
  }
});

let io = null;
let timelinessTimer = null;

server.listen(PORT, () => {
  io = initNotificationService(server);
  timelinessTimer = startTimelinessReminderService();

  const mode = `${db.isPostgres ? 'PostgreSQL' : 'SQLite'}${process.env.REDIS_URL ? ' + Redis' : ''}`;
  logger.info({ port: PORT, mode }, 'LabelHub Backend Server started');

  // PM2: 通知进程管理器服务已就绪
  if (typeof process.send === 'function') {
    process.send('ready');
  }
});

// ─── Graceful shutdown ─────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  server.close((err) => {
    if (err) logger.error({ err }, 'Failed to close HTTP server');
    else logger.info('HTTP server closed');
  });

  if (io) {
    try {
      io.close(() => {
        logger.info('WebSocket server closed');
      });
    } catch (err) {
      logger.error({ err }, 'Failed to close WebSocket server');
    }
  }

  if (timelinessTimer) {
    clearInterval(timelinessTimer);
    logger.info('Timeliness reminder stopped');
  }

  if (typeof db.close === 'function') {
    try {
      db.close();
      logger.info('Database connection closed');
    } catch (err) {
      logger.error({ err }, 'Failed to close database');
    }
  }

  const { closeRedis } = require('./utils/redis');
  closeRedis().catch(() => {});

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  setTimeout(() => {
    logger.info('Server shut down');
    process.exit(0);
  }, 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

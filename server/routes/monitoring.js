/** 监控数据接收、系统统计和运行状态相关接口。 */
const express = require('express');
const crypto = require('crypto');
const db = require('../store/db');
const { logger } = require('../utils/logger');

const router = express.Router();

// sendBeacon 使用 text/plain 且不带 Authorization 头，因此单独解析文本请求体。
const textParser = express.text({ type: () => true, limit: '64kb' });

function parsePayload(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string' && body) {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @openapi
 * /api/error-report:
 *   post:
 *     summary: 前端全局错误上报（sendBeacon）
 *     tags: [Monitoring]
 *     responses:
 *       204:
 *         description: 已接收
 */
router.post('/error-report', textParser, (req, res) => {
  const payload = parsePayload(req.body) ?? { raw: String(req.body ?? '').slice(0, 2000) };
  logger.error({ clientError: payload }, 'Frontend error report');
  res.status(204).end();
});

// Core Web Vitals 采集与查询。
const VITAL_NAMES = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB']);
const MAX_ROWS = 50_000;

let insertCounter = 0;
function pruneIfNeeded() {
  insertCounter += 1;
  if (insertCounter % 500 !== 0) return;
  try {
    // 容量修剪：仅保留最近 MAX_ROWS 条（SQLite 专用，raw 语句）
    if (typeof db._db?.prepare === 'function') {
      db._db
        .prepare(
          `DELETE FROM web_vitals WHERE id IN (SELECT id FROM web_vitals ORDER BY timestamp DESC LIMIT -1 OFFSET ?)`,
        )
        .run(MAX_ROWS);
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'web-vitals prune skipped');
  }
}

/**
 * @openapi
 * /api/web-vitals:
 *   post:
 *     summary: Core Web Vitals 性能指标上报（sendBeacon，落库）
 *     tags: [Monitoring]
 *     responses:
 *       204:
 *         description: 已接收
 */
router.post('/web-vitals', textParser, (req, res) => {
  const payload = parsePayload(req.body);
  if (payload && VITAL_NAMES.has(payload.name)) {
    try {
      db.insert('web_vitals', {
        id: `wv${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
        name: String(payload.name),
        value: Number(payload.value) || 0,
        rating: typeof payload.rating === 'string' ? payload.rating.slice(0, 32) : null,
        page: typeof payload.page === 'string' ? payload.page.slice(0, 200) : null,
        navigationType:
          typeof payload.navigationType === 'string' ? payload.navigationType.slice(0, 32) : null,
        timestamp: new Date().toISOString(),
      });
      pruneIfNeeded();
    } catch (err) {
      // 落库失败（如 Postgres 后端未建表）不影响上报方，仅记录日志
      logger.warn({ err: err.message }, 'web-vitals persist skipped');
    }
  }
  res.status(204).end();
});

function p75(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(0.75 * (sorted.length - 1))];
}

/**
 * @openapi
 * /api/web-vitals/summary:
 *   get:
 *     summary: Web Vitals 汇总（各指标 p75 / rating 分布 / 按天趋势），仅 owner
 *     tags: [Monitoring]
 *     parameters:
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 7 }
 *     responses:
 *       200:
 *         description: 汇总数据
 */
router.get('/web-vitals/summary', (req, res) => {
  if (!req.currentUser || req.currentUser.role !== 'owner') {
    return res.fail('Only owner can view web vitals summary', 403);
  }

  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let rows = [];
  try {
    // 数据量由 MAX_ROWS 修剪兜底，内存过滤足够；量级增长时可换 SQL 聚合
    rows = db.getAll('web_vitals').filter((row) => row.timestamp >= since);
  } catch (err) {
    return res.fail(`web vitals storage unavailable: ${err.message}`, 500);
  }

  const metricAcc = new Map();
  const dayAcc = new Map();
  for (const row of rows) {
    let metric = metricAcc.get(row.name);
    if (!metric) {
      metric = { count: 0, values: [], ratings: { good: 0, 'needs-improvement': 0, poor: 0 } };
      metricAcc.set(row.name, metric);
    }
    metric.count += 1;
    metric.values.push(row.value);
    if (row.rating && metric.ratings[row.rating] !== undefined) {
      metric.ratings[row.rating] += 1;
    }

    const day = String(row.timestamp).slice(0, 10);
    const bucket = dayAcc.get(day) ?? {};
    (bucket[row.name] = bucket[row.name] ?? []).push(row.value);
    dayAcc.set(day, bucket);
  }

  const metrics = {};
  for (const [name, metric] of metricAcc.entries()) {
    metrics[name] = { count: metric.count, p75: p75(metric.values), ratings: metric.ratings };
  }

  const trend = Array.from(dayAcc.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, bucket]) => {
      const point = { date };
      for (const [name, values] of Object.entries(bucket)) {
        point[name] = p75(values);
      }
      return point;
    });

  res.success({
    days,
    total: rows.length,
    metrics,
    trend,
    updatedAt: new Date().toISOString(),
  });
});

module.exports = router;

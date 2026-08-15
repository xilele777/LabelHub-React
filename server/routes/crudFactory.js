/** 为标准资源提供带筛选、分页、缓存失效和权限钩子的 CRUD 路由工厂。 */
const crypto = require('crypto');
const db = require('../store/db');
const { cacheGet, cacheSet, cacheDel, cacheDelPattern } = require('../utils/cache');
const { logger } = require('../utils/logger');

// 各资源的缓存时间（秒）。
const CACHE_TTL = {
  templates: 300,
  users: 600,
  tasks: 120,
  // 标注项和审核结果写入频繁，不做缓存。
  'annotation-items': 0,
  reviews: 0,
};

function cacheTTL(collection) {
  return CACHE_TTL[collection] || 0;
}

function cacheKey(collection, id) {
  return id ? `${collection}:${id}` : `${collection}:list`;
}

async function readThroughCache(collection, id, fetchFn) {
  const ttl = cacheTTL(collection);
  if (ttl <= 0) return fetchFn();

  const key = cacheKey(collection, id);
  const cached = await cacheGet(key);
  if (cached !== null) return cached;

  const result = fetchFn();
  if (result !== null && result !== undefined) {
    await cacheSet(key, result, ttl);
  }
  return result;
}

async function invalidateItemCache(collection, id) {
  await cacheDel(cacheKey(collection, id));
  await cacheDel(cacheKey(collection, null));
}

const MAX_PAGE_LIMIT = Number(process.env.MAX_PAGE_LIMIT || 200);
const CONTROL_QUERY_KEYS = new Set(['_page', '_limit', '_sort', '_order']);

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function isSafeFieldName(field) {
  return typeof field === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(field);
}

function buildFilter(query) {
  const filter = {};
  for (const [key, rawValue] of Object.entries(query)) {
    if (CONTROL_QUERY_KEYS.has(key)) continue;
    if (!isSafeFieldName(key)) {
      return { error: `Unsupported filter field: ${key}` };
    }

    const value = firstQueryValue(rawValue);
    if (value !== undefined) {
      filter[key] = value;
    }
  }
  return { filter };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(firstQueryValue(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createCrudRouter(collection, opts = {}) {
  const router = require('express').Router();

  router.get('/', (req, res) => {
    const { filter, error } = buildFilter(req.query);
    if (error) {
      return res.fail(error);
    }

    const page = parsePositiveInt(req.query._page, 1);
    const requestedLimit = parsePositiveInt(req.query._limit, 0);
    const limit = requestedLimit > 0 ? Math.min(requestedLimit, MAX_PAGE_LIMIT) : 0;
    const sortField = firstQueryValue(req.query._sort);
    const sortOrder = firstQueryValue(req.query._order);

    let items;
    let total;
    if (opts.filterList) {
      // 自定义筛选通常包含权限、归档和任务状态等业务条件，因此在内存中统一处理。
      items = db.getAll(collection);
      items = opts.filterList(items, req);

      if (sortField) {
        if (!isSafeFieldName(sortField)) {
          return res.fail(`Unsupported sort field: ${sortField}`);
        }

        const order = sortOrder === 'desc' ? -1 : 1;
        items = [...items].sort((a, b) => {
          if (a[sortField] < b[sortField]) return -1 * order;
          if (a[sortField] > b[sortField]) return 1 * order;
          return 0;
        });
      }

      total = items.length;
      if (limit > 0) {
        const start = (page - 1) * limit;
        items = items.slice(start, start + limit);
      }
    } else {
      try {
        const result = db.list(collection, {
          filter,
          sort: sortField,
          order: sortOrder,
          page,
          limit,
        });
        items = result.items;
        total = result.total;
      } catch (err) {
        return res.fail(err.message || 'Invalid list query');
      }
    }

    if (opts.afterRead) {
      items = items.map((item) => opts.afterRead(item, req));
    }

    res.success({ items, total, page, limit: limit || total });
  });

  router.get('/:id', async (req, res) => {
    const item = await readThroughCache(collection, req.params.id, () =>
      db.getById(collection, req.params.id),
    );
    if (!item) {
      return res.notFound(`${collection} not found`);
    }
    const result = opts.afterRead ? opts.afterRead(item, req) : item;
    res.success(result);
  });

  router.post('/', async (req, res) => {
    let item = { ...req.body };

    if (!item.id) {
      item.id = `${collection[0]}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    }

    if (!item.createdAt) {
      item.createdAt = new Date().toISOString();
    }

    if (opts.beforeCreate) {
      item = opts.beforeCreate(item, req);
      if (typeof item === 'string') {
        return res.fail(item, 403);
      }
      if (!item) {
        return res.fail('Create failed: validation did not pass');
      }
    }

    try {
      var created = db.insert(collection, item);
    } catch (err) {
      logger.error({ err, collection }, 'Create failed');
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return res.fail('Create failed: id conflict, please retry');
      }
      return res.fail(`Create failed: ${err.message || 'database error'}`);
    }

    // 写操作后同时清理单项和列表缓存。
    invalidateItemCache(collection, item.id).catch(() => {});

    const result = opts.afterRead ? opts.afterRead(created, req) : created;
    res.success(result, 'Created', 201);
  });

  router.put('/:id', async (req, res) => {
    const existing = db.getById(collection, req.params.id);
    if (!existing) {
      return res.notFound(`${collection} not found`);
    }

    const updates = { ...req.body };
    delete updates.id;

    if (opts.beforeUpdate) {
      const validated = opts.beforeUpdate(existing, updates, req);
      if (typeof validated === 'string') {
        return res.fail(validated);
      }
      if (validated && typeof validated === 'object') {
        Object.assign(updates, validated);
      }
    }

    const updated = db.updateById(collection, req.params.id, updates);
    const result = opts.afterRead ? opts.afterRead(updated, req) : updated;

    // 写操作后同时清理单项和列表缓存。
    invalidateItemCache(collection, req.params.id).catch(() => {});

    res.success(result, 'Updated');
  });

  router.delete('/:id', async (req, res) => {
    const existing = db.getById(collection, req.params.id);
    if (!existing) {
      return res.notFound(`${collection} not found`);
    }

    if (opts.beforeDelete) {
      const denied = opts.beforeDelete(existing, req);
      if (typeof denied === 'string') {
        return res.fail(denied, 403);
      }
    }

    db.deleteById(collection, req.params.id);

    // 写操作后同时清理单项和列表缓存。
    invalidateItemCache(collection, req.params.id).catch(() => {});

    res.success(null, 'Deleted');
  });

  return router;
}

module.exports = createCrudRouter;

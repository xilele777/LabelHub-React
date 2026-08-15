/**
 * PostgreSQL 数据库适配器。
 * 使用连接池实现与 SQLite 适配器兼容的数据访问接口。
 */

const { Pool } = require('pg');
const path = require('path');

// 连接池。

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // 必须通过环境变量设置，无默认值
  min: Number(process.env.PG_POOL_MIN || 2),
  max: Number(process.env.PG_POOL_MAX || 10),
});

pool.on('error', (err) => {
  console.error('[PG] Unexpected pool error:', err.message);
});

// 表名映射。

function getTableName(collectionName) {
  return collectionName.replace(/-/g, '_');
}

// 表结构初始化。

let tablesInitialized = false;

async function ensureTables() {
  if (tablesInitialized) return;
  tablesInitialized = true;

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          VARCHAR PRIMARY KEY,
        username    VARCHAR NOT NULL UNIQUE,
        password    VARCHAR NOT NULL,
        avatar      VARCHAR,
        role        VARCHAR NOT NULL DEFAULT 'annotator',
        createdAt   TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS templates (
        id          VARCHAR PRIMARY KEY,
        name        VARCHAR NOT NULL,
        description VARCHAR,
        type        VARCHAR NOT NULL,
        fieldCount  INTEGER DEFAULT 0,
        creator     VARCHAR,
        createdAt   TIMESTAMPTZ DEFAULT NOW(),
        fields      JSONB DEFAULT '[]'::jsonb
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id            VARCHAR PRIMARY KEY,
        name          VARCHAR NOT NULL,
        description   VARCHAR,
        type          VARCHAR NOT NULL,
        owner         VARCHAR,
        templateId    VARCHAR,
        templateName  VARCHAR,
        instructions  VARCHAR,
        status        VARCHAR NOT NULL DEFAULT 'draft',
        createdAt     TIMESTAMPTZ DEFAULT NOW(),
        assignmentConfig JSONB DEFAULT '{}'::jsonb,
        archived      BOOLEAN NOT NULL DEFAULT FALSE,
        archivedAt    TIMESTAMPTZ,
        startsAt      TIMESTAMPTZ,
        dueAt         TIMESTAMPTZ,
        reminderHours INTEGER NOT NULL DEFAULT 24,
        overdueStrategy VARCHAR NOT NULL DEFAULT 'remind_only',
        reviewStartsAt TIMESTAMPTZ,
        reviewDueAt   TIMESTAMPTZ,
        reviewReminderHours INTEGER NOT NULL DEFAULT 24,
        reviewOverdueStrategy VARCHAR NOT NULL DEFAULT 'remind_only',
        annotationDueSoonNotifiedAt TIMESTAMPTZ,
        reviewDueSoonNotifiedAt TIMESTAMPTZ,
        annotationTimeoutHours INTEGER NOT NULL DEFAULT 24,
        reviewTimeoutHours INTEGER NOT NULL DEFAULT 24,
        taskEndedNotifiedAt TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS annotation_items (
        id              VARCHAR PRIMARY KEY,
        taskId          VARCHAR NOT NULL,
        rawData         JSONB DEFAULT '{}'::jsonb,
        status          VARCHAR NOT NULL DEFAULT 'pending',
        annotationData  JSONB,
        annotator       VARCHAR,
        submittedAt     TIMESTAMPTZ,
        reviewer        VARCHAR,
        reviewedAt      TIMESTAMPTZ,
        rejectReason    VARCHAR,
        auditHistory    JSONB DEFAULT '[]'::jsonb,
        createdAt       TIMESTAMPTZ DEFAULT NOW(),
        version         INTEGER NOT NULL DEFAULT 1,
        lockedBy        VARCHAR,
        lockedAt        TIMESTAMPTZ,
        archived        BOOLEAN NOT NULL DEFAULT FALSE,
        archivedAt      TIMESTAMPTZ,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS reviews (
        id            VARCHAR PRIMARY KEY,
        dataItemId    VARCHAR NOT NULL,
        taskId        VARCHAR NOT NULL,
        templateId    VARCHAR,
        reviewStatus  VARCHAR NOT NULL DEFAULT 'pending',
        score         INTEGER DEFAULT 0,
        summary       VARCHAR,
        matchedRules  JSONB DEFAULT '[]'::jsonb,
        fieldWarnings JSONB DEFAULT '[]'::jsonb,
        suggestions   JSONB DEFAULT '[]'::jsonb,
        reviewedAt    TIMESTAMPTZ,
        modelVersion  VARCHAR,
        FOREIGN KEY (dataItemId) REFERENCES annotation_items(id) ON DELETE CASCADE,
        FOREIGN KEY (taskId) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id                VARCHAR PRIMARY KEY,
        recipientUserId   VARCHAR,
        recipientUsername VARCHAR NOT NULL,
        type              VARCHAR NOT NULL,
        title             VARCHAR NOT NULL,
        message           VARCHAR NOT NULL,
        priority          VARCHAR NOT NULL DEFAULT 'low',
        data              JSONB DEFAULT '{}'::jsonb,
        sender            VARCHAR,
        targetUsers       JSONB DEFAULT '[]'::jsonb,
        timestamp         VARCHAR NOT NULL,
        read              BOOLEAN NOT NULL DEFAULT FALSE,
        readAt            VARCHAR,
        deleted           BOOLEAN NOT NULL DEFAULT FALSE,
        deletedAt         VARCHAR
      );
    `);

    // 为常用筛选字段建立索引，要求 PostgreSQL 9.5 及以上。
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_annotation_items_taskId ON annotation_items(taskId);
      CREATE INDEX IF NOT EXISTS idx_annotation_items_status ON annotation_items(status);
      CREATE INDEX IF NOT EXISTS idx_annotation_items_annotator ON annotation_items(annotator);
      CREATE INDEX IF NOT EXISTS idx_annotation_items_lockedBy ON annotation_items(lockedBy);
      CREATE INDEX IF NOT EXISTS idx_reviews_dataItemId ON reviews(dataItemId);
      CREATE INDEX IF NOT EXISTS idx_reviews_taskId ON reviews(taskId);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipientUsername);
      CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipientUsername, read);
      CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    `);

    await client.query(
      `UPDATE annotation_items
       SET status = 'pending_review', version = version + 1
       WHERE status = ANY($1::varchar[])`,
      [['ai_reviewing', 'ai_reviewed']],
    );

    console.log('[PG] 数据库表已初始化');
  } finally {
    client.release();
  }
}

// 列值转换工具。

function getColumnNames(client, tableName, cached) {
  if (cached && columnCache[tableName]) return columnCache[tableName];
  // 字段信息按需缓存。
  return null; // Will be fetched on first use
}

const columnCache = {};

async function getAllowedColumns(name) {
  if (columnCache[name]) return columnCache[name];
  const tableName = getTableName(name);
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tableName],
  );
  columnCache[name] = new Set(rows.map((r) => r.column_name));
  return columnCache[name];
}

function assertSafeFilterSync(name, filter = {}) {
  // 同步兼容层仅接受白名单格式的字段名。
  for (const key of Object.keys(filter)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Unsupported filter field: ${key}`);
    }
  }
}

function buildWhereClause(filter = {}, offset = 0) {
  const clauses = [];
  const params = [];
  let i = offset;

  for (const [key, value] of Object.entries(filter)) {
    i++;
    if (value === null) {
      clauses.push(`${key} IS NULL`);
    } else {
      clauses.push(`${key} = $${i}`);
      // JSONB 直接存储对象；简单标量筛选仍使用等值比较。
      params.push(value);
    }
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    nextIndex: i + 1,
  };
}

// 行数据转换；JSONB 已由驱动解析。

function transformUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    password: row.password,
    avatar: row.avatar,
    role: row.role,
    createdAt: row.createdat ? String(row.createdat) : null,
  };
}

function transformTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    fieldCount: row.fieldcount,
    creator: row.creator,
    createdAt: row.createdat ? String(row.createdat) : null,
    fields: Array.isArray(row.fields) ? row.fields : [],
  };
}

function transformTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    owner: row.owner,
    templateId: row.templateid,
    templateName: row.templatename,
    instructions: row.instructions,
    status: row.status,
    createdAt: row.createdat ? String(row.createdat) : null,
    startsAt: row.startsat ? String(row.startsat) : null,
    dueAt: row.dueat ? String(row.dueat) : null,
    reminderHours: Number(row.reminderhours ?? 24),
    overdueStrategy: row.overduestrategy || 'remind_only',
    reviewStartsAt: row.reviewstartsat ? String(row.reviewstartsat) : null,
    reviewDueAt: row.reviewdueat ? String(row.reviewdueat) : null,
    reviewReminderHours: Number(row.reviewreminderhours ?? 24),
    reviewOverdueStrategy: row.reviewoverduestrategy || 'remind_only',
    annotationDueSoonNotifiedAt: row.annotationduesoonnotifiedat
      ? String(row.annotationduesoonnotifiedat)
      : null,
    reviewDueSoonNotifiedAt: row.reviewduesoonnotifiedat
      ? String(row.reviewduesoonnotifiedat)
      : null,
    annotationTimeoutHours: Number(row.annotationtimeouthours ?? row.reminderhours ?? 24),
    reviewTimeoutHours: Number(row.reviewtimeouthours ?? row.reviewreminderhours ?? 24),
    taskEndedNotifiedAt: row.taskendednotifiedat ? String(row.taskendednotifiedat) : null,
    assignmentConfig:
      row.assignmentconfig && typeof row.assignmentconfig === 'object' ? row.assignmentconfig : {},
    archived: Boolean(row.archived),
    archivedAt: row.archivedat ? String(row.archivedat) : null,
  };
}

function transformAnnotationItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.taskid,
    rawData: row.rawdata && typeof row.rawdata === 'object' ? row.rawdata : {},
    status: row.status,
    annotationData:
      row.annotationdata && typeof row.annotationdata === 'object' ? row.annotationdata : null,
    annotator: row.annotator,
    submittedAt: row.submittedat ? String(row.submittedat) : null,
    reviewer: row.reviewer,
    reviewedAt: row.reviewedat ? String(row.reviewedat) : null,
    rejectReason: row.rejectreason,
    auditHistory: Array.isArray(row.audithistory) ? row.audithistory : [],
    createdAt: row.createdat ? String(row.createdat) : null,
    version: row.version,
    lockedBy: row.lockedby,
    lockedAt: row.lockedat ? String(row.lockedat) : null,
    archived: Boolean(row.archived),
    archivedAt: row.archivedat ? String(row.archivedat) : null,
  };
}

function transformReview(row) {
  if (!row) return null;
  return {
    id: row.id,
    dataItemId: row.dataitemid,
    taskId: row.taskid,
    templateId: row.templateid,
    reviewStatus: row.reviewstatus,
    score: row.score,
    summary: row.summary,
    matchedRules: Array.isArray(row.matchedrules) ? row.matchedrules : [],
    fieldWarnings: Array.isArray(row.fieldwarnings) ? row.fieldwarnings : [],
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
    reviewedAt: row.reviewedat ? String(row.reviewedat) : null,
    modelVersion: row.modelversion,
  };
}

function transformNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    recipientUserId: row.recipientuserid,
    recipientUsername: row.recipientusername,
    type: row.type,
    title: row.title,
    message: row.message,
    priority: row.priority,
    data: row.data && typeof row.data === 'object' ? row.data : {},
    sender: row.sender,
    targetUsers: Array.isArray(row.targetusers) ? row.targetusers : [],
    timestamp: row.timestamp,
    read: Boolean(row.read),
    readAt: row.readat || null,
    deleted: Boolean(row.deleted),
    deletedAt: row.deletedat || null,
  };
}

const TRANSFORMS = {
  users: transformUser,
  templates: transformTemplate,
  tasks: transformTask,
  'annotation-items': transformAnnotationItem,
  reviews: transformReview,
};

function getTransform(name) {
  return TRANSFORMS[name];
}

// 通用 CRUD。

// 同步兼容层首次读取集合后缓存数据，写入时使缓存失效。

const collectionCache = new Map();

function _getCollectionCacheKey(name) {
  return `cache:${name}`;
}

function _invalidateCache(name) {
  collectionCache.delete(_getCollectionCacheKey(name));
}

async function _loadCollection(name) {
  const tableName = getTableName(name);
  const transform = getTransform(name);
  const { rows } = await pool.query(`SELECT * FROM ${tableName}`);
  return transform ? rows.map(transform) : rows;
}

// 对外同步接口，通过缓存桥接异步数据库操作。

// 通过预热缓存提供同步外观，兼容现有调用方；原生异步接口仍单独导出。

let _warmed = false;

async function _warmup() {
  if (_warmed) return;
  await ensureTables();
  // 预加载业务集合。
  for (const name of ['users', 'templates', 'tasks', 'annotation-items', 'reviews']) {
    const items = await _loadCollection(name);
    collectionCache.set(_getCollectionCacheKey(name), items);
  }
  // 预加载通知缓存。
  const allNotifs = await _loadNotifs(null);
  notifCache.set('all', allNotifs);
  _warmed = true;
  console.log('[PG] 缓存预热完成');
}

function _getCached(name) {
  const key = _getCollectionCacheKey(name);
  if (!collectionCache.has(key)) {
    // 首次未命中时启动异步加载，本次先返回空集合。
    _loadCollection(name)
      .then((items) => {
        collectionCache.set(key, items);
      })
      .catch((err) => {
        console.error(`[PG] Failed to load collection ${name}:`, err.message);
      });
    return [];
  }
  return collectionCache.get(key);
}

async function _refreshCache(name) {
  const items = await _loadCollection(name);
  collectionCache.set(_getCollectionCacheKey(name), items);
  return items;
}

// 对外 API。

async function getAllAsync(name) {
  await ensureTables();
  return _loadCollection(name);
}

function getAll(name) {
  // 同步查询从缓存读取。
  _warmup().catch(() => {});
  return _getCached(name);
}

async function getByIdAsync(name, id) {
  await ensureTables();
  const tableName = getTableName(name);
  const transform = getTransform(name);
  const { rows } = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);
  const row = rows[0] || null;
  return transform ? transform(row) : row;
}

function getById(name, id) {
  // 同步单条查询从缓存检索。
  const items = getAll(name);
  return items.find((item) => item.id === id) || null;
}

async function findAsync(name, filter = {}) {
  await ensureTables();
  assertSafeFilterSync(name, filter);
  const tableName = getTableName(name);
  const transform = getTransform(name);
  const { where, params } = buildWhereClause(filter);
  const { rows } = await pool.query(`SELECT * FROM ${tableName} ${where}`, params);
  return transform ? rows.map(transform) : rows;
}

function find(name, filter = {}) {
  // 同步条件查询在缓存中筛选。
  const items = getAll(name);
  return items.filter((item) => {
    for (const [key, value] of Object.entries(filter)) {
      if (item[key] !== value) return false;
    }
    return true;
  });
}

async function listAsync(name, options = {}) {
  await ensureTables();
  const filter = options.filter || {};
  assertSafeFilterSync(name, filter);
  const tableName = getTableName(name);
  const transform = getTransform(name);

  const { where, params } = buildWhereClause(filter, 0);

  // 统计总数。
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM ${tableName} ${where}`,
    params,
  );
  const total = Number(countResult.rows[0].total);

  // 排序。
  const sortField = options.sort || null;
  const order = String(options.order || '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  let orderClause = '';
  let sortParams = [];
  if (sortField && /^[A-Za-z_][A-Za-z0-9_]*$/.test(sortField)) {
    orderClause = `ORDER BY ${sortField} ${order}`;
  }

  // 分页。
  const limit = Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : 0;
  const page = Number(options.page) > 0 ? Math.floor(Number(options.page)) : 1;
  const offset = (page - 1) * limit;
  let limitClause = '';
  const allParams = [...params];
  if (limit > 0) {
    allParams.push(limit, offset);
    limitClause = `LIMIT $${allParams.length - 1} OFFSET $${allParams.length}`;
  }

  const { rows } = await pool.query(
    `SELECT * FROM ${tableName} ${where} ${orderClause} ${limitClause}`,
    allParams,
  );
  const items = transform ? rows.map(transform) : rows;
  return { items, total, page, limit: limit || total };
}

function list(name, options = {}) {
  // 同步列表接口在缓存中完成筛选、排序和分页。
  const filter = options.filter || {};
  const allItems = getAll(name);
  let items = allItems.filter((item) => {
    for (const [key, value] of Object.entries(filter)) {
      if (item[key] !== value) return false;
    }
    return true;
  });

  const sortField = options.sort;
  if (sortField && /^[A-Za-z_][A-Za-z0-9_]*$/.test(sortField)) {
    const order = String(options.order || '').toLowerCase() === 'desc' ? -1 : 1;
    items = [...items].sort((a, b) => {
      if (a[sortField] < b[sortField]) return -1 * order;
      if (a[sortField] > b[sortField]) return 1 * order;
      return 0;
    });
  }

  const total = items.length;
  const limit = Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : 0;
  const page = Number(options.page) > 0 ? Math.floor(Number(options.page)) : 1;
  if (limit > 0) {
    const start = (page - 1) * limit;
    items = items.slice(start, start + limit);
  }
  return { items, total, page, limit: limit || total };
}

function findOne(name, filter = {}) {
  const results = find(name, filter);
  return results.length > 0 ? results[0] : null;
}

async function insertAsync(name, item) {
  await ensureTables();
  const tableName = getTableName(name);
  const keys = Object.keys(item);
  const values = Object.values(item);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const columns = keys.join(', ');

  await pool.query(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`, values);
  _invalidateCache(name);
  return item;
}

function insert(name, item) {
  insertAsync(name, item).catch((err) => {
    console.error(`[PG] Insert failed for ${name}:`, err.message);
  });
  _invalidateCache(name);
  return item;
}

async function updateByIdAsync(name, id, updates) {
  await ensureTables();
  const tableName = getTableName(name);

  const setClauses = [];
  const values = [];
  let i = 1;
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === '_skipVersionIncrement') continue;
    setClauses.push(`${key} = $${i}`);
    values.push(value);
    i++;
  }

  // 标注项更新时自动增加版本号。
  if (name === 'annotation-items' && !updates._skipVersionIncrement) {
    setClauses.push(`version = version + 1`);
  }

  if (setClauses.length === 0) {
    return getById(name, id);
  }

  values.push(id);
  await pool.query(`UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $${i}`, values);
  _invalidateCache(name);
  return getById(name, id);
}

function updateById(name, id, updates) {
  updateByIdAsync(name, id, updates).catch((err) => {
    console.error(`[PG] Update failed for ${name}:`, err.message);
  });
  _invalidateCache(name);

  // 根据缓存计算合并后的返回结果。
  const existing = getById(name, id);
  if (!existing) return null;
  const merged = { ...existing, ...updates, id };
  delete merged._skipVersionIncrement;
  if (name === 'annotation-items' && !updates._skipVersionIncrement) {
    merged.version = (existing.version || 1) + 1;
  }
  return merged;
}

function updateWithVersionCheck(id, updates, clientVersion) {
  const existing = getById('annotation-items', id);
  if (!existing) return { conflict: false, updatedItem: null };

  if (clientVersion !== undefined && clientVersion !== null && existing.version !== clientVersion) {
    return {
      conflict: true,
      currentVersion: existing.version,
      serverItem: existing,
    };
  }

  const updatedItem = updateById('annotation-items', id, updates);
  return { conflict: false, updatedItem };
}

function claimItem(id, username, lockTimeoutMs = 30 * 60 * 1000) {
  const existing = getById('annotation-items', id);
  if (!existing) return { claimed: false, notFound: true };

  if (existing.lockedBy && existing.lockedBy !== username && existing.lockedAt) {
    const lockAge = Date.now() - new Date(existing.lockedAt).getTime();
    if (lockAge < lockTimeoutMs) {
      return { claimed: false, lockedBy: existing.lockedBy, lockedAt: existing.lockedAt };
    }
  }

  const now = new Date().toISOString();
  const updatedItem = updateById('annotation-items', id, {
    lockedBy: username,
    lockedAt: now,
    _skipVersionIncrement: true,
  });
  return { claimed: true, item: updatedItem };
}

function releaseItem(id, username) {
  const existing = getById('annotation-items', id);
  if (!existing) return { released: false, notFound: true };

  if (existing.lockedBy && existing.lockedBy !== username) {
    return { released: false, lockedBy: existing.lockedBy };
  }

  const updatedItem = updateById('annotation-items', id, {
    lockedBy: null,
    lockedAt: null,
    _skipVersionIncrement: true,
  });
  return { released: true, item: updatedItem };
}

function releaseAllByUser(username) {
  const items = getAll('annotation-items');
  let count = 0;
  for (const item of items) {
    if (item.lockedBy === username) {
      updateById('annotation-items', item.id, {
        lockedBy: null,
        lockedAt: null,
        _skipVersionIncrement: true,
      });
      count++;
    }
  }
  return count;
}

function cleanExpiredLocks(lockTimeoutMs = 30 * 60 * 1000) {
  const items = getAll('annotation-items');
  let count = 0;
  const now = Date.now();
  for (const item of items) {
    if (item.lockedBy && item.lockedAt) {
      const lockAge = now - new Date(item.lockedAt).getTime();
      if (lockAge >= lockTimeoutMs) {
        updateById('annotation-items', item.id, {
          lockedBy: null,
          lockedAt: null,
          _skipVersionIncrement: true,
        });
        count++;
      }
    }
  }
  return count;
}

function replaceById(name, id, newItem) {
  return updateById(name, id, { ...newItem, id });
}

async function deleteByIdAsync(name, id) {
  await ensureTables();
  const tableName = getTableName(name);
  const result = await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [id]);
  _invalidateCache(name);
  return result.rowCount > 0;
}

function deleteById(name, id) {
  deleteByIdAsync(name, id).catch((err) => {
    console.error(`[PG] Delete failed for ${name}:`, err.message);
  });
  _invalidateCache(name);
  return true;
}

async function countAsync(name, filter = {}) {
  await ensureTables();
  const tableName = getTableName(name);
  if (Object.keys(filter).length === 0) {
    const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
    return Number(rows[0].total);
  }
  assertSafeFilterSync(name, filter);
  const { where, params } = buildWhereClause(filter);
  const { rows } = await pool.query(`SELECT COUNT(*) AS total FROM ${tableName} ${where}`, params);
  return Number(rows[0].total);
}

function count(name, filter = {}) {
  const items = getAll(name);
  if (Object.keys(filter).length === 0) {
    return items.length;
  }
  return items.filter((item) => {
    for (const [key, value] of Object.entries(filter)) {
      if (item[key] !== value) return false;
    }
    return true;
  }).length;
}

async function seedAsync(name, data) {
  await ensureTables();
  const tableName = getTableName(name);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM ${tableName}`);

    for (const item of data) {
      const keys = Object.keys(item);
      const values = Object.values(item);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const columns = keys.join(', ');
      await client.query(`INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`, values);
    }

    await client.query('COMMIT');
    _invalidateCache(name);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function seed(name, data) {
  seedAsync(name, data).catch((err) => {
    console.error(`[PG] Seed failed for ${name}:`, err.message);
  });
  _invalidateCache(name);
}

async function transactionAsync(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: (text, params) => client.query(text, params),
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function transaction(fn) {
  // 同步包装层异步提交事务，调用方不等待结果。
  transactionAsync(fn).catch((err) => {
    console.error('[PG] Transaction failed:', err.message);
  });
}

async function isSeededAsync() {
  await ensureTables();
  const { rows } = await pool.query('SELECT COUNT(*) AS total FROM users');
  return Number(rows[0].total) > 0;
}

function isSeeded() {
  return getAll('users').length > 0;
}

// 通知缓存。

const notifCache = new Map(); // key: "all" | "user:{username}", value: notification[]

function _getNotifCacheKey(username) {
  return username ? `user:${username}` : 'all';
}

function _getCachedNotifs(username) {
  const key = _getNotifCacheKey(username);
  if (!notifCache.has(key)) {
    _loadNotifs(username)
      .then((items) => notifCache.set(key, items))
      .catch(() => {});
    return [];
  }
  return notifCache.get(key) || [];
}

function _invalidateNotifCache(username) {
  if (username) {
    notifCache.delete(`user:${username}`);
  }
  notifCache.delete('all');
}

async function _loadNotifs(username) {
  await ensureTables();
  if (username) {
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE recipientUsername = $1 AND deleted = false ORDER BY timestamp DESC LIMIT 200`,
      [username],
    );
    return rows.map(transformNotification);
  }
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE deleted = false ORDER BY timestamp DESC LIMIT 500`,
  );
  return rows.map(transformNotification);
}

// 通知同步接口。

function getNotificationsForUser(username, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 200));
  const all = _getCachedNotifs(username);
  return all.slice(0, limit);
}

function getNotificationsForUserByType(username, type, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 200));
  return _getCachedNotifs(username)
    .filter((n) => n.type === type)
    .slice(0, limit);
}

function getNotificationsForUserByTypes(username, types, options = {}) {
  const safeTypes = [...new Set((types || []).filter(Boolean))];
  if (safeTypes.length === 0) return [];
  const limit = Math.max(1, Math.min(Number(options.limit) || 100, 200));
  return _getCachedNotifs(username)
    .filter((n) => safeTypes.includes(n.type))
    .slice(0, limit);
}

function getNotificationCountForUser(username) {
  return _getCachedNotifs(username).length;
}

function getNotificationCountForUserByType(username, type) {
  return _getCachedNotifs(username).filter((n) => n.type === type).length;
}

function getNotificationCountForUserByTypes(username, types) {
  const safeTypes = [...new Set((types || []).filter(Boolean))];
  if (safeTypes.length === 0) return 0;
  return _getCachedNotifs(username).filter((n) => safeTypes.includes(n.type)).length;
}

function getUnreadNotificationCountForUser(username) {
  return _getCachedNotifs(username).filter((n) => !n.read).length;
}

function getUnreadNotificationCountForUserByType(username, type) {
  return _getCachedNotifs(username).filter((n) => !n.read && n.type === type).length;
}

function getUnreadNotificationCountForUserByTypes(username, types) {
  const safeTypes = [...new Set((types || []).filter(Boolean))];
  if (safeTypes.length === 0) return 0;
  return _getCachedNotifs(username).filter((n) => !n.read && safeTypes.includes(n.type)).length;
}

async function _markReadAsync(username, notificationId) {
  await ensureTables();
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE notifications SET read = true, readAt = COALESCE(readAt, $1) WHERE id = $2 AND recipientUsername = $3 AND deleted = false`,
    [now, notificationId, username],
  );
  _invalidateNotifCache(username);
}

function markNotificationReadForUser(username, notificationId) {
  _markReadAsync(username, notificationId).catch((err) => {
    console.error('[PG] markRead failed:', err.message);
  });
  // 先更新缓存，再异步写入数据库。
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    const items = notifCache.get(key);
    const idx = items.findIndex((n) => n.id === notificationId);
    if (idx >= 0) {
      items[idx] = { ...items[idx], read: true, readAt: new Date().toISOString() };
    }
  }
  return true;
}

async function _markAllReadAsync(username) {
  await ensureTables();
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE notifications SET read = true, readAt = COALESCE(readAt, $1) WHERE recipientUsername = $2 AND deleted = false AND read = false`,
    [now, username],
  );
  _invalidateNotifCache(username);
  return result.rowCount;
}

function markAllNotificationsReadForUser(username) {
  _markAllReadAsync(username).catch((err) => {
    console.error('[PG] markAllRead failed:', err.message);
  });
  // 乐观更新缓存。
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache
        .get(key)
        .map((n) => (n.read ? n : { ...n, read: true, readAt: new Date().toISOString() })),
    );
  }
  return 0; // Async, caller doesn't depend on exact count
}

async function _markAllReadByTypeAsync(username, type) {
  await ensureTables();
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE notifications SET read = true, readAt = COALESCE(readAt, $1) WHERE recipientUsername = $2 AND type = $3 AND deleted = false AND read = false`,
    [now, username, type],
  );
  _invalidateNotifCache(username);
  return result.rowCount;
}

function markAllNotificationsReadForUserByType(username, type) {
  _markAllReadByTypeAsync(username, type).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache
        .get(key)
        .map((n) =>
          n.read || n.type !== type ? n : { ...n, read: true, readAt: new Date().toISOString() },
        ),
    );
  }
  return 0;
}

function markAllNotificationsReadForUserByTypes(username, types) {
  const safeTypes = [...new Set((types || []).filter(Boolean))];
  if (safeTypes.length === 0) return 0;
  Promise.all(safeTypes.map((t) => _markAllReadByTypeAsync(username, t))).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache
        .get(key)
        .map((n) =>
          n.read || !safeTypes.includes(n.type)
            ? n
            : { ...n, read: true, readAt: new Date().toISOString() },
        ),
    );
  }
  return 0;
}

async function _deleteNotifAsync(username, notificationId) {
  await ensureTables();
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE notifications SET deleted = true, deletedAt = $1 WHERE id = $2 AND recipientUsername = $3`,
    [now, notificationId, username],
  );
  _invalidateNotifCache(username);
}

function deleteNotificationForUser(username, notificationId) {
  _deleteNotifAsync(username, notificationId).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache.get(key).filter((n) => n.id !== notificationId),
    );
  }
  return true;
}

async function _clearNotifsAsync(username, type = null) {
  await ensureTables();
  const now = new Date().toISOString();
  let result;
  if (type) {
    result = await pool.query(
      `UPDATE notifications SET deleted = true, deletedAt = $1 WHERE recipientUsername = $2 AND type = $3 AND deleted = false`,
      [now, username, type],
    );
  } else {
    result = await pool.query(
      `UPDATE notifications SET deleted = true, deletedAt = $1 WHERE recipientUsername = $2 AND deleted = false`,
      [now, username],
    );
  }
  _invalidateNotifCache(username);
  return result.rowCount;
}

function clearNotificationsForUser(username) {
  _clearNotifsAsync(username).catch(() => {});
  notifCache.delete(_getNotifCacheKey(username));
  return 0;
}

function clearNotificationsForUserByType(username, type) {
  _clearNotifsAsync(username, type).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache.get(key).filter((n) => n.type !== type),
    );
  }
  return 0;
}

function clearNotificationsForUserByTypes(username, types) {
  const safeTypes = [...new Set((types || []).filter(Boolean))];
  if (safeTypes.length === 0) return 0;
  Promise.all(safeTypes.map((t) => _clearNotifsAsync(username, t))).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache.get(key).filter((n) => !safeTypes.includes(n.type)),
    );
  }
  return 0;
}

function clearNotificationsForUserExceptType(username, type) {
  // 清理通知时保留指定类型。
  _clearNotifsExceptAsync(username, type).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache.get(key).filter((n) => n.type === type),
    );
  }
  return 0;
}

async function _clearNotifsExceptAsync(username, type) {
  await ensureTables();
  const now = new Date().toISOString();
  const result = await pool.query(
    `UPDATE notifications SET deleted = true, deletedAt = $1 WHERE recipientUsername = $2 AND type <> $3 AND deleted = false`,
    [now, username, type],
  );
  _invalidateNotifCache(username);
  return result.rowCount;
}

function clearNotificationsForUserExceptTypes(username, types) {
  const safeTypes = [...new Set((types || []).filter(Boolean))];
  if (safeTypes.length === 0) return clearNotificationsForUser(username);
  _clearNotifsExceptTypesAsync(username, safeTypes).catch(() => {});
  const key = _getNotifCacheKey(username);
  if (notifCache.has(key)) {
    notifCache.set(
      key,
      notifCache.get(key).filter((n) => safeTypes.includes(n.type)),
    );
  }
  return 0;
}

async function _clearNotifsExceptTypesAsync(username, types) {
  await ensureTables();
  const now = new Date().toISOString();
  const placeholders = types.map((_, i) => `$${i + 3}`).join(', ');
  const result = await pool.query(
    `UPDATE notifications SET deleted = true, deletedAt = $1 WHERE recipientUsername = $2 AND type NOT IN (${placeholders}) AND deleted = false`,
    [now, username, ...types],
  );
  _invalidateNotifCache(username);
  return result.rowCount;
}

function getOwnerPublishedNotificationRows(sender = null, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 200, 500));
  const all = _getCachedNotifs(null);
  let filtered = all.filter((n) => n.type === 'owner_message');
  if (sender) filtered = filtered.filter((n) => n.sender === sender);
  return filtered.slice(0, limit);
}

function getPublishedNotificationRowsByPublishId(sender = null, publishId) {
  const all = _getCachedNotifs(null);
  return all.filter(
    (n) =>
      n.type === 'owner_message' &&
      (!sender || n.sender === sender) &&
      n.data?.publishId === publishId,
  );
}

async function updatePublishedNotificationDataAsync(sender, publishId, updater) {
  await ensureTables();
  const rows = getPublishedNotificationRowsByPublishId(sender, publishId);
  if (rows.length === 0) return 0;

  let updated = 0;
  for (const item of rows) {
    const next = updater(item);
    await pool.query(
      `UPDATE notifications SET data = $1, deleted = $2, deletedAt = $3 WHERE id = $4`,
      [
        JSON.stringify(next.data || {}),
        next.deleted ? true : false,
        next.deletedAt || null,
        item.id,
      ],
    );
    updated++;
    _invalidateNotifCache(item.recipientUsername);
  }
  notifCache.delete('all');
  return updated;
}

function updatePublishedNotificationData(sender = null, publishId, updater) {
  updatePublishedNotificationDataAsync(sender, publishId, updater).catch((err) => {
    console.error('[PG] updatePublishedNotificationData failed:', err.message);
  });
  return 0;
}

// 通知写入同时维护缓存。
async function insertNotificationAsync(notification) {
  await ensureTables();
  const item = {
    ...notification,
    data: notification.data || {},
    targetUsers: notification.targetUsers || [],
    timestamp: notification.timestamp || new Date().toISOString(),
    read: notification.read ? true : false,
    deleted: notification.deleted ? true : false,
  };

  await pool.query(
    `INSERT INTO notifications (id, recipientUserId, recipientUsername, type, title, message, priority, data, sender, targetUsers, timestamp, read, readAt, deleted, deletedAt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      item.id,
      item.recipientUserId || null,
      item.recipientUsername,
      item.type,
      item.title,
      item.message,
      item.priority || 'low',
      JSON.stringify(item.data),
      item.sender || null,
      JSON.stringify(item.targetUsers),
      item.timestamp,
      item.read,
      item.readAt || null,
      item.deleted,
      item.deletedAt || null,
    ],
  );

  // 更新缓存。
  if (item.recipientUsername) {
    const key = _getNotifCacheKey(item.recipientUsername);
    if (notifCache.has(key)) {
      notifCache.set(key, [item, ...notifCache.get(key)]);
    }
  }
  const allKey = _getNotifCacheKey(null);
  if (notifCache.has(allKey)) {
    notifCache.set(allKey, [item, ...notifCache.get(allKey)]);
  }

  return item;
}

function insertNotification(notification) {
  const item = {
    ...notification,
    data: notification.data || {},
    targetUsers: notification.targetUsers || [],
    timestamp: notification.timestamp || new Date().toISOString(),
    read: notification.read ? true : false,
    deleted: notification.deleted ? true : false,
  };
  insertNotificationAsync(notification).catch((err) => {
    console.error('[PG] Insert notification failed:', err.message);
  });

  // 乐观更新缓存。
  if (item.recipientUsername) {
    const key = _getNotifCacheKey(item.recipientUsername);
    if (notifCache.has(key)) {
      notifCache.set(key, [item, ...notifCache.get(key)]);
    }
  }
  const allKey = _getNotifCacheKey(null);
  if (notifCache.has(allKey)) {
    notifCache.set(allKey, [item, ...notifCache.get(allKey)]);
  }

  return item;
}

// 关闭连接池。

async function close() {
  await pool.end();
  console.log('[PG] 连接池已关闭');
}

// 预热连接。

_warmup().catch((err) => {
  console.error('[PG] Warmup failed:', err.message);
});

// 导出接口。

module.exports = {
  // 核心 CRUD。
  getAll,
  getById,
  find,
  list,
  findOne,
  insert,
  updateById,
  updateWithVersionCheck,
  claimItem,
  releaseItem,
  releaseAllByUser,
  cleanExpiredLocks,
  replaceById,
  deleteById,
  count,
  seed,
  transaction,
  isSeeded,

  // 原生异步接口，供后续迁移使用。
  getAllAsync,
  getByIdAsync,
  findAsync,
  listAsync,
  insertAsync,
  updateByIdAsync,
  deleteByIdAsync,
  countAsync,
  seedAsync,
  transactionAsync,
  isSeededAsync,
  insertNotificationAsync,

  // 通知接口。
  insertNotification,
  getNotificationsForUser,
  getNotificationsForUserByType,
  getNotificationsForUserByTypes,
  getNotificationCountForUser,
  getNotificationCountForUserByType,
  getNotificationCountForUserByTypes,
  getUnreadNotificationCountForUser,
  getUnreadNotificationCountForUserByType,
  getUnreadNotificationCountForUserByTypes,
  markNotificationReadForUser,
  markAllNotificationsReadForUser,
  markAllNotificationsReadForUserByType,
  markAllNotificationsReadForUserByTypes,
  deleteNotificationForUser,
  clearNotificationsForUser,
  clearNotificationsForUserByType,
  clearNotificationsForUserByTypes,
  clearNotificationsForUserExceptType,
  clearNotificationsForUserExceptTypes,
  getOwnerPublishedNotificationRows,
  getPublishedNotificationRowsByPublishId,
  updatePublishedNotificationData,

  // 元信息和连接管理。
  isPostgres: true,
  close,
  _db: pool,
  _warmup,
};

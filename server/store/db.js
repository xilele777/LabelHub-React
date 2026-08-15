/**
 * 数据库适配层入口。
 * 根据 DB_TYPE 选择 SQLite 或 PostgreSQL，并向业务代码导出统一接口。
 */

const DB_TYPE = process.env.DB_TYPE || 'sqlite';

let backend;
try {
  if (DB_TYPE === 'postgres') {
    backend = require('./db_pg');
    console.log('[DB] 使用 PostgreSQL 后端');
  } else {
    backend = require('./db_sqlite');
  }
} catch (err) {
  // PostgreSQL 初始化失败时回退到 SQLite，保证本地环境仍可启动。
  if (DB_TYPE === 'postgres') {
    console.error(`[DB] PostgreSQL 后端加载失败: ${err.message}`);
    console.error('[DB] 回退到 SQLite');
  }
  backend = require('./db_sqlite');
}

// 业务代码不需要感知具体数据库实现。
module.exports = backend;

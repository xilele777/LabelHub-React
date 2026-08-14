/**
 * PM2 进程配置
 *
 * 用法:
 *   pm2 start ecosystem.config.js              # 启动
 *   pm2 logs labelhub                          # 查看日志
 *   pm2 monit                                  # 实时监控面板
 *
 * 发布时用 delete + start 而非 reload：pm2 会把 script 路径解析为真实路径并缓存，
 * current 符号链接切换后 reload 仍会运行旧 release 的代码。
 *
 * 密钥不在本文件内。HMAC_SECRET / CORS_ORIGIN 由 cwd 下的 .env 提供，经 node_args
 * 的 --env-file 加载（Node 20.6+ 原生能力，无需 dotenv）；生产环境该 .env 是指向
 * /srv/labelhub/shared/.env 的符号链接。这样密钥既不进仓库，也不会被 pm2 save
 * 明文写进 ~/.pm2/dump.pm2。
 */

module.exports = {
  apps: [
    {
      name: 'labelhub',
      script: './server/index.js',
      cwd: __dirname,

      // ── 单进程 fork ─────────────────────────────
      // 不用 cluster：Socket.IO 多进程需 Redis adapter，SQLite 多进程写存在竞争，
      // 在 1.6G 内存单机上投入产出不成立（见部署设计 §3）
      exec_mode: 'fork',

      // ── 环境变量（仅非密钥项）───────────────────
      env: {
        NODE_ENV: 'production',
        DB_TYPE: 'sqlite',
        PORT: 3001,
        HOST: '127.0.0.1', // 只监听回环，公网流量一律经 Nginx
        TRUST_PROXY: 'true', // 必须与 Nginx 的 X-Forwarded-For 同时生效，否则限流会误封全站
      },

      // ── 开发环境覆盖（pm2 start --env development）──
      env_development: {
        NODE_ENV: 'development',
        DB_TYPE: 'sqlite',
        PORT: 3001,
        HOST: '0.0.0.0',
        TRUST_PROXY: 'false',
      },

      // ── 优雅关闭 ────────────────────────────────
      wait_ready: true, // server/index.js 在 listen 回调中 process.send('ready')
      listen_timeout: 10_000, // 最多等 10 秒变成 ready
      kill_timeout: 5_000, // SIGKILL 前给 5 秒清理

      // ── 日志 ────────────────────────────────────
      // 不指定 out_file/error_file，沿用 pm2 默认的 ~/.pm2/logs/：
      // 相对路径会随 release 目录漂移，历史日志会散落在已清理的旧 release 里
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // ── 重启策略 ────────────────────────────────
      max_restarts: 10,
      max_memory_restart: '512M',
      restart_delay: 3_000,
      autorestart: true,

      // ── Node 启动参数 ───────────────────────────
      // --env-file 相对 cwd 解析，即 <release>/.env -> shared/.env
      node_args: '--env-file=.env --max-old-space-size=512',
    },
  ],
};

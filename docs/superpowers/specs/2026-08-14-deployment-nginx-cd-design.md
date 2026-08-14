# LabelHub 部署升级设计：Nginx 网关 + GitHub Actions CD

- 日期：2026-08-14
- 状态：待实施
- 关联：[DEPLOY.md](../../../DEPLOY.md)（运维手册，gitignore）、[.github/workflows/ci.yml](../../../.github/workflows/ci.yml)

## 1. 背景

LabelHub 当前生产部署为阿里云 ECS 单机（Ubuntu，1.6G 内存 + 4G swap）：Node 22 直装，pm2 守护 `server/index.js`，Express 同时承担 API 服务与前端静态托管，3001 端口直接暴露公网。发布流程是人工 SSH 登录后 `git pull` → `npm ci && npm run build` → `pm2 restart`。

仓库已有完整 CI（lint / typecheck / E2E / 构建体积门禁四道关，见 `.github/workflows/ci.yml`），但没有 CD——交付链路的最后一公里是手工的。

本项目定位为求职简历核心项目，演示场景是面试时当面展示，不需要面试官带走链接（简历门面由用户的博客承担）。

## 2. 目标

1. 访问地址从 `http://<IP>:3001` 变为 `http://<IP>`（80 端口）。
2. 前端静态资源由 Nginx 托管，具备正确的缓存策略与压缩。
3. `git push main` 后自动完成「质量门禁 → 部署 → 健康检查 →（失败）回滚」全流程。
4. 服务器不再承担前端构建负担。
5. 消除 `ecosystem.config.js` 与线上实际配置的漂移。

## 3. 非目标（明确不做，及理由）

| 不做                          | 理由                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| HTTPS / 域名 / 备案           | 演示为当面进行，不需要可分享的安全链接；域名门面已由博客承担                                     |
| Brotli 压缩                   | 需额外 Nginx 模块；入口产物已是 149kB gzip，边际收益不抵折腾成本                                 |
| pm2 cluster 多进程 / 真零停机 | 需要 Socket.IO 上 Redis adapter + SQLite 多进程写验证 + 在 1.6G 内存上再塞 Redis，投入产出不成立 |
| 容器化                        | 阿里云 ECS 镜像源拉不到 `docker.io/library/node`，已验证不可行                                   |
| 迁移到 PaaS                   | 会丢失自建服务器运维经历这一叙事，且免费层无持久磁盘、有冷启动                                   |

## 4. 架构总览

```
公网 :80 ──→ Nginx（www-data 运行）
              ├─ /api/*       → proxy_pass → 127.0.0.1:3001
              ├─ /socket.io/  → proxy_pass → 127.0.0.1:3001（含 Upgrade 头）
              ├─ /assets/*    → 直接读 current/dist/assets/，immutable 强缓存
              ├─ = /index.html→ 直接读，no-cache
              └─ /            → try_files $uri $uri/ /index.html（SPA 回退）

127.0.0.1:3001 ──→ pm2 守护的 Express（仅监听回环，公网不可达）
```

### 4.1 目录布局

```
/srv/labelhub/
├── releases/
│   ├── 20260814-a1b2c3d/          # 一次部署 = 一个目录（dist + server 代码）
│   │   ├── dist/
│   │   ├── server/
│   │   │   └── data -> /srv/labelhub/shared/data
│   │   ├── ecosystem.config.js
│   │   └── .env -> /srv/labelhub/shared/.env
│   └── 20260813-9f8e7d6/          # 保留最近 5 个用于回滚
├── current -> releases/20260814-a1b2c3d
└── shared/
    ├── .env                        # 密钥，不随 release 走，不进仓库不进 CI
    └── data/                       # SQLite 数据文件，跨 release 持久
```

Nginx 的 `root` 指向 `/srv/labelhub/current/dist`。发布时切换 `current` 符号链接是原子操作，不存在文件传输过程中被访问到半成品的窗口。

### 4.2 关键决策：部署根目录从 `/root/LabelHub` 迁移到 `/srv/labelhub`

Nginx 默认以 `www-data` 用户运行，而 `/root` 的权限是 `700`，`www-data` 无法穿越该目录，静态资源会全部 403。可选解法中：放宽 `/root` 权限损害安全边界；让 Nginx 以 root 运行更差。因此选择迁移到 `/srv/labelhub`——同时也更符合 FHS 规范。

迁移涉及 SQLite 数据文件搬迁，是本次实施中风险最高的一步，必须在切换前完成备份（见 §9）。

## 5. Nginx 网关设计

### 5.1 静态资源交接

Nginx 直接读 `current/dist`，不再经 Express。

[server/index.js:182-191](../../../server/index.js#L182-L191) 的 `express.static` + SPA fallback **保留不删**，理由有二：本地开发与 CI 的 E2E 仍依赖它；它是 Nginx 故障时的兜底。生产流量正常情况下不会走到那段代码。

### 5.2 缓存策略

| 路径          | 头                                                   | 理由                                                             |
| ------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `/assets/*`   | `Cache-Control: public, max-age=31536000, immutable` | Vite 默认输出 `[name]-[hash].js`，内容变则文件名变，可安全长缓存 |
| `/index.html` | `Cache-Control: no-cache`                            | HTML 被缓存会导致用户持旧 HTML 请求已删除的 hash 文件，直接白屏  |

`try_files` 回退到 `/index.html` 时 Nginx 会做内部重定向并重新匹配 location，因此 `location = /index.html` 上的 `no-cache` 对 SPA 直达路由同样生效。

### 5.3 WebSocket 透传

`/socket.io/` 需要独立 location，配置 `Upgrade` / `Connection` 头、关闭 `proxy_buffering`、延长 `proxy_read_timeout`（默认 60s 会切断空闲长连接）。

配置骨架：

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

### 5.4 真实 IP 透传（必须与后端联动）

Nginx 传 `X-Forwarded-For` / `X-Forwarded-Proto`，同时服务器 `.env` 必须设置 `TRUST_PROXY=true`。

[server/index.js:45](../../../server/index.js#L45) 是 `app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false)`，默认关闭。若只加 Nginx 而不开这个开关，`globalLimiter` 看到的每个请求来源都是 `127.0.0.1`，单个用户触发登录限流会导致全站被锁。**这两项必须同时生效，缺一即为线上故障。**

### 5.5 压缩

仅启用 Nginx 内置 `gzip`（覆盖 js / css / json / svg，`gzip_min_length 1k`）。

[server/index.js:81](../../../server/index.js#L81) 的 `compression()` 中间件保留——静态资源交给 Nginx 后，它继续服务 API 的 JSON 响应。

### 5.6 端口收口

`server.listen(PORT, '127.0.0.1')`（[server/index.js:215](../../../server/index.js#L215) 当前未绑定地址，即监听 `0.0.0.0`），并在阿里云安全组删除 3001 入站规则、放行 80。

**顺序要求：先验证 Nginx 全链路可用，再收口 3001。** 反序操作会在配置错误时失去所有远程访问通道。

## 6. CD 流水线设计

### 6.1 构建位置：GitHub Actions

CI 的 `build` job 已构建并 `upload-artifact`，服务器重复构建是纯浪费。改由 CD 用 `download-artifact` 取现成 `dist/` 上传。

收益：服务器不再需要前端 devDependencies；不再依赖 swap 兜住 vite build 的内存峰值（该问题已在首次部署中出现过）；部署耗时从约 1.5 分钟降至秒级。

### 6.2 触发与门禁

在现有 `ci.yml` 中新增 `deploy` job（不新建 workflow）：

- `needs: [lint, typecheck, test, build]`——四道门禁全绿才放行
- `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`——PR 不触发
- `concurrency: { group: deploy, cancel-in-progress: false }`——防止两次部署并发
- `environment: production`

### 6.3 部署步骤

1. `download-artifact` 取 `dist/`
2. 计算 release 名：`$(date +%Y%m%d)-${GITHUB_SHA::7}`
3. rsync `dist/`、`server/`（排除 `node_modules`、`data`、`.env`）、`ecosystem.config.js` 到 `releases/<name>/`
4. 在 release 内建立软链：`server/data -> shared/data`、`.env -> shared/.env`
5. `cd releases/<name>/server && npm ci --omit=dev`
6. 原子切换：`ln -sfn releases/<name> current.tmp && mv -T current.tmp current`
7. 重建进程：`pm2 delete labelhub || true` → `pm2 start /srv/labelhub/current/ecosystem.config.js` → `pm2 save`
8. 健康检查（§6.5）
9. 清理：保留最近 5 个 release，其余删除

### 6.4 进程重建而非 reload（含代价说明）

pm2 会将 script 路径解析为真实路径并缓存，符号链接切换后 `pm2 reload` 仍会运行旧代码。因此第 7 步采用 `delete` + `start` 显式重建，**代价是 2-3 秒服务不可用**。

对当前规模（单人演示项目）该代价为零成本，换来的是前后端版本严格一致、回滚路径只有一条命令。真零停机所需的 cluster 方案已在 §3 中排除。

`pm2 save` 不可省略——否则服务器重启后 `pm2 resurrect` 会拉起上一次保存的旧配置。

### 6.5 健康检查与自动回滚

部署后执行 `scripts/smoke.sh`（§8），基址为 `http://127.0.0.1`——**经由 Nginx 而非直连 3001**，这样健康检查覆盖的是用户实际走的完整链路，能捕获 Nginx 配置错误。其中 `/api/health` 一项按每 2 秒一次、最多 15 次轮询，给进程重启留出窗口。

全部失败则执行回滚：`current` 切回上一个 release → 重建进程 → 复验 → 无论结果如何都让 job 以非零码退出。

**不做静默失败**：CD 显示绿色必须等价于线上真实可用。

### 6.6 密钥管理

GitHub Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`。

`DEPLOY_SSH_KEY` 使用**新生成的专用部署密钥**，不复用开发者本机的 ed25519 密钥，以便在需要时单独撤销而不影响人工运维通道。

`.env` 仅存在于服务器 `shared/` 目录，不进仓库、不进 CI、不经 artifact。

## 7. 配置漂移收口

[ecosystem.config.js](../../../ecosystem.config.js) 当前声明 `exec_mode: 'cluster'`、`instances: 'max'`、`DB_TYPE: 'postgres'`，与线上实际（fork 单进程 + SQLite）完全不符。该文件当前是错误的：任何人执行 `pm2 start ecosystem.config.js` 都会把生产切向一个不存在的 Postgres。

修改为与线上一致：

- `exec_mode: 'fork'`、移除 `instances`
- `DB_TYPE: 'sqlite'`
- 新增 `TRUST_PROXY: 'true'`
- **移除 `CORS_ORIGIN: 'http://localhost:3000'` 硬编码**——它与 commit 7b13298 修复的 Socket.IO CORS 问题同源，留着即是下一颗雷
- `wait_ready: true` **保留**：[server/index.js:223-224](../../../server/index.js#L223-L224) 确实在 listen 回调中发送了 ready 信号，该配置有效，且能保证 pm2 报告 online 时服务已真正就绪

改造后由 CD 使用该文件启动，实现配置即代码。

## 8. 验证

新增 `scripts/smoke.sh`，接受基址参数（默认 `http://127.0.0.1`），CD 部署后自动执行，任一项失败触发回滚：

| 检查项                                    | 期望                                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/health`                         | 200（按 §6.5 轮询重试）                                                                                                                          |
| 入口 JS                                   | 200 且 `Cache-Control` 含 `immutable`。文件名带 hash 每次构建都变，脚本需先取 `/index.html` 再用正则解析出 `/assets/*.js` 的实际路径，不得硬编码 |
| `GET /index.html`                         | 200 且 `Cache-Control` 含 `no-cache`                                                                                                             |
| `GET /tasks`（SPA 直达路由）              | 200 且 `Content-Type: text/html`                                                                                                                 |
| `GET /socket.io/?EIO=4&transport=polling` | 200                                                                                                                                              |

该脚本同时作为人工体检工具，可对 `http://<公网IP>` 直接运行。

## 9. 风险与缓解

| 风险                                                  | 影响               | 缓解                                                                                    |
| ----------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| 数据目录迁移丢失 SQLite 数据                          | 严重，不可逆       | 迁移前 `cp server/data/*.db /root/backup/` 并校验文件大小；迁移后先验证读写再删除旧目录 |
| Nginx 配置错误导致站点不可用                          | 高                 | `nginx -t` 预检；3001 保持开放直至全链路验证通过                                        |
| 只加 Nginx 未开 `TRUST_PROXY`                         | 高（限流误封全站） | 列为同一次变更的强制项，smoke 脚本外补充一次限流行为人工确认                            |
| GitHub Actions 出口 IP 不固定，安全组限制 22 端口来源 | 中（CD 连不上）    | 实施前确认安全组 22 规则；若有来源限制需放宽或改用自托管 runner                         |
| CD 上线后误 push 触发意外部署                         | 中                 | 门禁四关 + 健康检查回滚兜底；工作区现有 3 个未提交改动需先行处理                        |
| release 目录堆积占满磁盘                              | 低                 | 部署末尾保留最近 5 个，其余清理                                                         |

## 10. 实施前置检查

以下前提需在动手前于服务器上确认（只读操作）：

1. `ls -ld /root` 权限确为 700（验证 §4.2 的迁移必要性）
2. `nginx -v`：Nginx 是否已安装及版本
3. `ss -tlnp | grep :80`：80 端口是否被占用
4. 阿里云安全组 22 端口入站规则来源范围
5. `df -h`：磁盘余量是否够放多个 release

## 11. 验收标准

1. `http://<公网IP>` 可正常访问并登录，功能与当前一致
2. 3001 端口从公网不可达
3. `scripts/smoke.sh` 五项全通过
4. 向 main 推送一次提交，CD 自动完成部署，全程无人工介入
5. 人为制造一次健康检查失败，验证自动回滚生效且 job 变红
6. 服务器上不存在前端 `node_modules`
7. `ecosystem.config.js` 与线上运行配置一致

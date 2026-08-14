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
5. 消除 `ecosystem.config.cjs` 与线上实际配置的漂移。

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
│   │   ├── ecosystem.config.cjs
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

迁移涉及 SQLite 数据文件搬迁，是本次实施中风险最高的一步，必须在切换前完成备份（见 §4.3）。

### 4.3 SQLite 迁移必须是 WAL 感知的

线上实测（2026-08-14）：`labelhub.db` 仅 208KB，而 `labelhub.db-wal` 达 **4.1MB**——数据库运行在 `journal_mode=wal` 且长期未 checkpoint，绝大部分数据还在 WAL 中尚未合并进主库。

因此 **`cp server/data/*.db` 是错误的备份方式**：该通配符只匹配 `.db`，不含 `-wal` / `-shm`，照此备份或迁移会丢失几乎全部数据。

正确做法二选一：

1. **停服务后整目录复制**——`pm2 stop` 后连同 `.db`、`.db-wal`、`.db-shm` 一起复制（三者必须同时、同一时刻）；
2. **在线一致性备份**——用 better-sqlite3 的 `db.backup()` 或 `VACUUM INTO` 生成单文件快照，自动合并 WAL（服务器未安装 `sqlite3` CLI，走 Node 侧 API）。

迁移后验证以行数为准，基线（2026-08-14 实测）：

| 表               | 行数 |
| ---------------- | ---- |
| users            | 3    |
| tasks            | 12   |
| templates        | 9    |
| reviews          | 11   |
| annotation_items | 19   |
| notifications    | 7    |
| web_vitals       | 143  |

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

Nginx 传 `X-Forwarded-For` / `X-Forwarded-Proto`，同时后端必须设置 `TRUST_PROXY=true`（非密钥项，由 `ecosystem.config.cjs` 的 `env` 块提供）。

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
3. rsync `dist/`、`server/`（排除 `node_modules`、`data`、`.env`）、`ecosystem.config.cjs` 到 `releases/<name>/`
4. 在 release 内建立软链：`server/data -> shared/data`、`.env -> shared/.env`
5. `cd releases/<name>/server && npm ci --omit=dev`
6. 原子切换：`ln -sfn releases/<name> current.tmp && mv -T current.tmp current`
7. 重建进程：`pm2 delete labelhub || true` → `pm2 start /srv/labelhub/current/ecosystem.config.cjs` → `pm2 save`
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

### 6.7 服务器侧访问控制（22 端口开放的前提）

GitHub 托管 runner 的出口 IP 落在 Azure 全球 IP 段（数千个 CIDR 且随时变化），阿里云安全组单组规则上限 200 条，**白名单方案不可行**。已排除的替代路径：自托管 runner（LabelHub-React 是公开仓库，GitHub 官方明确警告 fork PR 可在自托管 runner 上执行任意代码）、Tailscale 组网（引入外部依赖与常驻进程，复杂度不匹配）。

因此采用：**安全组 22 放行 `0.0.0.0/0`，配套四项硬化**。四项必须在放开安全组**之前**完成——线上实测当前 `PasswordAuthentication yes`，22 一旦暴露即刻面临密码爆破：

1. `PasswordAuthentication no`——只留公钥认证
2. 新建非 root 的 `deploy` 用户承载 CD 与 pm2 进程，`/srv/labelhub` 属主为 `deploy`
3. `deploy` 通过 sudoers 白名单仅可执行 `systemctl reload nginx`，无其他 sudo 权限
4. 安装 fail2ban（约 25MB 常驻）拦截爆破

`PermitRootLogin` 保留 `prohibit-password`（禁密码、留公钥），以保住人工运维通道——CD 密钥泄露时可用 root 通道处置，反之亦然。

## 7. 配置漂移收口

原 `ecosystem.config.js` 声明 `exec_mode: 'cluster'`、`instances: 'max'`、`DB_TYPE: 'postgres'`，与线上实际（fork 单进程 + SQLite）完全不符。该文件当时是错误的：任何人执行 `pm2 start ecosystem.config.js` 都会把生产切向一个不存在的 Postgres。

**同时重命名为 [`ecosystem.config.cjs`](../../../ecosystem.config.cjs)**：根 `package.json` 声明了 `"type": "module"`，根目录下的 `.js` 会被当作 ESM 解析，其中的 `module.exports` 不生效——实测 `require('./ecosystem.config.js')` 返回空对象 `{}`，pm2 用它启动将拿不到任何配置。该缺陷此前未暴露，仅因线上一直是 `pm2 start server/index.js` 而从未使用过这个文件。项目内 `scripts/check-bundle-size.cjs` 已是同一约定。

修改为与线上一致：

- `exec_mode: 'fork'`、移除 `instances`
- `DB_TYPE: 'sqlite'`
- 新增 `TRUST_PROXY: 'true'`
- **移除 `CORS_ORIGIN: 'http://localhost:3000'` 硬编码**——它与 commit 7b13298 修复的 Socket.IO CORS 问题同源，留着即是下一颗雷
- `node_args` 增加 `--env-file=.env`（见 §7.1）
- `env` 块只放非密钥项；`HMAC_SECRET` / `CORS_ORIGIN` 一律由 `.env` 提供，不写进本文件
- `wait_ready: true` **保留**：[server/index.js:223-224](../../../server/index.js#L223-L224) 确实在 listen 回调中发送了 ready 信号，该配置有效，且能保证 pm2 报告 online 时服务已真正就绪

### 7.1 `.env` 从未被加载——必须先修的地基

线上实测（2026-08-14）发现：`/root/LabelHub/.env` 存在且含两个正确的键，但**它从创建至今一次都没有被读取过**。证据三条：

1. 进程 `/proc/<pid>/environ` 完整解析后，业务变量（`NODE_ENV`/`HMAC_SECRET`/`CORS_ORIGIN`/`PORT`/`TRUST_PROXY`/`DB_TYPE`）**一个都不存在**，仅有 pm2 元数据与启动它的那个 SSH 会话继承的变量；
2. 前后端 `node_modules` 中**均未安装 `dotenv`**；
3. 服务端代码中无任何 `dotenv` 引用。

当前生产的真实运行状态因此是：

| 代码位置                                                    | 设计意图           | 线上实际                                                  |
| ----------------------------------------------------------- | ------------------ | --------------------------------------------------------- |
| [auth.js:19-28](../../../server/middleware/auth.js#L19-L28) | 用 `.env` 随机密钥 | `NODE_ENV` 未设 → 落到兜底分支，**使用硬编码的 dev 密钥** |
| [index.js:47-76](../../../server/index.js#L47-L76)          | 白名单线上来源     | 落到 dev 分支，白名单为 `localhost:3000`                  |
| `securityHeaders` / `logger`                                | 生产模式           | 均为 dev 分支（宽松安全头 + debug 级 pretty 日志）        |

第一行是**可利用的鉴权漏洞**：仓库公开，token 格式 `base64(userId:timestamp:hmac)` 与该 dev 密钥均可从代码中直接读到，任何人可为任意 `userId` 伪造合法 token。数据为演示数据，影响可控，但性质上是真实绕过。

CORS 目前未表现为故障，是因为前后端同源（同一个 `:3001`），浏览器不发起跨域校验；该错误配置一直被同源掩盖着。

**修复方式：Node 原生 `--env-file`，不引入 `dotenv`。** 服务器 Node v22.23.1 已实测支持（同时支持 `--env-file-if-exists`）。在 `ecosystem.config.cjs` 的 `node_args` 中加 `--env-file=.env`，配合 `cwd` 指向 release 根目录，即读到 `.env -> shared/.env`。

选它而非 `dotenv` 的理由：零新依赖；无需改动 `server/index.js` 的 require 顺序；密钥不进 `env` 块，因而不会被 `pm2 save` 明文写入 `~/.pm2/dump.pm2`；`pm2 restart` 天然重新读文件。

连带纠正一条长期错误记载：DEPLOY.md 所记「`pm2 restart` 不重载 `.env`，必须加 `--update-env`」并非事实——真实原因是从来没有任何代码读取该文件，加不加 `--update-env` 结果相同。

**副作用（预期行为，非缺陷）：** 启用真实 `HMAC_SECRET` 后，此前用 dev 密钥签发的 token 全部失效，所有已登录会话需重新登录。

### 7.2 服务器 `.env` 的 CORS_ORIGIN 必须同步改

线上 `.env` 实测为：

```
HMAC_SECRET=<略>
CORS_ORIGIN=http://<公网IP>:3001
```

访问入口从 `:3001` 移到 80 端口后，该值必须改为 `http://<公网IP>`（无端口号）。commit 7b13298 让 Socket.IO 复用 Express 的 CORS 配置，因此这个值一旦与实际访问来源不符，**WebSocket 握手会被拒绝，实时协作功能直接失效**——且 HTTP 接口仍正常，故障表现具有迷惑性。

该文件位于 `shared/.env`，不进仓库、不进 CI，只能在服务器上改，属于本次实施的手工步骤。

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

| 风险                                                  | 影响               | 缓解                                                                                                                                                                          |
| ----------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据目录迁移丢失 SQLite 数据                          | 严重，不可逆       | **必须用 WAL 感知的备份方式**（见 §4.3），不可用 `cp *.db`；迁移后逐表核对行数再删旧目录                                                                                      |
| Nginx 配置错误导致站点不可用                          | 高                 | `nginx -t` 预检；3001 保持开放直至全链路验证通过                                                                                                                              |
| 只加 Nginx 未开 `TRUST_PROXY`                         | 高（限流误封全站） | 列为同一次变更的强制项，smoke 脚本外补充一次限流行为人工确认                                                                                                                  |
| GitHub Actions 出口 IP 不固定，安全组限制 22 端口来源 | 中（CD 连不上）    | 已定方案：22 放行 0.0.0.0/0 + §6.7 四项硬化                                                                                                                                   |
| 22 暴露公网后遭密码爆破                               | 高                 | 硬化四项必须**先于**安全组放开执行；`PasswordAuthentication no` + fail2ban                                                                                                    |
| SQLite 无备份机制                                     | 中（数据不可恢复） | DEPLOY.md 记载的 crontab 实测从未配置；本次一并补上 WAL 感知的每日备份                                                                                                        |
| CD 上线后误 push 触发意外部署                         | 中                 | 门禁四关 + 健康检查回滚兜底；工作区现有 3 个未提交改动需先行处理                                                                                                              |
| release 目录堆积占满磁盘                              | 低                 | 部署末尾保留最近 5 个，其余清理                                                                                                                                               |
| `NODE_ENV=production` 生效后进程启动即崩溃            | 高（部署直接失败） | [auth.js:24](../../../server/middleware/auth.js#L24) 与 [index.js:68](../../../server/index.js#L68) 两处 throw 要求密钥必须真正注入；先用 `--env-file` 修好 §7.1 再切生产模式 |
| 启用真实 `HMAC_SECRET` 后现存会话全部失效             | 低                 | 预期行为（见 §7.1），非缺陷；验收时以「重新登录成功」为准，不视作回归                                                                                                         |

## 10. 实施前置检查（已于 2026-08-14 完成）

服务器实测结果，全部符合本设计的前提假设：

| 检查项        | 实测结果                                                                                                             | 对设计的影响                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/root` 权限  | `drwx------`（700）                                                                                                  | 确认 §4.2 迁移到 `/srv/labelhub` 是必需的                        |
| Nginx         | 未安装                                                                                                               | 需 `apt install nginx`（apt 源实测可用）                         |
| 80 / 443 端口 | 空闲                                                                                                                 | 无冲突                                                           |
| 3001 监听     | `*:3001`（即 `0.0.0.0`）                                                                                             | 确认 §5.6 需改为绑定 `127.0.0.1`                                 |
| 磁盘          | 40G 总量，已用 8.2G，余 30G                                                                                          | 充足，可放多个 release                                           |
| 内存          | 1.6G，已用 501M，可用 1.1G（swap 4G）                                                                                | 可容纳 Nginx + fail2ban                                          |
| 运行时        | Node v22.23.1 / npm 10.9.8 / pm2 7.0.3（`/usr/bin/pm2`）                                                             | pm2 全局可用，`deploy` 用户可直接调用                            |
| pm2 现状      | `labelhub` fork 单进程，root 运行，`pm2-root.service` 已 enabled                                                     | 换 `deploy` 用户后需重做 `pm2 startup`                           |
| SQLite        | `journal_mode=wal`，主库 208KB，**WAL 4.1MB**                                                                        | 见 §4.3，备份方式必须改                                          |
| `.env`        | 含 `HMAC_SECRET`、`CORS_ORIGIN=http://<公网IP>:3001`，但**从未被加载**（未装 dotenv，进程 environ 中无任何业务变量） | 见 §7.1，须用 `--env-file` 使其生效；见 §7.2，CORS_ORIGIN 必须改 |
| 实际运行模式  | `NODE_ENV` 未设 → 生产实为 dev 分支，**HMAC 用硬编码 dev 密钥**                                                      | 见 §7.1，属可利用的鉴权漏洞，本次一并修复                        |
| `/srv`        | 已存在，内有阿里云安骑士诱饵目录 `.maegis` / `.zaegis` / `.~aegis`                                                   | 与 `/srv/labelhub` 互不干扰，无需处理                            |
| sshd          | `PasswordAuthentication yes`、`PermitRootLogin yes`                                                                  | 见 §6.7，放开 22 前必须先硬化                                    |
| 普通用户      | 无（UID ≥ 1000 为空）                                                                                                | 需新建 `deploy` 用户                                             |
| fail2ban      | 未安装                                                                                                               | 需安装                                                           |
| 安全组入方向  | 3001 对 `0.0.0.0/0` 开放；22 仅放行单个 IP；**80 无规则**                                                            | 需新增 80 规则、改 22 规则、删 3001 规则                         |
| 备份          | 无 `/root/backup`，`crontab -l` 为空                                                                                 | DEPLOY.md 记载的每日备份从未生效，见 §9                          |
| 工作区        | 干净，HEAD = `7b13298`                                                                                               | 无未提交改动干扰                                                 |

附带发现（不影响本次实施）：`aegis.service` 自 2026-08-12 起处于 failed 状态，但 `aegis_client` 子进程仍在运行。

## 11. 验收标准

1. `http://<公网IP>` 可正常访问并登录，功能与当前一致
2. 3001 端口从公网不可达
3. `scripts/smoke.sh` 五项全通过
4. 向 main 推送一次提交，CD 自动完成部署，全程无人工介入
5. 人为制造一次健康检查失败，验证自动回滚生效且 job 变红
6. 服务器上不存在前端 `node_modules`
7. `ecosystem.config.cjs` 与线上运行配置一致
8. `sshd -T | grep passwordauthentication` 输出 `no`，fail2ban 处于 active
9. pm2 进程以 `deploy` 用户运行，`pm2-deploy.service` 已 enabled；`deploy` 无 root 权限（仅 `systemctl reload nginx` 一项 sudo）
10. 数据迁移后七张表行数与 §4.3 基线完全一致
11. WAL 感知的每日备份 crontab 生效，且产出的快照可被独立打开并读出正确行数
12. WebSocket 实时功能可用（验证 §7.2 的 CORS_ORIGIN 已正确更新）
13. 进程 environ 中确实含 `NODE_ENV=production`、`HMAC_SECRET`、`CORS_ORIGIN`、`TRUST_PROXY=true`（验证 §7.1 的 `--env-file` 生效）
14. 用硬编码 dev 密钥伪造的 token 被拒绝（401），确认鉴权漏洞已闭合

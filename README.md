# LabelHub

面向数据标注团队的全栈协作平台，覆盖模板搭建、任务分发、标注与审核工作台、规则预审、实时通知、统计看板和数据导出。

[![React 19](https://img.shields.io/badge/React-19.x-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite)](https://sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

## 项目概览

LabelHub 是一个面向标注团队的协作式 B 端平台，支持从模板定义、任务创建、数据分配、标注提交、规则预审，到人工审核、归档导出的一整套闭环流程。

## 主要能力

- 模板管理：可视化搭建标注模板，支持输入、单选、多选、下拉、评分、开关、说明块等字段类型
- 任务管理：创建任务、配置分配策略、设置截止时间与逾期策略、归档历史任务
- 标注工作台：草稿自动保存、版本校验、悲观锁/乐观锁协同、断网恢复
- 审核工作台：领取审核、通过、驳回、重新提交流转、操作历史追踪
- 规则预审：基于模板字段规则引擎的自动预审，输出 PASS / RISK / FAIL
- 实时通知：通过 Socket.IO 推送任务分配、提交、审核和预审结果
- 数据看板：统计看板、性能监控、健康检查、Prometheus 指标、数据导出
- 权限控制：按负责人/管理员、标注员、审核员进行路由和接口权限隔离

## 技术栈

- 前端：React 19、TypeScript、Vite、Zustand、React Router 7、Ant Design 5、ECharts、dnd-kit
- 后端：Node.js、Express、Socket.IO
- 数据库：SQLite，支持切换 PostgreSQL
- 缓存与扩展：Redis 可选接入
- 测试：Vitest、Testing Library、后端 E2E 测试

> 前端于 2026-07 从 Vue 3 迁移至 React 19，迁移过程与验收记录见 [REACT-MIGRATION.md](./REACT-MIGRATION.md)。

## 快速开始

### 1. 安装依赖

```bash
npm install
cd server
npm install
cd ..
```

### 2. 启动后端

```bash
cd server
npm start
```

后端默认运行在 `http://localhost:3001`。首次启动时，如果数据库为空，会自动执行种子数据初始化。

### 3. 启动前端

```bash
npm run dev
```

前端默认运行在 `http://localhost:3000`，并会自动代理 `/api` 和 `/socket.io` 到后端。

### 4. 生产构建

```bash
npm run build
cd server
npm start
```

## 常用脚本

### 根目录

- `npm run dev`：启动前端开发服务器
- `npm run build`：前端构建
- `npm run build:check`：构建并检查 bundle 体积
- `npm test`：前端单元测试
- `npm run test:coverage`：前端覆盖率
- `npm run test:e2e`：后端 E2E 测试

### `server/`

- `npm start`：启动后端服务
- `npm run dev`：热重载开发模式
- `npm run seed`：手动初始化种子数据
- `npm run test:e2e`：后端端到端测试
- `npm run test`：后端单元测试

## 默认账号

首次 seed 后可使用以下测试账号登录：

| 角色   | 用户名 | 密码  |
| ------ | ------ | ----- |
| 负责人 | `o`    | `123` |
| 标注员 | `a`    | `123` |
| 审核员 | `r`    | `123` |

## 常用环境变量

### 前端

- `VITE_API_BASE_URL`：API 基础地址，默认 `/api`
- `VITE_API_PROXY_TARGET`：开发环境代理目标，默认 `http://localhost:3001`
- `VITE_DEV_HOST` / `VITE_DEV_PORT`：开发服务器地址与端口

### 后端

- `PORT`：后端端口，默认 `3001`
- `CORS_ORIGIN` 或 `CORS_ORIGINS`：生产环境允许的前端来源
- `DB_TYPE`：数据库类型，默认 `sqlite`
- `DATABASE_URL`：PostgreSQL 连接串
- `REDIS_URL`：Redis 地址
- `HMAC_SECRET` 或 `LABELHUB_TOKEN_SECRET`：登录令牌密钥

## 目录说明

- `src/`：前端应用
- `server/`：后端服务
- `scripts/`：辅助脚本
- `.github/workflows/`：CI 配置

## License

MIT

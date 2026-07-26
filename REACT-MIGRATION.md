# LabelHub Vue → React 迁移任务清单

> 创建于 2026-07-26。每个任务设计为可独立交给 agent 执行的粒度，带验收标准。
> 建议执行方式：新建 `react-migration` 分支，在 `frontend-react/` 目录并行搭建，
> 迁移完成后替换 `src/` 并切换构建脚本。main 分支全程保持可部署。

## 技术选型映射（执行任务时统一遵守）

| Vue 侧                                          | React 侧                           | 说明                                                                            |
| ----------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| Vue 3 `<script setup>`                          | React 19 + 函数组件 + hooks        |                                                                                 |
| Pinia（5 个 store）                             | Zustand                            | API 最接近，迁移成本最低                                                        |
| Vue Router 4（roles 路由元信息）                | React Router 7                     | 权限守卫改为包装组件 `<RequireRole>`                                            |
| ant-design-vue 4                                | antd 5                             | 组件名基本一致；`v-model:value` → `value`+`onChange`，插槽 → props/render props |
| @ant-design/icons-vue                           | @ant-design/icons                  |                                                                                 |
| vue-draggable-plus                              | dnd-kit                            | TemplateBuilder 拖拽                                                            |
| echarts 直接挂载                                | echarts 直接挂载（自封装 hook）    | 不引 echarts-for-react，保持现有按需引入优化                                    |
| composables/                                    | hooks/                             | 逻辑保持，`ref/watch/computed` → `useState/useEffect/useMemo`                   |
| unplugin-vue-components                         | 删除                               | antd 5 原生 tree-shaking                                                        |
| @vue/test-utils + happy-dom                     | @testing-library/react + happy-dom |                                                                                 |
| axios / socket.io-client / web-vitals / workers | 原样保留                           | 框架无关                                                                        |

## 阶段 0：准备（半天）

- [x] **0.1 建分支与目录** — 新建 `react-migration` 分支；创建 `frontend-react/` 目录。验收：分支存在，main 不受影响。
- [x] **0.2 确认选型** — 上表映射定稿（2026-07-26 开工时默认确认）。

## 阶段 1：骨架与直接搬运层（1 个 agent 会话）

- [x] **1.1 初始化工程** [M] — Vite + React 19 + TS 严格模式；迁移 vite.config 的代理、分包策略、visualizer；ESLint（typescript-eslint + react-hooks）+ Prettier + husky/lint-staged 适配。验收：`npm run dev/build/lint` 通过。
- [x] **1.2 搬运框架无关层** [S] — 原样复制 `types/`、`utils/`、`api/`（8 个模块 + request.ts）、`services/`（aiReviewEngine、notificationWebSocket、webVitals）、`workers/exportWorker.ts`。验收：`tsc` 零错误，不允许出现任何 vue import。（实际有三处必要适配，见进度记录）
- [x] **1.3 搬运对应单测** [S] — `aiReviewEngine`、`exportUtils`、`request` 三个测试原样迁入，vitest 配置就绪。验收：三个测试套件绿。

## 阶段 2：基础设施（2-3 个会话，串行）

- [x] **2.1 Store 迁移** [M] — 5 个 Pinia store → Zustand。**已完成 5/5**（useAuthStore、useNotificationStore 阶段 1 预支；useTaskStore、useTemplateStore、useAnnotationStore 阶段 2 完成）。验收：对应 store 单测改写为 Zustand 版并通过。
- [x] **2.2 Composables → Hooks** [M] — useCrossTabLock、useDebounced、useDraftPersistence、useNetworkStatus、useVirtualList 共 5 个。注意 useCrossTabLock 的生命周期清理语义（onUnmounted → useEffect cleanup）。验收：useDebounced/useDraftPersistence/useVirtualList 单测通过。
- [x] **2.3 路由与权限** [M] — 路由表（含 roles 元信息、懒加载、preloadTemplateSchemas 预加载钩子）→ React Router；实现 `<RequireRole>` 守卫，登录态跳转逻辑与 Vue 版一致（getDefaultPath/hasRouteRole 复用 utils）。验收：未登录访问受限页重定向到 /login。
- [x] **2.4 通用组件** [S] — ErrorBoundary（React class 组件原生实现）、NetworkStatusBar、SkeletonLoader。验收：Storybook 式手工渲染检查或简单快照。
- [x] **2.5 MainLayout + Login 端到端** [L] — MainLayout（1008 行：菜单、面包屑、通知铃铛、WebSocket 集成、用户菜单）+ Login 页。**这是第一个端到端验证点。** 验收：真实登录 → 进入布局 → 按角色显示菜单 → 通知实时推送可见。

## 阶段 3：中小页面批量迁移（页面间独立，可多 agent 并行）

每页统一验收标准：与 Vue 版对照，列表/表单/操作行为一致，无 console 报错，lint 通过。

- [ ] **3.1 Dashboard**（echarts，先做，验证图表封装 hook）
- [ ] **3.2 TaskList**（317 行，表格 + 筛选分页）
- [ ] **3.3 TaskForm**（353 行，创建/编辑复用）
- [ ] **3.4 TaskDetail + 子组件**（371 行 + AnnotationAssignmentPanel 301 行等）
- [ ] **3.5 UserManage**（333 行）
- [ ] **3.6 TemplateManage**
- [ ] **3.7 TaskArchive**（329 行）
- [ ] **3.8 DataExport**（304 行，注意 exportWorker 联动）
- [ ] **3.9 NotificationManage**（325 行）+ **NotificationPublish**
- [ ] **3.10 StatisticsBoard**（echarts）
- [ ] **3.11 MonitoringBoard**（468 行，echarts + 轮询/实时）
- [ ] **3.12 Exception 页**（Forbidden / NotFound）

## 阶段 4：三大工作台攻坚（每个一个专注会话 + 人工验证，串行）

- [ ] **4.1 TemplateBuilder**（1129 行 + PropertyPanel 278 行等子组件）[L]
  - 难点：vue-draggable-plus → dnd-kit 重写拖拽；表单 schema 双向绑定改受控。
  - 人工验收：拖拽排序/添加/删除控件、属性面板编辑、保存后 schema 与 Vue 版产出一致（可 diff JSON）。
- [ ] **4.2 AnnotationWorkbench**（1203 行）[XL]
  - 难点：视频标注、跨 tab 锁（useCrossTabLock）、草稿持久化（useDraftPersistence）、键盘快捷键。
  - 人工验收：双开 tab 验证锁互斥；断网/刷新草稿恢复；视频帧操作；提交流程完整。
- [ ] **4.3 ReviewWorkbench**（1129 行）[L]
  - 难点：审核流状态机、aiReviewEngine 集成、批量操作。
  - 人工验收：通过/驳回/批量审核全流程，AI 预审结果展示一致。

## 阶段 5：测试与工程化收尾（1-2 个会话）

- [ ] **5.1 补齐测试** — 9 个测试文件全绿；关键页面补 Testing Library 冒烟测试（渲染不炸 + 主要交互）。
- [ ] **5.2 打包体积对齐** — 适配 `scripts/check-bundle-size.cjs` 预算；对照简历优化清单里的指标（入口预加载 313kB 基线），React 版不劣化超过 20%，否则做分包优化。
- [ ] **5.3 web-vitals 上报** — webVitals service 接入 React 入口，验证上报正常。
- [ ] **5.4 server E2E** — `cd server && npm run test:e2e` 全绿（理论上不受影响，跑一遍确认）。

## 阶段 6：切换上线

- [ ] **6.1 全页面人工回归** — 三种角色（ADMIN/ANNOTATOR/REVIEWER）各走一遍主流程，对照 Vue 版。
- [ ] **6.2 目录切换** — `frontend-react/` 内容替换 `src/`（或调整 server 静态托管指向新 dist），删除 vue 依赖，更新 package.json/CI/husky 配置。验收：干净 clone 后 `npm ci && npm run build` 成功。**防护：删除根 Vue 依赖后必须在 frontend-react 重跑全套验收**——嵌套工程会沿目录向上静默解析父级 node_modules（阶段 1 已实际踩坑：tsc 借父级 vue 通过了类型检查）。
- [ ] **6.3 部署验证** — 按 DEPLOY.md 流程发布到 ECS（pm2 + Node22 + 3001），线上冒烟：登录、标注、审核、导出、WebSocket 通知。
- [ ] **6.4 收尾** — 合并或保留分支决策；README 技术栈说明更新。

## 进度记录

（每完成一项在此追加一行：日期 + 任务号 + 备注/踩坑）

- 2026-07-26 **阶段 0 + 阶段 1 完成**（验收全绿：build 零错误 / lint 零告警 / 测试 44/44 / 零 vue 生态依赖）。要点：
  - **2.1 预支 2/5**：useAuthStore、useNotificationStore 已迁 Zustand。原因：request.ts / notification.ts / notificationWebSocket.ts 硬依赖这两个 store；且 Vue 版 store 外层本就是 Zustand 形状的适配层（getState/setState/selector），直迁比造临时脚手架更省
  - **三处必要适配**（"原样搬运"之外）：① `AUTH_EXPIRED_EVENT` 抽到 `api/authEvents.ts`——消除 request ⇄ store 循环加载的 TDZ 崩溃风险（Vue 版靠入口先加载 store 侥幸成立，React 版入口顺序相反）；② request.ts 两处 `useAuthStore()` → `useAuthStore.getState()`——Pinia 可在任意处调用，Zustand hook 形态在 拦截器（非组件上下文）会抛 Invalid hook call，eslint react-hooks 规则抓到的真 bug；③ exportWorkerClient.ts 删除 `deepToRaw`——其唯一职责是解 Vue 响应式 Proxy，Zustand 普通对象可直接 structured clone
  - **上游发现（Vue 版待决断）**：`useAuthStore.test.ts` 的"token 不落 localStorage"断言与实现矛盾，Vue 版该测试一直是红的（token 实际持久化到 localStorage，WS 重连凭证刷新依赖它）。React 版测试已对齐实际行为；Vue 版要修测试还是改实现（真 httpOnly cookie）留待决定
  - **工具链**：dev 端口默认 3100（与 Vue 版 3000 并行对照）；根 eslint ignores 加了 `frontend-react/**`；frontend-react 有独立 `.lintstagedrc.mjs`（lint-staged 多配置，就近生效）；manualChunks 对象形式只列已引用包，react-router/zustand/socket.io-client 接入后再补
- 2026-07-26 **阶段 2 完成**（验收全绿：build 零错误 / lint 零告警 / 测试 64/64；冒烟：dev 代理下 /login 页面 200、o//123 与 a//123 登录 API 返回 token）。要点：
  - **Hook 语义转换**：useDebounced 签名改 `(value, delay)` 直接传值（React 无 ref/getter 概念，注意事项见 JSDoc：依赖 Object.is 比较，须传原始类型）；useDraftPersistence 的 options 改传值+回调，内部用 latest-ref 模式避免 effect 空转；useVirtualList 的 containerRef 改 callback ref（覆盖容器条件渲染延迟出现/销毁重建，等价 Vue watch(containerRef)）
  - **两处真修正**：① useDraftPersistence 基线标记独立于 lastSnapshot——`clear()` 后下一次表单变化必须仍能保存（Vue 版靠 watch 初始化语义天然成立，照抄 lastSnapshot===null 判首次会静默丢草稿），新增回归测试覆盖；② useNetworkStatus 卸载时必须 `socket.off` 摘监听——socket 是全局单例，Vue 版组件销毁即断连无此问题，React StrictMode 双挂载会叠监听
  - **守卫结构**：Vue 全局 beforeEach → 组件守卫三件套 RequireAuth（未登录→/login?redirect=）/ RequireRole（→/403）/ RedirectIfAuthed（登录页反跳）；路由 meta.title → handle.title + useMatches；preloadTemplateSchemas 移入 MainLayout 的 auth effect（模块级 flag 保持一次性语义）
  - **阶段 3 占位**：16 条业务路由的 Component 均为 null → PlaceholderPage；迁移某页时在 router/routes.tsx 把 null 换成 `lazy(() => import(...))` 即可（Suspense fallback=SkeletonLoader 已就位）
  - **明确不迁/延后**：keep-alive（TaskList/TemplateManage 状态缓存）无 React 原生等价物，阶段 3 用 store 持久化筛选状态替代；page-fade out-in 过渡简化为进入动画（避免引 react-transition-group）
  - **体积基线**：入口 index chunk 890kB（gzip 284kB，antd 未拆），阶段 5.2 页面懒加载接入后再做分包对齐

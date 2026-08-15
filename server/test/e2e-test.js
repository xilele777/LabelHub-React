/**
 * LabelHub E2E 测试方案
 * =====================
 * 覆盖核心业务流程的端到端 API 测试
 *
 * 测试流程：
 *   1. 健康检查 & 认证模块
 *   2. 模板管理 (CRUD)
 *   3. 任务管理 (CRUD + 关联模板)
 *   4. 数据导入 (批量创建标注项)
 *   5. 标注工作流 (保存草稿 → 提交 → 规则预审 → 人工审核通过/驳回 → 重新提交)
 *   6. 审核结果查询
 *   7. 数据统计 & 边界场景
 *
 * 前置条件: 先执行 node test/reset-db.js 清空数据
 * 运行方式: node test/e2e-test.js
 */

const http = require('http');

// ─── 配置 ────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const TIMEOUT = 5000;

// ─── 测试统计 ─────────────────────────────────────────────
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

// ─── 工具函数 ─────────────────────────────────────────────

/**
 * 发送 HTTP 请求
 */
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
    };
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 断言辅助
 */
function assert(condition, testName, detail) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ ${testName}`);
  } else {
    failedTests++;
    const msg = detail ? `${testName} — ${detail}` : testName;
    failures.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

function assertEq(actual, expected, testName) {
  assert(actual === expected, testName, `期望 ${expected}, 实际 ${actual}`);
}

function assertIncludes(str, substr, testName) {
  assert(typeof str === 'string' && str.includes(substr), testName, `"${str}" 不包含 "${substr}"`);
}

function assertGte(actual, threshold, testName) {
  assert(actual >= threshold, testName, `期望 >= ${threshold}, 实际 ${actual}`);
}

function assertTruthy(val, testName) {
  assert(!!val, testName, `期望 truthy, 实际 ${val}`);
}

// ─── 存储跨步骤共享数据 ───────────────────────────────────
const ctx = {
  ownerToken: null,
  annotatorToken: null,
  reviewerToken: null,
  templateId: null,
  taskId: null,
  dataItemIds: [],
  reviewId: null,
};

// ─── 测试步骤 ─────────────────────────────────────────────

async function step1_healthCheckAndAuth() {
  console.log('\n━━━ 步骤1: 健康检查 & 认证模块 ━━━');

  // 1.1 健康检查
  const health = await request('GET', '/api/health');
  assertEq(health.body.code, 200, 'GET /api/health 返回 200');
  assertEq(health.body.data.status, 'ok', '健康状态为 ok');

  // 1.2 登录 - owner
  const ownerLogin = await request('POST', '/api/auth/login', {
    username: 'o',
    password: '123',
  });
  assertEq(ownerLogin.body.code, 200, 'owner 登录成功');
  assertTruthy(ownerLogin.body.data.token, '返回 token');
  ctx.ownerToken = ownerLogin.body.data.token;

  // 1.3 登录 - annotator
  const annotatorLogin = await request('POST', '/api/auth/login', {
    username: 'a',
    password: '123',
  });
  assertEq(annotatorLogin.body.code, 200, 'annotator 登录成功');
  ctx.annotatorToken = annotatorLogin.body.data.token;

  // 1.4 登录 - reviewer
  const reviewerLogin = await request('POST', '/api/auth/login', {
    username: 'r',
    password: '123',
  });
  assertEq(reviewerLogin.body.code, 200, 'reviewer 登录成功');
  ctx.reviewerToken = reviewerLogin.body.data.token;

  // 1.5 登录失败 - 错误密码
  const badLogin = await request('POST', '/api/auth/login', {
    username: 'o',
    password: 'wrong',
  });
  assertEq(badLogin.body.code, 401, '错误密码返回 401');

  // 1.6 登录失败 - 缺少字段
  const missingLogin = await request('POST', '/api/auth/login', {
    username: 'o',
  });
  assert(missingLogin.body.code !== 200, '缺少密码字段登录失败');

  // 1.7 获取当前用户信息
  const me = await request('GET', '/api/auth/me', null, ctx.ownerToken);
  assertEq(me.body.data.username, 'o', '/auth/me 返回当前用户');

  // 1.8 无 token 访问 /auth/me
  const meNoToken = await request('GET', '/api/auth/me');
  assertEq(meNoToken.body.code, 401, '无 token 返回 401');

  // 1.9 登出
  const logout = await request('POST', '/api/auth/logout', null, ctx.ownerToken);
  assertEq(logout.body.code, 200, '登出成功');
}

async function step2_templateCRUD() {
  console.log('\n━━━ 步骤2: 模板管理 CRUD ━━━');

  // 2.1 创建模板
  const createRes = await request(
    'POST',
    '/api/templates',
    {
      name: '测试图像分类模板',
      description: '用于E2E测试的图像分类模板',
      type: 'image_classification',
      fieldCount: 4,
      creator: 'o',
      fields: [
        {
          id: 'f1',
          type: 'radio',
          fieldKey: 'category',
          label: '类别',
          required: true,
          options: [
            { id: 'o1', label: '猫', value: 'cat' },
            { id: 'o2', label: '狗', value: 'dog' },
          ],
          direction: 'vertical',
        },
        {
          id: 'f2',
          type: 'select',
          fieldKey: 'quality',
          label: '质量',
          required: true,
          placeholder: '请选择',
          options: [
            { id: 'q1', label: '高清', value: 'hd' },
            { id: 'q2', label: '模糊', value: 'blurry' },
          ],
        },
        {
          id: 'f3',
          type: 'rating',
          fieldKey: 'difficulty',
          label: '难度',
          maxScore: 5,
          allowHalf: true,
        },
        {
          id: 'f4',
          type: 'textarea',
          fieldKey: 'note',
          label: '备注',
          placeholder: '可选',
          maxLength: 200,
        },
      ],
    },
    ctx.ownerToken,
  );
  assertEq(createRes.body.code, 201, '创建模板返回 201');
  assertTruthy(createRes.body.data.id, '模板有 id');
  assertEq(createRes.body.data.fields.length, 4, '模板有 4 个字段');
  ctx.templateId = createRes.body.data.id;

  // 2.2 查询模板列表
  const listRes = await request('GET', '/api/templates', null, ctx.ownerToken);
  assertEq(listRes.body.code, 200, '获取模板列表成功');
  assertGte(listRes.body.data.items.length, 1, '模板列表 >= 1');

  // 2.3 查询单个模板
  const getRes = await request('GET', `/api/templates/${ctx.templateId}`, null, ctx.ownerToken);
  assertEq(getRes.body.data.name, '测试图像分类模板', '模板名称正确');
  assertEq(getRes.body.data.fields.length, 4, '模板字段数正确');

  // 2.4 更新模板
  const updateRes = await request(
    'PUT',
    `/api/templates/${ctx.templateId}`,
    {
      description: '更新后的模板描述',
      fieldCount: 5,
      fields: [
        {
          id: 'f1',
          type: 'radio',
          fieldKey: 'category',
          label: '类别',
          required: true,
          options: [
            { id: 'o1', label: '猫', value: 'cat' },
            { id: 'o2', label: '狗', value: 'dog' },
            { id: 'o3', label: '鸟', value: 'bird' },
          ],
          direction: 'vertical',
        },
        {
          id: 'f2',
          type: 'select',
          fieldKey: 'quality',
          label: '质量',
          required: true,
          placeholder: '请选择',
          options: [
            { id: 'q1', label: '高清', value: 'hd' },
            { id: 'q2', label: '模糊', value: 'blurry' },
          ],
        },
        {
          id: 'f3',
          type: 'rating',
          fieldKey: 'difficulty',
          label: '难度',
          maxScore: 5,
          allowHalf: true,
        },
        {
          id: 'f4',
          type: 'textarea',
          fieldKey: 'note',
          label: '备注',
          placeholder: '可选',
          maxLength: 200,
        },
        { id: 'f5', type: 'switch', fieldKey: 'isClear', label: '是否清晰', defaultValue: false },
      ],
    },
    ctx.ownerToken,
  );
  assertEq(updateRes.body.code, 200, '更新模板成功');
  assertEq(updateRes.body.data.fields.length, 5, '更新后字段数为 5');

  // 2.5 创建第二个模板（用于后续测试）
  const createRes2 = await request(
    'POST',
    '/api/templates',
    {
      name: '测试目标检测模板',
      description: '用于E2E测试的目标检测模板',
      type: 'object_detection',
      fieldCount: 2,
      creator: 'o',
      fields: [
        {
          id: 'f_obj',
          type: 'select',
          fieldKey: 'objectType',
          label: '目标类别',
          required: true,
          options: [
            { id: 'v1', label: '行人', value: 'pedestrian' },
            { id: 'v2', label: '车辆', value: 'vehicle' },
          ],
        },
        { id: 'f_conf', type: 'rating', fieldKey: 'confidence', label: '置信度', maxScore: 5 },
      ],
    },
    ctx.ownerToken,
  );
  assertEq(createRes2.body.code, 201, '创建第二个模板成功');

  // 2.6 查询模板列表确认数量
  const listRes2 = await request('GET', '/api/templates', null, ctx.ownerToken);
  assertEq(listRes2.body.data.items.length, 2, '模板总数为 2');
}

async function step3_taskCRUD() {
  console.log('\n━━━ 步骤3: 任务管理 CRUD + 关联模板 ━━━');

  // 3.1 创建任务（关联模板）
  const createRes = await request(
    'POST',
    '/api/tasks',
    {
      name: 'E2E测试-猫狗分类任务',
      description: '端到端测试用的猫狗分类标注任务',
      type: 'image_classification',
      owner: 'o',
      templateId: ctx.templateId,
      instructions: '请根据图片选择猫或狗，标注图像质量与难度。',
      status: 'draft',
    },
    ctx.ownerToken,
  );
  assertEq(createRes.body.code, 201, '创建任务返回 201');
  assertTruthy(createRes.body.data.id, '任务有 id');
  // 自动填充 templateName
  assertEq(createRes.body.data.templateName, '测试图像分类模板', '自动填充 templateName');
  ctx.taskId = createRes.body.data.id;

  // 3.2 查询任务列表
  const listRes = await request('GET', '/api/tasks', null, ctx.ownerToken);
  assertEq(listRes.body.code, 200, '获取任务列表成功');
  assertGte(listRes.body.data.items.length, 1, '任务列表 >= 1');

  // 3.3 查询单个任务
  const getRes = await request('GET', `/api/tasks/${ctx.taskId}`, null, ctx.ownerToken);
  assertEq(getRes.body.data.name, 'E2E测试-猫狗分类任务', '任务名称正确');
  assertEq(getRes.body.data.templateId, ctx.templateId, '任务关联模板正确');

  // 3.4 更新任务状态为 in_progress
  const updateRes = await request(
    'PUT',
    `/api/tasks/${ctx.taskId}`,
    {
      status: 'in_progress',
    },
    ctx.ownerToken,
  );
  assertEq(updateRes.body.code, 200, '更新任务状态成功');
  assertEq(updateRes.body.data.status, 'in_progress', '任务状态为 in_progress');

  // 3.5 按状态过滤任务
  const filterRes = await request('GET', '/api/tasks?status=in_progress', null, ctx.ownerToken);
  assertEq(filterRes.body.code, 200, '按状态过滤任务成功');
  assertGte(filterRes.body.data.items.length, 1, 'in_progress 任务 >= 1');
  // 确认过滤结果都是 in_progress
  const allInProgress = filterRes.body.data.items.every((i) => i.status === 'in_progress');
  assert(allInProgress, '过滤结果全部为 in_progress');

  // 3.6 排序测试
  const sortRes = await request(
    'GET',
    '/api/tasks?_sort=createdAt&_order=desc',
    null,
    ctx.ownerToken,
  );
  assertEq(sortRes.body.code, 200, '任务排序查询成功');
}

async function step4_dataImport() {
  console.log('\n━━━ 步骤4: 批量数据导入 ━━━');

  // 4.1 批量导入标注项
  const importRes = await request(
    'POST',
    '/api/annotation-items/batch-import',
    {
      taskId: ctx.taskId,
      items: [
        {
          rawData: {
            imageUrl: 'https://example.com/test/cat_001.jpg',
            fileName: 'cat_001.jpg',
            description: '一只橘猫趴在沙发上',
          },
        },
        {
          rawData: {
            imageUrl: 'https://example.com/test/dog_002.jpg',
            fileName: 'dog_002.jpg',
            description: '一只金毛在草地上奔跑',
          },
        },
        {
          rawData: {
            imageUrl: 'https://example.com/test/cat_003.jpg',
            fileName: 'cat_003.jpg',
            description: '一只黑猫在黑暗中',
          },
        },
        {
          rawData: {
            imageUrl: 'https://example.com/test/dog_004.jpg',
            fileName: 'dog_004.jpg',
            description: '柯基犬在公园玩耍',
          },
        },
        {
          rawData: {
            imageUrl: 'https://example.com/test/mixed_005.jpg',
            fileName: 'mixed_005.jpg',
            description: '模糊图片，难以分辨',
          },
        },
      ],
    },
    ctx.ownerToken,
  );
  assertEq(importRes.body.code, 201, '批量导入返回 201');
  assertEq(importRes.body.data.imported, 5, '成功导入 5 条数据');
  ctx.dataItemIds = importRes.body.data.items.map((i) => i.id);

  // 4.2 查询标注项列表
  const listRes = await request(
    'GET',
    `/api/annotation-items?taskId=${ctx.taskId}`,
    null,
    ctx.ownerToken,
  );
  assertEq(listRes.body.code, 200, '查询标注项列表成功');
  assertGte(listRes.body.data.items.length, 5, '标注项 >= 5');

  // 4.3 验证导入数据初始状态
  const itemRes = await request(
    'GET',
    `/api/annotation-items/${ctx.dataItemIds[0]}`,
    null,
    ctx.ownerToken,
  );
  assertEq(itemRes.body.data.status, 'pending', '初始状态为 pending');
  assertEq(itemRes.body.data.annotator, null, '初始标注员为 null');
  assertEq(itemRes.body.data.annotationData, null, '初始标注数据为 null');

  // 4.4 导入失败 - 无 taskId
  const badImport = await request(
    'POST',
    '/api/annotation-items/batch-import',
    {
      items: [{ rawData: { test: 1 } }],
    },
    ctx.ownerToken,
  );
  assert(badImport.body.code !== 200, '缺少 taskId 导入失败');

  // 4.5 导入失败 - 不存在的 taskId
  const badTaskImport = await request(
    'POST',
    '/api/annotation-items/batch-import',
    {
      taskId: 'nonexistent',
      items: [{ rawData: { test: 1 } }],
    },
    ctx.ownerToken,
  );
  assert(badTaskImport.body.code !== 200, '不存在的 taskId 导入失败');
}

async function step5_annotationWorkflow() {
  console.log('\n━━━ 步骤5: 标注工作流 (草稿→提交→规则预审→审核) ━━━');

  const [id1, id2, id3, id4, id5] = ctx.dataItemIds;

  // ── 5A: 完整正向流程 (草稿 → 提交 → 规则预审 → 人工审核通过) ──
  console.log('\n  ▸ 5A: 正向流程 - 审核通过');

  // 保存草稿（初始版本号为 1）
  const draft1 = await request(
    'PUT',
    `/api/annotation-items/${id1}/save-draft`,
    {
      annotationData: { category: 'cat', quality: 'hd', difficulty: 2, note: '清晰橘猫' },
      version: 1,
    },
    ctx.annotatorToken,
  );
  assertEq(draft1.body.code, 200, '保存草稿成功');
  assertEq(draft1.body.data.status, 'draft', '状态变为 draft');
  assertEq(draft1.body.data.annotator, 'a', '标注员为 annotator');
  assertGte(draft1.body.data.auditHistory.length, 1, '审计历史记录 >= 1');
  const itemV1 = draft1.body.data.version; // 保存草稿后版本号自动递增

  // 提交标注（自动触发规则预审，状态直接推进到 pending_review）
  const submit1 = await request(
    'PUT',
    `/api/annotation-items/${id1}/submit`,
    {
      annotationData: { category: 'cat', quality: 'hd', difficulty: 2, note: '清晰橘猫' },
      version: itemV1,
    },
    ctx.annotatorToken,
  );
  assertEq(submit1.body.code, 200, '提交标注成功');
  assertEq(
    submit1.body.data.item.status,
    'pending_review',
    '状态变为 pending_review（规则预审自动完成）',
  );
  assertTruthy(submit1.body.data.item.submittedAt, '有提交时间');
  assertTruthy(submit1.body.data.review, '返回规则预审结果');
  ctx.reviewId = submit1.body.data.review.id;
  const itemV2 = submit1.body.data.item.version; // 提交并完成规则预审后的版本号

  // 人工审核通过
  const approve1 = await request(
    'PUT',
    `/api/annotation-items/${id1}/approve`,
    {
      reason: '标注准确，审核通过',
      version: itemV2,
    },
    ctx.reviewerToken,
  );
  assertEq(approve1.body.code, 200, '审核通过成功');
  assertEq(approve1.body.data.status, 'reviewed', '状态变为 reviewed');
  assertEq(approve1.body.data.archived, true, '审核通过后自动归档');
  assertTruthy(approve1.body.data.archivedAt, '审核通过后记录归档时间');
  assertEq(approve1.body.data.reviewer, 'r', '审核员为 reviewer');
  assertTruthy(approve1.body.data.reviewedAt, '有审核时间');

  // 验证审计历史完整
  const item1Detail = await request('GET', `/api/annotation-items/${id1}`, null, ctx.ownerToken);
  const history = item1Detail.body.data.auditHistory;
  assertGte(history.length, 5, '完整流程审计历史 >= 5 条');
  const actionTypes = history.map((h) => h.actionType);
  assert(actionTypes.includes('save_draft'), '审计历史包含 save_draft');
  assert(actionTypes.includes('submit'), '审计历史包含 submit');
  assert(actionTypes.includes('ai_review_complete'), '审计历史包含 ai_review_complete');
  assert(actionTypes.includes('approve'), '审计历史包含 approve');

  // ── 5B: 驳回流程 (提交 → 规则预审自动完成 → 人工驳回 → 重新提交) ──
  console.log('\n  ▸ 5B: 驳回流程 - 驳回后重新提交');

  // 直接提交（跳过草稿），规则预审自动完成（id2 初始版本号为 1）
  const submit2 = await request(
    'PUT',
    `/api/annotation-items/${id2}/submit`,
    {
      annotationData: { category: 'cat', quality: 'hd', difficulty: 1, note: '' },
      version: 1,
    },
    ctx.annotatorToken,
  );
  assertEq(submit2.body.code, 200, '直接提交标注成功');
  // submit now returns { item, review } format
  assertEq(
    submit2.body.data.item.status,
    'pending_review',
    '提交后状态为 pending_review（规则预审自动完成）',
  );
  assertTruthy(submit2.body.data.review, '返回规则预审结果');
  const id2SubmitVer = submit2.body.data.item.version; // 提交并完成规则预审后的版本号

  // 人工驳回
  const reject2 = await request(
    'PUT',
    `/api/annotation-items/${id2}/reject`,
    {
      reason: '类别标注错误：图像描述为金毛犬，请修正为"狗"',
      version: id2SubmitVer,
    },
    ctx.reviewerToken,
  );
  assertEq(reject2.body.code, 200, '驳回成功');
  assertEq(reject2.body.data.status, 'rejected', '状态变为 rejected');
  assertEq(
    reject2.body.data.rejectReason,
    '类别标注错误：图像描述为金毛犬，请修正为"狗"',
    '驳回原因已记录',
  );
  const id2RejectVer = reject2.body.data.version; // 驳回后版本号

  // 重新提交
  const resubmit2 = await request(
    'PUT',
    `/api/annotation-items/${id2}/resubmit`,
    {
      annotationData: { category: 'dog', quality: 'hd', difficulty: 1, note: '已修正为狗' },
      version: id2RejectVer,
    },
    ctx.annotatorToken,
  );
  assertEq(resubmit2.body.code, 200, '重新提交成功');
  // 重新提交同样返回自动规则预审后的 { item, review }
  assertEq(resubmit2.body.data.item.status, 'pending_review', '重新提交后状态为 pending_review');
  assertEq(resubmit2.body.data.item.rejectReason, null, '重新提交后驳回原因已清除');

  // ── 5C: 提交有问题的标注（触发规则预审） ──
  console.log('\n  ▸ 5C: 规则预审失败场景');

  // 提交缺少必填字段 + 低评分的标注，触发 R001（必填缺失，-30）+ R006（低评分风险，-15）= 55分 FAIL
  // id3 初始版本号为 1
  const submit3 = await request(
    'PUT',
    `/api/annotation-items/${id3}/submit`,
    {
      annotationData: { category: '', quality: 'blurry', difficulty: 1, note: '太暗了看不清' },
      version: 1,
    },
    ctx.annotatorToken,
  );
  assertEq(submit3.body.code, 200, '提交有问题的标注成功');
  // 规则预审自动执行并返回结果。
  assertTruthy(submit3.body.data.review, '返回规则预审结果');
  // 规则引擎应命中 R001（必填字段 category 为空，-30）和 R006（低评分，-15）。
  assertTruthy(
    submit3.body.data.review.score < 80,
    `预审评分较低（实际: ${submit3.body.data.review.score}）`,
  );
  assertEq(submit3.body.data.review.reviewStatus, 'fail', '预审状态为 fail');
  const id3SubmitVer = submit3.body.data.item.version; // 提交并完成规则预审后的版本号

  // ── 5D: 驳回缺少原因 ──
  console.log('\n  ▸ 5D: 驳回缺少原因');

  const rejectNoReason = await request(
    'PUT',
    `/api/annotation-items/${id3}/reject`,
    {
      reason: '',
      version: id3SubmitVer,
    },
    ctx.reviewerToken,
  );
  assert(rejectNoReason.body.code !== 200, '缺少驳回原因时驳回失败');
}

async function step6_reviewQueries() {
  console.log('\n━━━ 步骤6: 审核结果查询 ━━━');

  const [id1, id2, id3] = ctx.dataItemIds;

  // 6.1 按 dataItemId 查询审核结果
  const byItem = await request('GET', `/api/reviews/by-item/${id1}`, null, ctx.reviewerToken);
  assertEq(byItem.body.code, 200, '按 dataItemId 查询审核结果成功');
  assertEq(byItem.body.data.dataItemId, id1, '审核结果关联正确的 dataItemId');

  // 6.2 按 taskId 查询审核结果
  const byTask = await request('GET', `/api/reviews/by-task/${ctx.taskId}`, null, ctx.ownerToken);
  assertEq(byTask.body.code, 200, '按 taskId 查询审核结果成功');
  assertGte(byTask.body.data.items.length, 2, '任务下审核结果 >= 2');

  // 6.3 查询不存在的 dataItemId
  const notFound = await request('GET', '/api/reviews/by-item/nonexistent', null, ctx.ownerToken);
  assert(notFound.body.code !== 200, '查询不存在的 dataItemId 返回非 200');

  // 6.4 查询审核结果详情
  const reviewDetail = await request('GET', `/api/reviews/${ctx.reviewId}`, null, ctx.ownerToken);
  assertEq(reviewDetail.body.code, 200, '查询审核详情成功');
  assertTruthy(
    ['pass', 'risk', 'fail'].includes(reviewDetail.body.data.reviewStatus),
    '审核状态为有效值',
  );
  assertTruthy(typeof reviewDetail.body.data.score === 'number', '审核评分为数字');
}

async function step7_statisticsAndEdgeCases() {
  console.log('\n━━━ 步骤7: 数据统计 & 边界场景 ━━━');

  // 7.1 健康检查中的统计信息
  const health = await request('GET', '/api/health');
  assertGte(health.body.data.collections.users, 3, '用户数 >= 3');
  assertEq(health.body.data.collections.templates, 2, '模板数为 2');
  assertGte(health.body.data.collections.tasks, 1, '任务数 >= 1');
  assertGte(health.body.data.collections.annotationItems, 5, '标注项数 >= 5');
  assertGte(health.body.data.collections.reviews, 2, '审核记录数 >= 2');

  // 7.2 分页查询
  const page1 = await request(
    'GET',
    '/api/annotation-items?_page=1&_limit=2',
    null,
    ctx.ownerToken,
  );
  assertEq(page1.body.code, 200, '分页查询成功');
  assertEq(page1.body.data.items.length, 2, '每页 2 条');
  assertEq(page1.body.data.page, 1, '当前页为 1');
  assertEq(page1.body.data.limit, 2, '每页限制为 2');

  // 7.3 查询不存在的任务
  const notFound = await request('GET', '/api/tasks/nonexistent', null, ctx.ownerToken);
  assert(notFound.body.code !== 200, '查询不存在的任务返回非 200');

  // 7.4 无认证访问受保护接口
  const noAuth = await request('GET', '/api/tasks');
  assertEq(noAuth.body.code, 401, '无认证访问返回 401');

  // 7.5 删除标注项
  const [_, __, ___, ____, id5] = ctx.dataItemIds;
  const deleteRes = await request('DELETE', `/api/annotation-items/${id5}`, null, ctx.ownerToken);
  assertEq(deleteRes.body.code, 200, '删除标注项成功');

  // 确认已删除
  const deletedItem = await request('GET', `/api/annotation-items/${id5}`, null, ctx.ownerToken);
  assert(deletedItem.body.code !== 200, '已删除项查询返回非 200');

  // 7.6 删除模板
  // 先创建一个临时模板再删除
  const tempTpl = await request(
    'POST',
    '/api/templates',
    {
      name: '临时模板-待删除',
      description: '测试删除',
      type: 'text_ner',
      fieldCount: 1,
      creator: 'o',
      fields: [{ id: 'f1', type: 'input', fieldKey: 'text', label: '文本', maxLength: 100 }],
    },
    ctx.ownerToken,
  );
  const tempTplId = tempTpl.body.data.id;

  const deleteTpl = await request('DELETE', `/api/templates/${tempTplId}`, null, ctx.ownerToken);
  assertEq(deleteTpl.body.code, 200, '删除模板成功');

  // 7.7 创建单个标注项（非批量导入）
  const createSingle = await request(
    'POST',
    '/api/annotation-items',
    {
      taskId: ctx.taskId,
      rawData: {
        imageUrl: 'https://example.com/test/single.jpg',
        fileName: 'single.jpg',
        description: '单独创建的标注项',
      },
      status: 'pending',
    },
    ctx.ownerToken,
  );
  assertEq(createSingle.body.code, 201, '单独创建标注项成功');
  assertEq(createSingle.body.data.status, 'pending', '单独创建项状态为 pending');
}

// ─── 主流程 ────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║          LabelHub E2E 测试方案                       ║');
  console.log('║   覆盖: 认证 → 模板 → 任务 → 导入 → 标注 → 审核   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📍 目标: ${BASE_URL}`);
  console.log(`🕐 开始: ${new Date().toLocaleString()}`);

  try {
    await step1_healthCheckAndAuth();
    await step2_templateCRUD();
    await step3_taskCRUD();
    await step4_dataImport();
    await step5_annotationWorkflow();
    await step6_reviewQueries();
    await step7_statisticsAndEdgeCases();
  } catch (err) {
    console.error('\n💥 测试执行出错:', err.message);
    failedTests++;
  }

  // ─── 汇总 ──────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  测试汇总');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  总计: ${totalTests}  通过: ${passedTests}  失败: ${failedTests}`);
  console.log(`  通过率: ${totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0}%`);
  console.log('');

  if (failures.length > 0) {
    console.log('  ❌ 失败项:');
    failures.forEach((f, i) => console.log(`     ${i + 1}. ${f}`));
    console.log('');
  }

  console.log(`🕐 结束: ${new Date().toLocaleString()}`);
  console.log('');

  process.exit(failedTests > 0 ? 1 : 0);
}

main();

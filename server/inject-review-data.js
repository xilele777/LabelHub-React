/**
 * 临时灌库脚本：往数据库塞 300 条待人工审核数据，用于验证审核页虚拟滚动。
 *
 * 运行：cd server && node inject-review-data.js
 * 回滚：node server/seed.js 重建数据库即可清空
 */
const db = require('./store/db');

const TASKS = [
  { taskId: 't001', templateId: 'tpl001', name: '猫狗分类' },
  { taskId: 't006', templateId: 'tpl004', name: '行人车辆检测' },
  { taskId: 't009', templateId: 'tpl002', name: '农作物病害' },
];

const AI_STATUSES = ['pass', 'risk', 'fail'];
const CATEGORIES = ['cat', 'dog', 'other'];
const QUALITIES = ['hd', 'sd', 'blurry'];

function pick(arr, i) {
  return arr[i % arr.length];
}

const REVIEW_PREFIX = 'rev_inject_';
const existing = db
  .getAll('annotation-items')
  .filter((it) => String(it.id).startsWith(REVIEW_PREFIX));
if (existing.length > 0) {
  console.log(`检测到已存在 ${existing.length} 条注入数据，先清理...`);
  // 没有 delete 暴露，直接用事务 + exec 删
  db._db.exec(`DELETE FROM annotation_items WHERE id LIKE '${REVIEW_PREFIX}%'`);
}

const COUNT = 300;
let created = 0;
const now = new Date().toISOString();

const tx = db._db.transaction(() => {
  for (let i = 1; i <= COUNT; i++) {
    const task = pick(TASKS, i);
    const aiStatus = pick(AI_STATUSES, i * 7); // 错开，三种状态都有
    const id = `${REVIEW_PREFIX}${String(i).padStart(4, '0')}`;

    const item = {
      id,
      taskId: task.taskId,
      rawData: {
        imageUrl: `https://example.com/images/inject_${i}.jpg`,
        fileName: `inject_${i}.jpg`,
        fileSize: `${(1 + (i % 5)).toFixed(1)}MB`,
        resolution: '1920x1080',
        description: `第 ${i} 条注入的待审核样本，用于验证虚拟滚动`,
      },
      status: 'pending_review',
      annotationData: {
        category: pick(CATEGORIES, i),
        tags: i % 2 === 0 ? ['indoor'] : ['outdoor'],
        quality: pick(QUALITIES, i),
        difficulty: (i % 5) + 1,
        isClear: i % 3 !== 0,
        note: i % 4 === 0 ? '备注内容' : '',
      },
      annotator: 'a',
      submittedAt: now,
      reviewer: null,
      reviewedAt: null,
      rejectReason: null,
      auditHistory: [
        {
          id: `h_inject_${i}`,
          operator: 'a',
          actionType: 'submit',
          fromStatus: 'draft',
          toStatus: 'submitted',
          reason: null,
          timestamp: now,
        },
      ],
      version: 1,
      lockedBy: null,
      lockedAt: null,
      archived: false,
      archivedAt: null,
    };

    db.insert('annotation-items', item);

    // 同时生成一条规则预审结果，让审核页右侧能看到预审卡片
    const score =
      aiStatus === 'pass' ? 85 + (i % 15) : aiStatus === 'risk' ? 50 + (i % 30) : 20 + (i % 30);
    db.insert('reviews', {
      id: `ar_inject_${i}`,
      dataItemId: id,
      taskId: task.taskId,
      templateId: task.templateId,
      reviewStatus: aiStatus,
      score,
      summary:
        aiStatus === 'pass'
          ? `注入样本 ${i}：标注质量良好，预审通过。`
          : aiStatus === 'risk'
            ? `注入样本 ${i}：存在风险项，建议人工复核。`
            : `注入样本 ${i}：未通过预审，需修正。`,
      matchedRules:
        aiStatus === 'pass'
          ? []
          : [
              {
                ruleId: 'R_DEMO',
                name: '演示规则',
                severity: 'warning',
                description: '注入数据演示用',
              },
            ],
      fieldWarnings: [],
      suggestions: [],
      reviewedAt: now,
      modelVersion: 'inject-demo',
    });

    created++;
  }
});

tx();

console.log(`✅ 已注入 ${created} 条待审核数据`);
console.log(`   分布任务: ${TASKS.map((t) => `${t.taskId}(${t.name})`).join(', ')}`);
console.log(`   当前 annotation-items 总数: ${db.count('annotation-items')}`);
console.log(`   当前 reviews 总数: ${db.count('reviews')}`);
console.log('');
console.log('👉 现在用 reviewer (用户名 r / 密码 123) 登录，打开「审核工作台」查看效果。');
console.log('   DevTools → Elements 可见 DOM 行数恒定在十几个，不随 300 条增长。');
console.log('');
console.log('清理：node server/seed.js 重建数据库即可。');

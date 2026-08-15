import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

function uid() {
  return randomUUID();
}

const categories = ['科技', '体育', '娱乐', '财经', '教育', '医疗', '军事', '农业'];
const tags = ['热点', '深度', '评论', '转载', '原创', '辟谣'];
const scorers = ['annotator1', 'annotator2', 'annotator3', 'annotator4'];
const sources = ['微博', '头条', '知乎', '百度'];
const statuses = ['submitted', 'pending_review', 'reviewed', 'rejected', 'draft', 'pending'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

const items = [];
for (let i = 1; i <= 500; i++) {
  const status = pick(statuses);
  const annotation =
    status === 'pending' || status === 'draft'
      ? null
      : {
          category: pick(categories),
          title: '新闻标题示例_' + i,
          content: '这是第' + i + '条标注数据的内容文本，用于测试审核工作台的虚拟滚动和筛选功能。',
          score: Math.floor(Math.random() * 5) + 1,
          tags: pickN(tags, Math.floor(Math.random() * 3) + 1),
        };
  const submitAt = annotation
    ? new Date(Date.now() - Math.random() * 7 * 24 * 3600 * 1000).toISOString()
    : null;
  const reviewed = status === 'reviewed' || status === 'rejected';
  items.push({
    id: 'item_' + String(i).padStart(4, '0'),
    taskId: 'task_test_001',
    rawData: {
      source: pick(sources),
      url: 'https://example.com/news/' + i,
      crawlAt: new Date(Date.now() - Math.random() * 30 * 24 * 3600 * 1000).toISOString(),
    },
    status,
    annotationData: annotation,
    annotator: annotation ? pick(scorers) : null,
    submittedAt: submitAt,
    reviewer: reviewed ? 'reviewer1' : null,
    reviewedAt: reviewed
      ? new Date(
          new Date(submitAt || Date.now()).getTime() + Math.random() * 3600 * 1000,
        ).toISOString()
      : null,
    rejectReason: status === 'rejected' ? '标注分类有误，请重新标注' : null,
    auditHistory: reviewed
      ? [
          {
            id: uid(),
            operator: 'reviewer1',
            actionType: status === 'reviewed' ? 'approve' : 'reject',
            fromStatus: 'pending_review',
            toStatus: status,
            reason: status === 'rejected' ? '标注分类有误' : null,
            timestamp: new Date().toISOString(),
          },
        ]
      : [],
    version: Math.floor(Math.random() * 5) + 1,
    lockedBy: null,
    lockedAt: null,
    archived: status === 'reviewed',
    archivedAt: status === 'reviewed' ? new Date().toISOString() : null,
  });
}

const path = 'f:/project/LabelHub/test-data-500.json';
writeFileSync(path, JSON.stringify(items, null, 2), 'utf-8');
console.log('Done:', items.length, 'items written to', path);

/** 审核结果查询和负责人维护接口。 */
const express = require('express');
const createCrudRouter = require('./crudFactory');
const db = require('../store/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function getReviewTime(review) {
  const time = new Date(review?.reviewedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortReviewsNewestFirst(reviews) {
  return [...reviews].sort((a, b) => {
    const timeDiff = getReviewTime(b) - getReviewTime(a);
    if (timeDiff !== 0) return timeDiff;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function latestReviewsByItem(reviews) {
  const latest = new Map();
  for (const review of sortReviewsNewestFirst(reviews)) {
    if (!latest.has(review.dataItemId)) {
      latest.set(review.dataItemId, review);
    }
  }
  return Array.from(latest.values());
}

// 特殊查询路由必须先于 CRUD 注册，否则会被 /:id 截获。

router.get('/by-item/:dataItemId', (req, res) => {
  const review = sortReviewsNewestFirst(
    db.find('reviews', { dataItemId: req.params.dataItemId }),
  )[0];
  if (!review) {
    return res.notFound('Review result not found');
  }

  const task = db.getById('tasks', review.taskId);
  if (!task || task.status !== 'in_progress') {
    return res.fail('Task is not published; review result is unavailable', 403);
  }

  return res.success(review);
});

router.get('/by-task/:taskId', (req, res) => {
  const task = db.getById('tasks', req.params.taskId);
  if (!task) {
    return res.notFound('Task not found');
  }
  if (task.status !== 'in_progress') {
    return res.fail('Task is not published; review results are unavailable', 403);
  }

  const reviews = latestReviewsByItem(db.find('reviews', { taskId: req.params.taskId }));
  return res.success({ items: reviews, total: reviews.length });
});

const crud = createCrudRouter('reviews', {
  filterList(items) {
    const visible = items.filter((item) => {
      const task = db.getById('tasks', item.taskId);
      return task && task.status === 'in_progress';
    });
    return latestReviewsByItem(visible);
  },
  beforeCreate(item, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owners can create review records';
    }
    return item;
  },
  beforeUpdate(_existing, _updates, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owners can update review records';
    }
    return undefined;
  },
  beforeDelete(_existing, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owners can delete review records';
    }
    return undefined;
  },
});

router.use(crud);

module.exports = router;

/** 用户管理接口：查询、创建、编辑、改密和删除用户。 */
const express = require('express');
const db = require('../store/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { hashPassword, validatePasswordPolicy, verifyPassword } = require('../utils/password');
const { validateFields } = require('../utils/requestValidation');
const { userCreateLimiter } = require('../middleware/apiRateLimit');

const router = express.Router();
const VALID_ROLES = ['owner', 'annotator', 'reviewer'];
const USERNAME_FIELD = {
  name: 'username',
  minLength: 1,
  maxLength: 32,
  pattern: /^[A-Za-z0-9_.-]+$/,
  patternMessage: 'username can only contain letters, numbers, underscore, dot, and hyphen',
};

router.use(requireAuth);

router.get('/', requireRole('owner'), (req, res) => {
  const items = db.getAll('users').map((item) => {
    const { password, ...safe } = item;
    return safe;
  });
  res.success({ items, total: items.length });
});

router.get('/:id', (req, res) => {
  const user = db.getById('users', req.params.id);
  if (!user) return res.fail('User not found', 404);

  if (req.currentUser.role !== 'owner' && req.currentUser.id !== user.id) {
    return res.fail('Forbidden', 403);
  }

  const { password, ...safe } = user;
  res.success(safe);
});

router.post('/', requireRole('owner'), userCreateLimiter, (req, res) => {
  const { error, values } = validateFields(req.body, [
    { ...USERNAME_FIELD, required: true },
    { name: 'password', required: true, minLength: 1, maxLength: 128, trim: false },
    { name: 'role', required: true, maxLength: 32 },
    { name: 'avatar', maxLength: 500 },
  ]);

  if (error) {
    return res.fail(error);
  }

  const { username, password, role, avatar } = values;
  if (!VALID_ROLES.includes(role)) {
    return res.fail('Invalid role. Allowed values: owner, annotator, reviewer');
  }

  const passwordError = validatePasswordPolicy(password);
  if (passwordError) {
    return res.fail(passwordError);
  }

  const existing = db.findOne('users', { username });
  if (existing) {
    return res.fail('Username already exists');
  }

  const newUser = {
    id: `u${Date.now()}`,
    username,
    password: hashPassword(password),
    role,
    avatar: avatar || null,
  };

  const created = db.insert('users', newUser);
  const { password: _pw, ...safe } = created;
  res.success(safe, 'User created', 201);
});

router.put('/:id', requireRole('owner'), (req, res) => {
  const user = db.getById('users', req.params.id);
  if (!user) return res.fail('User not found', 404);

  const { error, values } = validateFields(req.body, [
    USERNAME_FIELD,
    { name: 'role', maxLength: 32 },
    { name: 'avatar', maxLength: 500 },
  ]);

  if (error) {
    return res.fail(error);
  }

  const { username, role, avatar } = values;
  if (username && username !== user.username) {
    const existing = db.findOne('users', { username });
    if (existing) return res.fail('Username already exists');
  }

  if (role && !VALID_ROLES.includes(role)) {
    return res.fail('Invalid role');
  }

  const updates = {};
  if (username) updates.username = username;
  if (role) updates.role = role;
  if (avatar !== undefined) updates.avatar = avatar;

  const updated = db.updateById('users', req.params.id, updates);
  const { password: _pw, ...safe } = updated;
  res.success(safe, 'User updated');
});

router.put('/:id/password', (req, res) => {
  const user = db.getById('users', req.params.id);
  if (!user) return res.fail('User not found', 404);

  const { error, values } = validateFields(req.body, [
    { name: 'oldPassword', maxLength: 128, trim: false },
    { name: 'newPassword', required: true, minLength: 1, maxLength: 128, trim: false },
  ]);

  if (error) {
    return res.fail(error);
  }

  const { oldPassword, newPassword } = values;
  if (req.currentUser.role !== 'owner') {
    if (req.currentUser.id !== user.id) {
      return res.fail('Forbidden', 403);
    }
    if (!oldPassword || !verifyPassword(oldPassword, user.password)) {
      return res.fail('Old password is incorrect');
    }
  }

  const passwordError = validatePasswordPolicy(newPassword);
  if (passwordError) {
    return res.fail(passwordError);
  }

  db.updateById('users', req.params.id, {
    password: hashPassword(newPassword),
    passwordChangedAt: new Date().toISOString(),
  });
  res.success(null, 'Password updated');
});

router.delete('/:id', requireRole('owner'), (req, res) => {
  if (req.currentUser.id === req.params.id) {
    return res.fail('Cannot delete your own account');
  }

  const user = db.getById('users', req.params.id);
  if (!user) return res.fail('User not found', 404);

  db.deleteById('users', req.params.id);
  res.success(null, 'User deleted');
});

module.exports = router;

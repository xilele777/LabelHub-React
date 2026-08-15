/** 登录、当前用户信息和认证相关操作。 */
const express = require('express');
const db = require('../store/db');
const { encodeToken } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/loginRateLimit');
const { body } = require('../middleware/validate');
const { loginSchema, createUserSchema } = require('../utils/validationSchemas');
const { hashPassword, shouldUpgradePasswordHash, verifyPassword } = require('../utils/password');
const { validateFields } = require('../utils/requestValidation');
const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * 缓存用户查找结果（TTL 60s）
 * 后续 /me 和路由守卫都会频繁查用户表，登录时缓存可加速首次鉴权。
 */
async function cacheUserLookup(username) {
  const cacheKey = `user:login:${username}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const user = db.findOne('users', { username });
  if (user) {
    // 缓存 60 秒，足够登录后立即鉴权
    await cacheSet(cacheKey, user, 60);
  }
  return user;
}

router.post('/login', loginRateLimit, body(loginSchema), async (req, res) => {
  const { error, values } = validateFields(req.body, [
    {
      name: 'username',
      required: true,
      minLength: 1,
      maxLength: 32,
      pattern: /^[A-Za-z0-9_.-]+$/,
      patternMessage: 'username can only contain letters, numbers, underscore, dot, and hyphen',
    },
    { name: 'password', required: true, minLength: 1, maxLength: 128, trim: false },
  ]);

  if (error) {
    req.loginRateLimit.markFailure();
    logger.warn({ username: req.body?.username, reason: 'validation' }, 'Login validation failed');
    return res.fail(error);
  }

  const { username, password } = values;
  const user = await cacheUserLookup(username);
  if (!user || !verifyPassword(password, user.password)) {
    req.loginRateLimit.markFailure();
    logger.warn({ username, reason: 'invalid_credentials' }, 'Login failed');
    return res.fail('Invalid username or password', 401);
  }

  if (shouldUpgradePasswordHash(user.password)) {
    db.updateById('users', user.id, { password: hashPassword(password) });
    await cacheDel(`user:login:${username}`);
  }

  req.loginRateLimit.markSuccess();

  const token = encodeToken(user.id);
  const { password: _pw, ...userInfo } = user;

  // 使用 httpOnly Cookie 保存令牌，避免脚本直接读取。
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax', // Balanced: CSRF-safe for state-changing requests, allows top-level navigation
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  });

  logger.info({ username, userId: user.id }, 'User logged in');
  res.success({ token, user: userInfo }, 'Login successful');
});

router.get('/me', (req, res) => {
  if (!req.currentUser) {
    return res.unauthorized('Not logged in or token expired');
  }
  res.success(req.currentUser);
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.success(null, 'Logged out');
});

module.exports = router;

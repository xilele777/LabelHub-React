/**
 * 基于 HMAC 令牌完成请求鉴权，并将当前用户挂载到请求对象。
 * 同时支持 httpOnly Cookie 和 Authorization 头，密码变更后旧令牌立即失效。
 */
const crypto = require('crypto');
const db = require('../store/db');

// 令牌有效期：24 小时。
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

function getTokenSecret() {
  const secret = process.env.HMAC_SECRET || process.env.LABELHUB_TOKEN_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('HMAC_SECRET is required when NODE_ENV=production');
  }

  return 'labelhub-dev-secret-change-in-prod';
}

const HMAC_SECRET = getTokenSecret();

function encodeToken(userId) {
  const ts = Date.now();
  const payload = `${userId}:${ts}`;
  const signature = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

function decodeToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    // 令牌格式：userId:timestamp:hmacSignature。
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;

    const [userId, tsStr, signature] = parts;
    const timestamp = Number(tsStr);
    if (isNaN(timestamp)) return null;

    // 校验签名，防止伪造或篡改。
    const payload = `${userId}:${timestamp}`;
    const expectedSig = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
    if (signature !== expectedSig) {
      return null;
    }

    // 检查是否过期。
    if (Date.now() - timestamp > TOKEN_EXPIRY_MS) {
      return null;
    }
    return { userId, timestamp };
  } catch {
    return null;
  }
}

/**
 * 解析令牌并将不含密码的用户信息写入 req.currentUser；未登录请求继续向后传递。
 */
function authMiddleware(req, res, next) {
  // 优先读取 httpOnly Cookie。
  let token = req.cookies?.token || null;

  // API 客户端使用 Authorization 头作为兜底。
  if (!token) {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/);
    if (match) {
      token = match[1];
    }
  }

  if (!token) {
    req.currentUser = null;
    return next();
  }

  const decoded = decodeToken(token);
  if (!decoded) {
    req.currentUser = null;
    return next();
  }

  const user = db.getById('users', decoded.userId);
  if (!user) {
    req.currentUser = null;
    return next();
  }

  // 密码变更后签发的旧令牌全部失效。
  if (user.passwordChangedAt) {
    const changedAt = new Date(user.passwordChangedAt).getTime();
    if (decoded.timestamp < changedAt) {
      req.currentUser = null;
      return next();
    }
  }

  // 不把密码字段暴露给后续处理逻辑。
  const { password, ...userInfo } = user;
  req.currentUser = userInfo;
  next();
}

/**
 * 强制鉴权：没有有效用户时返回 401。
 */
function requireAuth(req, res, next) {
  if (!req.currentUser) {
    return res.unauthorized('请先登录');
  }
  next();
}

/**
 * 角色鉴权：要求当前用户属于指定角色之一。
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.currentUser) {
      return res.unauthorized('请先登录');
    }
    if (!roles.includes(req.currentUser.role)) {
      return res.fail('权限不足', 403);
    }
    next();
  };
}

module.exports = {
  encodeToken,
  decodeToken,
  authMiddleware,
  requireAuth,
  requireRole,
};

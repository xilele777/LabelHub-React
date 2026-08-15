/**
 * 统一响应中间件：为接口提供固定的 { code, message, data } 结构。
 */

function success(data = null, message = 'ok', code = 200) {
  return this.status(code).json({ code, message, data });
}

function fail(message = 'error', code = 400, data = null) {
  return this.status(code).json({ code, message, data });
}

/** 404 响应辅助方法。 */
function notFound(message = 'Resource not found') {
  return this.status(404).json({ code: 404, message, data: null });
}

/** 401 响应辅助方法。 */
function unauthorized(message = 'Unauthorized') {
  return this.status(401).json({ code: 401, message, data: null });
}

/** 将响应辅助方法挂载到 res。 */
function responseMiddleware(req, res, next) {
  res.success = success;
  res.fail = fail;
  res.notFound = notFound;
  res.unauthorized = unauthorized;
  next();
}

module.exports = responseMiddleware;

/** 为请求生成或透传链路 ID，并写入响应头。 */
const crypto = require('crypto');

function requestId(req, res, next) {
  const incomingId = req.headers['x-request-id'];
  const id =
    typeof incomingId === 'string' && incomingId.trim()
      ? incomingId.trim().slice(0, 128)
      : crypto.randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;

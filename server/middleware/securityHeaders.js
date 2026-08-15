/**
 * 设置浏览器安全响应头，包括 MIME、iframe、CSP 和生产环境 HSTS 防护。
 */
function securityHeaders(req, res, next) {
  // 基础安全响应头。
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // 禁止服务使用敏感的浏览器能力。
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Ant Design 使用运行时样式注入，因此 style-src 需要允许内联样式。
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    // 开发环境额外允许 Vite 热更新样式。
    `style-src 'self' 'unsafe-inline'${isDev ? ' http://localhost:*' : ''}`,
    "script-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);

  // 生产环境启用 HSTS。
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  next();
}

module.exports = securityHeaders;

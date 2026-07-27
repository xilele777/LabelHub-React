/**
 * Security headers middleware.
 *
 * Adds 7 security headers:
 * - X-Content-Type-Options: nosniff (MIME sniffing protection)
 * - X-Frame-Options: DENY (clickjacking protection)
 * - Referrer-Policy: no-referrer
 * - Permissions-Policy: restrict camera/mic/geolocation
 * - Strict-Transport-Security (production only, HSTS)
 * - Content-Security-Policy (XSS protection)
 * - Cross-Origin-Opener-Policy: same-origin (process isolation)
 */
function securityHeaders(req, res, next) {
  // ── Baseline headers ────────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // Restrict sensitive browser APIs
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // ── CSP ──────────────────────────────────────────────
  // Ant Design 5 uses CSS-in-JS (generates <style> elements dynamically),
  // requiring 'unsafe-inline' for style-src. Script-src stays strict.
  // In production, consider replacing 'unsafe-inline' with nonce-based approach.
  const isDev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    // style-src: allow Ant Design's dynamic <style> injection + Vite HMR in dev
    `style-src 'self' 'unsafe-inline'${isDev ? ' http://localhost:*' : ''}`,
    "script-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', csp);

  // ── HSTS (production only) ────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  next();
}

module.exports = securityHeaders;

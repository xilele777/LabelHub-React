/** 为响应对象提供统一的成功、失败和鉴权错误返回方法。 */
import type { Request, Response, NextFunction } from 'express';

// 扩展 Express Response 类型。
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Response {
      success(data?: unknown, message?: string, code?: number): Response;
      fail(message?: string, code?: number, data?: unknown): Response;
      notFound(message?: string): Response;
      unauthorized(message?: string): Response;
    }
  }
}

interface ApiResponse {
  code: number;
  message: string;
  data: unknown;
}

function success(this: Response, data: unknown = null, message = 'ok', code = 200): Response {
  return this.status(code).json({ code, message, data } satisfies ApiResponse);
}

function fail(this: Response, message = 'error', code = 400, data: unknown = null): Response {
  return this.status(code).json({ code, message, data } satisfies ApiResponse);
}

function notFound(this: Response, message = 'Resource not found'): Response {
  return this.status(404).json({ code: 404, message, data: null } satisfies ApiResponse);
}

function unauthorized(this: Response, message = 'Unauthorized'): Response {
  return this.status(401).json({ code: 401, message, data: null } satisfies ApiResponse);
}

export default function responseMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.success = success;
  res.fail = fail;
  res.notFound = notFound;
  res.unauthorized = unauthorized;
  next();
}

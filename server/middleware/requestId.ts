/** 为请求生成或透传链路 ID，并写入响应头。 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// 扩展 Express Request 类型。
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export default function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingId = req.headers['x-request-id'];
  const id =
    typeof incomingId === 'string' && incomingId.trim()
      ? incomingId.trim().slice(0, 128)
      : crypto.randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

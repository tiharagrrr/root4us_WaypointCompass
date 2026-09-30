import type { Request } from 'express';
import { uuidv7 } from 'uuidv7';

const REQUEST_ID = Symbol('requestId');
type WithRequestId = Request & { [REQUEST_ID]?: string };

/**
 * The request id: Caddy's x-request-id, or a new UUIDv7. It comes back as
 * meta.requestId and a problem's requestId. ROO-7 moves this into nestjs-cls.
 */
export function requestId(req: Request): string {
  const r = req as WithRequestId;
  r[REQUEST_ID] ??= req.header('x-request-id') || uuidv7();
  return r[REQUEST_ID];
}

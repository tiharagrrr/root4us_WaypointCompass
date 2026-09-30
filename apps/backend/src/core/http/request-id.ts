import type { Request } from 'express';
import { ensureRequestId } from '../context/request-context';

/**
 * The request id: Caddy's x-request-id, or a new UUIDv7. The same value is
 * the CLS id and pino's reqId, and comes back as meta.requestId, a problem's
 * requestId and the x-request-id response header.
 */
export function requestId(req: Request): string {
  return ensureRequestId(req);
}

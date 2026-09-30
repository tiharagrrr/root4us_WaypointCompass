import { Injectable } from '@nestjs/common';
import type { Actor } from '@waypoint/shared';
import type { IncomingMessage } from 'node:http';
import { ClsService, type ClsStore } from 'nestjs-cls';
import { uuidv7 } from 'uuidv7';
import type { Actor as DbActor } from '../../db/actor';

/** Information for the caller that is not an error, returned as meta.notices. */
export interface Notice {
  code: string;
  message: string;
}

/**
 * What CLS holds for one request or job. The CLS id is the request id (or
 * the job's), and the correlation id ties a request to its jobs,
 * notifications and audit rows.
 */
export interface AppClsStore extends ClsStore {
  correlationId: string;
  deviceId: string | null;
  /** The signed-in person, set by ActorGuard; a job carries its requester's. */
  actor?: Actor;
  /** Who each new transaction is stamped as for row-level security (jobs: system). */
  dbActor?: DbActor;
  notices?: Notice[];
}

const SAFE_ID = /^[\w.:-]{1,128}$/;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && SAFE_ID.test(first) ? first : undefined;
}

/**
 * The request id: Caddy's x-request-id, or a new UUIDv7 written back onto
 * the request so that CLS, pino-http and the envelope all read the same one,
 * whichever middleware runs first. Unsafe values are replaced.
 */
export function ensureRequestId(req: IncomingMessage): string {
  const id = header(req, 'x-request-id') ?? uuidv7();
  req.headers['x-request-id'] = id;
  return id;
}

/** x-correlation-id, or the request id when the caller sent none. */
export function correlationIdOf(req: IncomingMessage): string {
  return header(req, 'x-correlation-id') ?? ensureRequestId(req);
}

/** x-device-id, which the web client sends on every call. */
export function deviceIdOf(req: IncomingMessage): string | null {
  return header(req, 'x-device-id') ?? null;
}

/**
 * Typed access to the current request or job context, for services that
 * need the correlation id, the actor or to add a notice.
 */
@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.getId() : undefined;
  }

  get correlationId(): string | undefined {
    return this.cls.isActive() ? this.cls.get('correlationId') : undefined;
  }

  get deviceId(): string | null {
    return (this.cls.isActive() && this.cls.get('deviceId')) || null;
  }

  get actor(): Actor | undefined {
    return this.cls.isActive() ? this.cls.get('actor') : undefined;
  }

  /** Adds a notice to this response's meta.notices. */
  addNotice(notice: Notice): void {
    this.cls.set('notices', [...(this.cls.get('notices') ?? []), notice]);
  }
}

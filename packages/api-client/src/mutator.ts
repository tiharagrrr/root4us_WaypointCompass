import { emitUnauthenticated } from './auth-events.ts';
import { apiConfig } from './config.ts';
import { getDeviceId } from './device-id.ts';
import { ApiProblem } from './problem.ts';
import { syncServerClock } from './server-clock.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readBody = async (res: Response): Promise<unknown> => {
  if (res.status === 204 || res.status === 205) return undefined;
  const text = await res.text();
  if (text === '') return undefined;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
};

const serverTimeOf = (body: unknown): unknown =>
  isRecord(body) && isRecord(body.meta) ? body.meta.serverTime : undefined;

/**
 * The fetch every generated hook goes through (orval mutator). Same-origin by default, sends the
 * session cookie and x-device-id, and returns the body untouched: callers get the whole
 * { data, meta, _links } envelope. Non-2xx responses throw ApiProblem; a 401 also tells the app.
 */
export const compassFetch = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  headers.set('x-device-id', getDeviceId());
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !headers.has('Idempotency-Key')) {
    // <Action> passes one key per press; this covers calls made without it.
    headers.set('Idempotency-Key', globalThis.crypto.randomUUID());
  }
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${apiConfig.baseUrl}${url}`, { ...init, headers, credentials: 'include' });
  const body = await readBody(res);

  if (!res.ok) {
    const problem = ApiProblem.from(res.status, res.statusText, body);
    if (res.status === 401) emitUnauthenticated(problem);
    throw problem;
  }

  syncServerClock(serverTimeOf(body));
  return body as T;
};

/** orval reads these to type the hooks' error and request bodies. */
export type ErrorType<_Error> = ApiProblem;
export type BodyType<BodyData> = BodyData;

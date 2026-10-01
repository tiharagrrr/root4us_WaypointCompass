import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onUnauthenticated } from '../auth-events.ts';
import { compassFetch } from '../mutator.ts';
import { ApiProblem } from '../problem.ts';
import { resetServerClock, serverClock } from '../server-clock.ts';

const json = (body: unknown, status = 200, type = 'application/json'): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

const validationProblem = {
  type: 'https://compass.waypoint.lk/problems/validation-failed',
  title: 'Some fields need attention',
  status: 400,
  code: 'VALIDATION_FAILED',
  instance: '/api/v1/invitations',
  requestId: '0192a3f5-1b2c-7d3e-8f4a-5b6c7d8e9f0a',
  errors: [{ field: 'email', code: 'email', message: 'Enter a valid email' }],
};

describe('compassFetch', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetServerClock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws a typed ApiProblem for an application/problem+json response', async () => {
    fetchMock.mockResolvedValue(json(validationProblem, 400, 'application/problem+json'));

    const error = await compassFetch('/api/v1/invitations', { method: 'POST', body: '{}' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ApiProblem);
    const problem = error as ApiProblem;
    expect(problem.status).toBe(400);
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.title).toBe('Some fields need attention');
    expect(problem.requestId).toBe(validationProblem.requestId);
    expect(problem.errors).toEqual(validationProblem.errors);
  });

  it('turns a failure without a problem body into an ApiProblem from the status', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }));

    const error = await compassFetch('/api/v1/me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiProblem);
    expect(error).toMatchObject({ status: 502, code: 'INTERNAL', title: 'Bad Gateway', errors: [] });
  });

  it('returns the whole envelope and aligns the server clock to meta.serverTime', async () => {
    const envelope = {
      data: [{ id: 'u1', _links: { self: { href: '/api/v1/users/u1' } } }],
      meta: { requestId: 'r1', serverTime: '2026-10-01T15:55:00+05:30', apiVersion: '1.0.0', page: { limit: 10, offset: 0, total: 1 } },
      _links: { self: { href: '/api/v1/users?limit=10&offset=0' } },
    };
    fetchMock.mockResolvedValue(json(envelope));

    const body = await compassFetch<typeof envelope>('/api/v1/users');

    expect(body).toEqual(envelope);
    expect(serverClock.getSnapshot().serverTime).toBe('2026-10-01T15:55:00+05:30');
    expect(Math.abs(serverClock.now() - Date.parse('2026-10-01T15:55:00+05:30'))).toBeLessThan(5_000);
  });

  it('sends same-origin requests with the cookie, x-device-id and an Idempotency-Key on writes', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(compassFetch('/api/v1/invitations/i1/resend', { method: 'POST' })).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/invitations/i1/resend');
    expect(init?.credentials).toBe('include');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-device-id')).toMatch(/^[\w-]+$/);
    expect(headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the Idempotency-Key a caller passes and tells listeners about a 401', async () => {
    const listener = vi.fn();
    const stop = onUnauthenticated(listener);
    fetchMock.mockResolvedValue(
      json({ type: 'about:blank', title: 'Sign in again', status: 401, code: 'UNAUTHENTICATED', instance: '/api/v1/me', requestId: 'r2' }, 401, 'application/problem+json'),
    );

    await expect(
      compassFetch('/api/v1/me', { method: 'PATCH', headers: { 'Idempotency-Key': 'press-1' }, body: '{}' }),
    ).rejects.toBeInstanceOf(ApiProblem);

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Idempotency-Key')).toBe('press-1');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    stop();
  });
});

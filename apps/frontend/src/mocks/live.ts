import { http, passthrough, type HttpHandler } from 'msw'

export type LiveMethod = 'all' | 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface LiveEndpoint {
  method: LiveMethod
  /** Same-origin path; MSW path syntax (`*` wildcard, `:param`). */
  path: string
}

/**
 * Endpoints the real API serves in development. MSW lets these through and answers every other
 * request under /api/v1 from the generated mocks (the OpenAPI examples). Add an endpoint here as
 * soon as it works on the API; delete the mock-only behaviour from screens, never the other way.
 */
export const LIVE_ENDPOINTS: readonly LiveEndpoint[] = [
  // BetterAuth: sign-in, sessions, OTP and PIN. Never mocked.
  { method: 'all', path: '/api/auth/*' },
  // Health is outside /api/v1 and has no mock.
  { method: 'all', path: '/api/health' },
  // Identity, settings, clock and deferral reasons (ROO-27).
  { method: 'all', path: '/api/v1' },
  { method: 'all', path: '/api/v1/me' },
  { method: 'all', path: '/api/v1/me/*' },
  { method: 'all', path: '/api/v1/users' },
  { method: 'all', path: '/api/v1/users/*' },
  { method: 'all', path: '/api/v1/invitations' },
  { method: 'all', path: '/api/v1/invitations/*' },
  { method: 'all', path: '/api/v1/devices' },
  { method: 'all', path: '/api/v1/devices/*' },
  { method: 'all', path: '/api/v1/settings' },
  { method: 'all', path: '/api/v1/settings/*' },
  { method: 'all', path: '/api/v1/clock' },
  { method: 'all', path: '/api/v1/demo/*' },
  { method: 'all', path: '/api/v1/deferral-reasons' },
  { method: 'all', path: '/api/v1/deferral-reasons/*' },
]

/** Pass-through handlers; they go before the mocks so they win. */
export const liveHandlers = (endpoints: readonly LiveEndpoint[] = LIVE_ENDPOINTS): HttpHandler[] =>
  endpoints.map(({ method, path }) => http[method](path, () => passthrough()))

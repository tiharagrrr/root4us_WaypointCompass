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
  // Master data reads and the A3/A4 edits (ROO-19).
  { method: 'all', path: '/api/v1/depots' },
  { method: 'all', path: '/api/v1/depots/*' },
  { method: 'all', path: '/api/v1/districts' },
  { method: 'all', path: '/api/v1/outlets' },
  { method: 'all', path: '/api/v1/outlets/*' },
  { method: 'all', path: '/api/v1/items' },
  { method: 'all', path: '/api/v1/items/*' },
  { method: 'all', path: '/api/v1/calendar' },
  { method: 'all', path: '/api/v1/service-allowances' },
  { method: 'all', path: '/api/v1/traffic-speeds' },
  { method: 'all', path: '/api/v1/road-conditions' },
  // Ordering: drafts, lines, submit, cancel, reorder, presets, the receiving
  // roster and the depot day summary (ROO-19).
  { method: 'all', path: '/api/v1/orders' },
  { method: 'all', path: '/api/v1/orders/*' },
  { method: 'all', path: '/api/v1/order-templates' },
  { method: 'all', path: '/api/v1/order-templates/*' },
  // Execution: the driver's trips, the offline bundle, the field events and
  // proof of delivery (ROO-31). /api/v1/me/* above already covers /me/trips.
  { method: 'all', path: '/api/v1/trips/*' },
  { method: 'all', path: '/api/v1/stops/*' },
  { method: 'all', path: '/api/v1/attachments/*' },
  // Loading: the dock's boards, the load list, checks, flags, the release
  // checks and the release (ROO-33, wired to the screens in ROO-34).
  // `/api/v1/trips/*` and `/api/v1/depots/*` above already cover the trip and
  // depot paths, so what is left is the two resources of its own.
  { method: 'all', path: '/api/v1/load-flags' },
  { method: 'all', path: '/api/v1/load-flags/*' },
  { method: 'all', path: '/api/v1/load-lines/*' },
  // Alerts: the list, the detail, acknowledge and resolve (ROO-50). The fix
  // links they carry point at endpoints other modules still owe, so a panel
  // may show a fix whose POST is still mocked.
  { method: 'all', path: '/api/v1/alerts' },
  { method: 'all', path: '/api/v1/alerts/*' },
  // Fleet: a vehicle's fuel for a week (ROO-42). The rest of /vehicles is
  // still mocked.
  { method: 'get', path: '/api/v1/vehicles/:id/fuel' },
]

/** Pass-through handlers; they go before the mocks so they win. */
export const liveHandlers = (endpoints: readonly LiveEndpoint[] = LIVE_ENDPOINTS): HttpHandler[] =>
  endpoints.map(({ method, path }) => http[method](path, () => passthrough()))

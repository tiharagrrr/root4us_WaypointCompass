/**
 * Thin fetch wrapper for the REST API. Requests are same-origin (/api/v1),
 * proxied by Vite in dev and by Caddy in Docker, and send the session cookie.
 * Replace with the orval-generated client once the OpenAPI spec settles.
 */
export const API_BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return (await res.json()) as T
}

export interface HealthStatus {
  status: 'ok' | 'error'
  info?: Record<string, { status: string }>
  error?: Record<string, { status: string; message?: string }>
}

/** Health lives outside /api/v1; Caddy exposes it as /api/health. */
export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch('/api/health')
  return (await res.json()) as HealthStatus
}

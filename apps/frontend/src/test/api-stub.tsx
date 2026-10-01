import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'

type Handler = (url: URL, init: RequestInit | undefined) => unknown

/** The envelope the API wraps every result in (specs/api-conventions.md). */
export const envelope = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  meta: { requestId: 'r1', serverTime: '2026-10-01T15:12:00+05:30', apiVersion: '1.0.0', ...extra },
})

export const page = (items: unknown[], links: Record<string, unknown> = {}) => ({
  ...envelope(items, { page: { limit: 10, offset: 0, total: items.length } }),
  _links: { self: { href: '/x' }, ...links },
})

/**
 * Stubs fetch with a route table keyed "METHOD /path" (path without query). Unknown routes answer
 * 404 problem+json, so a test fails loudly when a screen calls something unexpected.
 */
export function stubApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    calls.push({ method, path: url.pathname, body })
    const handler = routes[`${method} ${url.pathname}`]
    if (!handler)
      return new Response(JSON.stringify({ code: 'NOT_FOUND', status: 404, title: 'Not found' }), {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      })
    const result = handler(url, init)
    if (result instanceof Response) return result
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls }
}

export function renderScreen(ui: ReactElement, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

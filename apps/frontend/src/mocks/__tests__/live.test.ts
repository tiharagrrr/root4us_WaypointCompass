import { describe, expect, it } from 'vitest'
import { handlers } from '../handlers'
import { LIVE_ENDPOINTS } from '../live'

const pathOf = (handler: (typeof handlers)[number]): string => String((handler.info as { path?: unknown }).path)

describe('MSW handlers', () => {
  it('lets the live endpoints through before any mock, and never mocks BetterAuth', () => {
    expect(handlers.slice(0, LIVE_ENDPOINTS.length).map(pathOf)).toEqual(LIVE_ENDPOINTS.map((e) => e.path))
    expect(LIVE_ENDPOINTS).toContainEqual({ method: 'all', path: '/api/auth/*' })
    expect(LIVE_ENDPOINTS).toContainEqual({ method: 'all', path: '/api/v1/me' })
  })

  it('mocks the rest of /api/v1 from the generated handlers', () => {
    const mocked = handlers.slice(LIVE_ENDPOINTS.length).map(pathOf)
    expect(mocked).toContain('*/api/v1/users')
    expect(mocked.some((p) => p.includes('/api/auth'))).toBe(false)
  })
})

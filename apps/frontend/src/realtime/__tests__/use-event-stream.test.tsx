import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eventBus, type DomainEvent } from '../event-bus'
import { EVENT_STREAM_URL, useEventStream } from '../use-event-stream'

/** jsdom has no EventSource; this one records its listeners so a test can push a frame. */
class FakeEventSource {
  static last: FakeEventSource | undefined
  readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  closed = false

  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeEventSource.last = this
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener))
  }

  close() {
    this.closed = true
  }

  /** Delivers one server frame. */
  send(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
}

const event = (type: string, over: Partial<DomainEvent> = {}): DomainEvent => ({
  v: 1,
  type,
  aggregate: { type: 'order', id: 'o-1' },
  routing: { depotId: 'PLG', outletIds: ['OUT-FK'] },
  data: {},
  occurredAt: '2026-10-01T15:12:00+05:30',
  ...over,
})

const Shell = () => {
  useEventStream()
  return null
}

const mount = (client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>,
  )

describe('useEventStream', () => {
  let client: QueryClient

  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource)
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens one stream per shell and closes it on unmount', () => {
    const { unmount } = mount(client)

    expect(FakeEventSource.last?.url).toBe(EVENT_STREAM_URL)
    unmount()
    expect(FakeEventSource.last?.closed).toBe(true)
  })

  it('invalidates the paths an event makes stale, and nothing else', () => {
    mount(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    FakeEventSource.last?.send('order.submitted', event('order.submitted'))

    const predicate = invalidate.mock.calls[0]?.[0]?.predicate
    expect(predicate).toBeTypeOf('function')
    expect(predicate?.({ queryKey: ['/api/v1/orders', { limit: 10 }] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['/api/v1/depots/PLG/days/2026-10-01'] } as never)).toBe(true)
    expect(predicate?.({ queryKey: ['/api/v1/users'] } as never)).toBe(false)
  })

  it('a resync frame makes the whole cache stale', () => {
    mount(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    FakeEventSource.last?.send('resync', {})

    expect(invalidate).toHaveBeenCalledWith()
  })

  it('passes a position to the bus without invalidating any query', () => {
    mount(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const seen: DomainEvent[] = []
    const off = eventBus.on((e) => seen.push(e))

    FakeEventSource.last?.send('vehicle.position', event('vehicle.position', { aggregate: { type: 'vehicle', id: 'VEH007' } }))
    off()

    expect(seen.map((e) => e.type)).toEqual(['vehicle.position'])
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('ignores a frame that is not a domain event', () => {
    mount(client)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    FakeEventSource.last?.send('order.submitted', { hello: 'world' })

    expect(invalidate).not.toHaveBeenCalled()
  })
})

import type { OrderDto } from '@compass/api-client'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setMockNow } from '../demo-clock'
import { exposeDemoControls, orderingDemoHandlers } from '../ordering-demo'

interface Envelope<T> {
  data: T
  meta: { notices?: { code: string; message: string }[] }
}

const server = setupServer(...orderingDemoHandlers())

const get = async <T>(path: string): Promise<Envelope<T>> =>
  (await fetch(`http://localhost${path}`)).json() as Promise<Envelope<T>>

const orders = async (): Promise<OrderDto[]> => (await get<OrderDto[]>('/api/v1/orders')).data

const problemOf = async (res: Response): Promise<{ code: string; detail?: string }> =>
  (await res.json()) as { code: string; detail?: string }

/**
 * The hand-built Ordering API the store screens run on in development. These are the numbers M1,
 * M1b and M2 show, so a slip in the demo data fails here rather than in front of a judge.
 */
describe('the Ordering demo API', () => {
  beforeAll(() => {
    setMockNow('2026-10-01T14:12:00+05:30')
    exposeDemoControls()
    server.listen({ onUnhandledRequest: 'error' })
  })
  afterEach(() => {
    globalThis.compassMock?.reset()
  })
  afterAll(() => {
    setMockNow(null)
    server.close()
  })

  it('opens the day with a dry and a chilled draft, totalled from their lines', async () => {
    const day = await orders()

    expect(day).toHaveLength(2)
    const [dry, chilled] = day
    expect(dry?.tempClass).toBe('AMBIENT')
    expect(dry?.status).toBe('DRAFT')
    expect(dry?.totals).toMatchObject({ lines: 5, units: 40, weightKg: 544, volumeM3: 1.08 })
    expect(dry?.editableUntil).toBe('2026-10-01T16:00:00+05:30')
    expect(dry?.afterCutoff).toBe(false)
    expect(chilled?.tempClass).toBe('CHILLED')
    expect(chilled?.totals).toMatchObject({ lines: 3, units: 30 })
  })

  it('offers only the actions the order is in a state for', async () => {
    const [dry] = await orders()

    expect(Object.keys(dry?._links ?? {}).sort()).toEqual(
      ['addLine', 'lines', 'saveAsTemplate', 'self', 'setLines', 'submit', 'timeline'].sort(),
    )
  })

  it('refuses a write that carries a stale version', async () => {
    const [dry] = await orders()
    const res = await fetch(`http://localhost/api/v1/orders/${dry.id}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'If-Match': 'W/"9"' },
      body: JSON.stringify({ itemId: '0192b001-0000-7000-8000-000000000003', qty: 2 }),
    })

    expect(res.status).toBe(412)
    expect((await problemOf(res)).code).toBe('VERSION_MISMATCH')
  })

  it('adds a line, moves the totals on and bumps the version', async () => {
    const [dry] = await orders()
    const res = await fetch(`http://localhost/api/v1/orders/${dry.id}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'If-Match': `W/"${dry?.version}"` },
      body: JSON.stringify({ itemId: '0192b001-0000-7000-8000-000000000003', qty: 2 }),
    })
    const body = (await res.json()) as Envelope<OrderDto>

    expect(res.status).toBe(200)
    expect(body.data.version).toBe((dry?.version ?? 0) + 1)
    expect(body.data.totals).toMatchObject({ lines: 6, units: 42, weightKg: 564 })
  })

  it('refuses a chilled item on the dry order, as AC-ORD-05 asks', async () => {
    const [dry] = await orders()
    const res = await fetch(`http://localhost/api/v1/orders/${dry.id}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'If-Match': `W/"${dry?.version}"` },
      body: JSON.stringify({ itemId: '0192b002-0000-7000-8000-000000000003', qty: 2 }),
    })

    expect(res.status).toBe(400)
    expect((await problemOf(res)).detail).toBe('Add chilled items to a chilled order')
  })

  it('sends the order, and after 16:00 rolls it to the next run with the M2 notice', async () => {
    const [dry] = await orders()
    const send = async (id: string, version: number) =>
      fetch(`http://localhost/api/v1/orders/${id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'If-Match': `W/"${version}"` },
        body: '{}',
      })

    const onTime = (await (await send(dry?.id ?? '', dry?.version ?? 0)).json()) as Envelope<OrderDto>
    expect(onTime.data.status).toBe('SUBMITTED')
    expect(onTime.data.deliveryDate).toBe('2026-10-01')
    expect(onTime.meta.notices).toBeUndefined()

    globalThis.compassMock?.setNow('2026-10-01T16:12:00+05:30')
    const [, chilled] = await orders()
    const late = (await (await send(chilled?.id ?? '', chilled?.version ?? 0)).json()) as Envelope<OrderDto>

    expect(late.data.afterCutoff).toBe(true)
    expect(late.data.deliveryDate).toBe('2026-10-02')
    expect(late.meta.notices?.[0]).toMatchObject({ code: 'ORDER_ROLLED_TO_NEXT_RUN' })
    globalThis.compassMock?.setNow('2026-10-01T14:12:00+05:30')
  })
})

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompassDb } from '../db'
import { enqueue, setSyncPoke } from '../outbox'
import { uuidv7 } from '../ids'
import {
  BACKOFF_SECONDS,
  BATCH_LIMIT,
  PausedError,
  SyncEngine,
  backoffMs,
  toWireEvent,
  type SyncItemResult,
} from '../sync-engine'

let db: CompassDb
const AT = new Date('2026-10-02T06:00:00+05:30')
const now = () => AT

beforeEach(async () => {
  setSyncPoke(() => {})
  db = new CompassDb(`test-${uuidv7()}`)
  await db.open()
  vi.stubGlobal('navigator', { onLine: true })
})

const queueArrival = () =>
  enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: 'stop-8' }, db)

const engineWith = (
  transport: (body: { deviceId: string; events: unknown[] }) => Promise<{ results: SyncItemResult[] }>,
) => new SyncEngine({ database: db, transport, now })

describe('backoff', () => {
  it('retries after 2, 5, 15, 30, then every 60 seconds', () => {
    expect(BACKOFF_SECONDS).toEqual([2, 5, 15, 30, 60])
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffMs)).toEqual([
      2000, 5000, 15_000, 30_000, 60_000, 60_000, 60_000,
    ])
  })
})

describe('flush', () => {
  it('sends the batch in device order and clears what the server applied', async () => {
    const a = await queueArrival()
    const b = await enqueue({ kind: 'driver', type: 'DELIVERED', tripId: 'trip-1', stopId: 'stop-8', receiverName: 'Nuwan' }, db)

    const sent: unknown[] = []
    await engineWith(async (body) => {
      sent.push(...body.events)
      return {
        results: body.events.map((e) => ({
          clientUuid: (e as { clientUuid: string }).clientUuid,
          status: 'applied' as const,
        })),
      }
    }).flush()

    expect(sent).toHaveLength(2)
    expect((sent[0] as { deviceSeq: number }).deviceSeq).toBe(a.deviceSeq)
    expect((sent[1] as { deviceSeq: number }).deviceSeq).toBe(b.deviceSeq)
    await expect(db.outbox.count()).resolves.toBe(0)
  })

  it('treats duplicate like applied, so a replay drains the queue', async () => {
    await queueArrival()
    await engineWith(async (body) => ({
      results: body.events.map((e) => ({
        clientUuid: (e as { clientUuid: string }).clientUuid,
        status: 'duplicate' as const,
      })),
    })).flush()
    await expect(db.outbox.count()).resolves.toBe(0)
  })

  it('keeps a conflict in the outbox for 19c to resolve', async () => {
    const { deviceSeq } = await queueArrival()
    await engineWith(async (body) => ({
      results: body.events.map((e) => ({
        clientUuid: (e as { clientUuid: string }).clientUuid,
        status: 'conflict' as const,
        code: 'STOP_CANCELLED',
        message: 'The stop was cancelled',
      })),
    })).flush()

    await expect(db.outbox.get(deviceSeq)).resolves.toMatchObject({
      status: 'conflict',
      code: 'STOP_CANCELLED',
      message: 'The stop was cancelled',
    })
  })

  it('keeps a rejection with its message rather than dropping the tap', async () => {
    const { deviceSeq } = await queueArrival()
    await engineWith(async (body) => ({
      results: body.events.map((e) => ({
        clientUuid: (e as { clientUuid: string }).clientUuid,
        status: 'rejected' as const,
        code: 'NOT_YOUR_TRIP',
      })),
    })).flush()
    await expect(db.outbox.get(deviceSeq)).resolves.toMatchObject({ status: 'rejected', code: 'NOT_YOUR_TRIP' })
  })

  it('backs off after a network failure and never loses the row', async () => {
    const { deviceSeq } = await queueArrival()
    await engineWith(() => Promise.reject(new Error('offline'))).flush()

    const row = await db.outbox.get(deviceSeq)
    expect(row?.status).toBe('pending')
    expect(row?.attempts).toBe(1)
    expect(row?.nextAttemptAt).toBe(new Date(AT.getTime() + 2000).toISOString())
  })

  it('a 401 pauses sync and keeps the outbox', async () => {
    const { deviceSeq } = await queueArrival()
    const engine = engineWith(() => Promise.reject(new PausedError()))
    await engine.flush()
    await expect(db.outbox.get(deviceSeq)).resolves.toMatchObject({ status: 'pending' })

    // Paused: a later flush must not even reach the transport.
    const transport = vi.fn()
    const paused = new SyncEngine({ database: db, transport, now })
    await paused.flush()
    expect(transport).not.toHaveBeenCalled()
  })

  it('does nothing while the device is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await queueArrival()
    const transport = vi.fn()
    await new SyncEngine({ database: db, transport, now }).flush()
    expect(transport).not.toHaveBeenCalled()
  })

  it('leaves a row the server said nothing about pending', async () => {
    const { deviceSeq } = await queueArrival()
    await engineWith(async () => ({ results: [] })).flush()
    await expect(db.outbox.get(deviceSeq)).resolves.toMatchObject({ status: 'pending' })
  })

  it('sends at most one batch limit of events', async () => {
    for (let i = 0; i < BATCH_LIMIT + 5; i += 1) await queueArrival()
    let seen = 0
    await engineWith(async (body) => {
      seen = body.events.length
      return {
        results: body.events.map((e) => ({
          clientUuid: (e as { clientUuid: string }).clientUuid,
          status: 'applied' as const,
        })),
      }
    }).flush()
    expect(seen).toBe(BATCH_LIMIT)
    await expect(db.outbox.count()).resolves.toBe(5)
  })

  it('records when the last batch got through', async () => {
    await queueArrival()
    await engineWith(async (body) => ({
      results: body.events.map((e) => ({
        clientUuid: (e as { clientUuid: string }).clientUuid,
        status: 'applied' as const,
      })),
    })).flush()
    await expect(db.meta.get('lastSyncAt')).resolves.toMatchObject({ value: AT.toISOString() })
  })
})

describe('toWireEvent', () => {
  it('sends the device time and tap order, and keeps `kind` on the device', async () => {
    const { deviceSeq, clientUuid } = await queueArrival()
    const row = await db.outbox.get(deviceSeq)
    const wire = toWireEvent(row!)
    expect(wire).toMatchObject({
      clientUuid,
      type: 'ARRIVED',
      tripId: 'trip-1',
      stopId: 'stop-8',
      deviceSeq,
    })
    expect(wire.occurredAt).toBe(row!.occurredAt)
    expect(wire.deviceTime).toBe(row!.deviceTime)
    expect(wire).not.toHaveProperty('kind')
  })
})

describe('the retry schedule across repeated failures', () => {
  it('waits 2, then 5, then 15 seconds', async () => {
    const { deviceSeq } = await enqueue(
      { kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: 'stop-8' },
      db,
    )
    const engine = engineWith(() => Promise.reject(new Error('offline')))
    const waits: number[] = []
    for (let i = 0; i < 3; i += 1) {
      // Clear the backoff so the next flush picks the row up again at the frozen clock.
      await db.outbox.update(deviceSeq, { nextAttemptAt: null })
      await engine.flush()
      const row = await db.outbox.get(deviceSeq)
      waits.push(Date.parse(row!.nextAttemptAt!) - AT.getTime())
    }
    expect(waits).toEqual([2000, 5000, 15_000])
    await expect(db.outbox.get(deviceSeq)).resolves.toMatchObject({ attempts: 3, status: 'pending' })
  })
})

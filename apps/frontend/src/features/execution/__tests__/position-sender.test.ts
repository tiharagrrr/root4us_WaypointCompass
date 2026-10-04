import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompassDb, type PingRow } from '@/offline/db'
import { flushPings, queuePing } from '../position-sender'

const fix = (n: number): PingRow => ({
  tripId: 't1',
  lat: 7 + n / 1000,
  lng: 79.95,
  accuracyM: 12,
  speedKmh: 30,
  heading: 0,
  recordedAt: new Date(Date.UTC(2026, 9, 1, 22, 40, n * 5)).toISOString(),
})

describe('the driver phone’s GPS queue (ROO-37)', () => {
  let database: CompassDb
  afterEach(async () => {
    await database.delete()
  })

  it('queues fixes offline and sends them in one batch once there is signal', async () => {
    database = new CompassDb(`pings-${Math.random()}`)
    for (const n of [0, 1, 2]) await queuePing(fix(n), database)

    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await flushPings(database, offline)).toBe(0)
    expect(await database.pings.count()).toBe(3)

    const online = vi.fn().mockResolvedValue({ data: { accepted: 3, duplicates: 0, rejected: 0 } })
    expect(await flushPings(database, online)).toBe(3)
    expect(online).toHaveBeenCalledTimes(1)
    const sent = online.mock.calls[0][0] as { pings: { recordedAt: string }[] }
    expect(sent.pings.map((p) => p.recordedAt)).toEqual([0, 1, 2].map((n) => fix(n).recordedAt))
    expect(await database.pings.count()).toBe(0)
  })

  it('never sends more than 200 at once', async () => {
    database = new CompassDb(`pings-${Math.random()}`)
    await database.pings.bulkAdd(Array.from({ length: 250 }, (_, n) => fix(n)))
    const send = vi.fn().mockResolvedValue({})
    expect(await flushPings(database, send)).toBe(250)
    expect(send.mock.calls.map(([batch]) => (batch as { pings: unknown[] }).pings.length)).toEqual([200, 50])
  })
})

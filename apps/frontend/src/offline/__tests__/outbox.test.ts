import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompassDb, type CachedLoadLine, type CachedStop, type CachedTrip } from '../db'
import { enqueue, pendingCount, setSyncPoke } from '../outbox'
import { uuidv7 } from '../ids'

const trip = (over: Partial<CachedTrip> = {}): CachedTrip => ({
  id: 'trip-1',
  tripRef: 'REF-07',
  status: 'RELEASED',
  vehicleCode: 'REF-07',
  depotId: 'depot-1',
  planDate: '2026-10-02',
  departsAt: '2026-10-02T05:45:00+05:30',
  stopCount: 8,
  tempClass: 'CHILLED',
  bundleVersion: 1,
  version: 1,
  ...over,
})

const stop = (over: Partial<CachedStop> = {}): CachedStop => ({
  id: 'stop-8',
  tripId: 'trip-1',
  sequence: 8,
  status: 'PENDING',
  outletId: 'outlet-1',
  outletName: 'Fresh Seeduwa',
  district: 'Seeduwa',
  windowStart: null,
  windowEnd: null,
  lat: null,
  lng: null,
  accessNote: null,
  contactName: null,
  contactPhone: null,
  version: 1,
  ...over,
})

const loadLine = (over: Partial<CachedLoadLine> = {}): CachedLoadLine => ({
  id: 'line-1',
  tripId: 'trip-1',
  stopId: 'stop-8',
  loadSequence: 1,
  itemName: 'Fresh milk 1 L',
  qtyPlanned: 14,
  qtyLoaded: null,
  status: 'PENDING',
  tempClass: 'CHILLED',
  fragile: false,
  checkedByName: null,
  version: 1,
  ...over,
})

let db: CompassDb

beforeEach(async () => {
  setSyncPoke(() => {})
  db = new CompassDb(`test-${uuidv7()}`)
  await db.open()
  await db.trips.put(trip())
  await db.stops.put(stop())
  await db.loadLines.put(loadLine())
})

describe('uuidv7', () => {
  it('makes a version 7 uuid that sorts by time', async () => {
    const first = uuidv7()
    await new Promise((r) => setTimeout(r, 2))
    const second = uuidv7()
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(first < second).toBe(true)
  })

  it('never reuses an id across two taps', () => {
    const ids = new Set(Array.from({ length: 500 }, uuidv7))
    expect(ids.size).toBe(500)
  })
})

describe('enqueue', () => {
  it('queues the tap and moves the cache in one transaction', async () => {
    const { clientUuid, deviceSeq } = await enqueue(
      { kind: 'loader', type: 'LOAD_LINE_CHECKED', tripId: 'trip-1', loadLineId: 'line-1', qtyLoaded: 14, checkedByName: 'Harini' },
      db,
    )

    expect(clientUuid).toMatch(/-7[0-9a-f]{3}-/)
    const row = await db.outbox.get(deviceSeq)
    expect(row).toMatchObject({ clientUuid, status: 'pending', attempts: 0, nextAttemptAt: null })
    expect(row?.occurredAt).toBeTruthy()
    expect(row?.deviceTime).toBeTruthy()

    // The reducer ran in the same transaction, so the screen shows the check at once.
    await expect(db.loadLines.get('line-1')).resolves.toMatchObject({
      status: 'OK',
      qtyLoaded: 14,
      checkedByName: 'Harini',
    })
  })

  it('numbers taps in the order they happened', async () => {
    const a = await enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: 'stop-8' }, db)
    const b = await enqueue({ kind: 'driver', type: 'DELIVERED', tripId: 'trip-1', stopId: 'stop-8' }, db)
    expect(b.deviceSeq).toBeGreaterThan(a.deviceSeq)
  })

  it('counts what is still waiting to send', async () => {
    await enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: 'stop-8' }, db)
    await enqueue({ kind: 'driver', type: 'DELIVERED', tripId: 'trip-1', stopId: 'stop-8' }, db)
    await expect(pendingCount(db)).resolves.toBe(2)
  })

  it('pokes the sync engine, marking CANT_RUN urgent so it leaves at once', async () => {
    const poke = vi.fn()
    setSyncPoke(poke)
    await enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: 'stop-8' }, db)
    expect(poke).toHaveBeenLastCalledWith({ urgent: false })
    await enqueue({ kind: 'driver', type: 'CANT_RUN', tripId: 'trip-1', reasonCode: 'BREAKDOWN' }, db)
    expect(poke).toHaveBeenLastCalledWith({ urgent: true })
  })
})

describe('applyOptimistic', () => {
  it('flags a line and opens a flag keyed by the tap, so Undo can find it', async () => {
    const { clientUuid } = await enqueue(
      { kind: 'loader', type: 'LOAD_FLAG_RAISED', tripId: 'trip-1', loadLineId: 'line-1', reason: 'DAMAGED', qtyAffected: 3, note: 'Crate crushed', checkedByName: 'Harini' },
      db,
    )
    await expect(db.loadLines.get('line-1')).resolves.toMatchObject({ status: 'FLAGGED' })
    await expect(db.loadFlags.get(clientUuid)).resolves.toMatchObject({
      status: 'OPEN',
      reason: 'DAMAGED',
      qtyAffected: 3,
      loadLineId: 'line-1',
    })
  })

  it('undoing a flag returns the line to pending', async () => {
    const { clientUuid } = await enqueue(
      { kind: 'loader', type: 'LOAD_FLAG_RAISED', tripId: 'trip-1', loadLineId: 'line-1', reason: 'MISSING', qtyAffected: 1 },
      db,
    )
    await enqueue({ kind: 'loader', type: 'LOAD_FLAG_UNDONE', tripId: 'trip-1', loadFlagId: clientUuid }, db)
    await expect(db.loadFlags.get(clientUuid)).resolves.toBeUndefined()
    await expect(db.loadLines.get('line-1')).resolves.toMatchObject({ status: 'PENDING' })
  })

  it('undoing a check clears the quantity and the name', async () => {
    await enqueue({ kind: 'loader', type: 'LOAD_LINE_CHECKED', tripId: 'trip-1', loadLineId: 'line-1', qtyLoaded: 14, checkedByName: 'Harini' }, db)
    await enqueue({ kind: 'loader', type: 'LOAD_CHECK_UNDONE', tripId: 'trip-1', loadLineId: 'line-1' }, db)
    await expect(db.loadLines.get('line-1')).resolves.toMatchObject({
      status: 'PENDING',
      qtyLoaded: null,
      checkedByName: null,
    })
  })

  it('a re-check resolves the flag and passes the line', async () => {
    const { clientUuid } = await enqueue(
      { kind: 'loader', type: 'LOAD_FLAG_RAISED', tripId: 'trip-1', loadLineId: 'line-1', reason: 'DAMAGED', qtyAffected: 2 },
      db,
    )
    await enqueue({ kind: 'loader', type: 'LOAD_RECHECKED', tripId: 'trip-1', loadFlagId: clientUuid, qtyLoaded: 12, checkedByName: 'Harini' }, db)
    await expect(db.loadFlags.get(clientUuid)).resolves.toMatchObject({ status: 'RESOLVED' })
    await expect(db.loadLines.get('line-1')).resolves.toMatchObject({ status: 'OK', qtyLoaded: 12 })
  })

  it('maps each driver event onto the status the server will set', async () => {
    await enqueue({ kind: 'driver', type: 'TRIP_STARTED', tripId: 'trip-1' }, db)
    await expect(db.trips.get('trip-1')).resolves.toMatchObject({ status: 'IN_PROGRESS' })

    await enqueue({ kind: 'driver', type: 'ARRIVED', tripId: 'trip-1', stopId: 'stop-8' }, db)
    await expect(db.stops.get('stop-8')).resolves.toMatchObject({ status: 'ARRIVED' })

    await enqueue({ kind: 'driver', type: 'PARTIAL', tripId: 'trip-1', stopId: 'stop-8', outcome: 'PARTIAL' }, db)
    await expect(db.stops.get('stop-8')).resolves.toMatchObject({ status: 'PARTIAL' })
  })

  it('leaves the cache alone for an event that only the server projects', async () => {
    const before = await db.stops.get('stop-8')
    await enqueue({ kind: 'driver', type: 'ISSUE_REPORTED', tripId: 'trip-1', stopId: 'stop-8', note: 'Short by two' }, db)
    await expect(db.stops.get('stop-8')).resolves.toEqual(before)
    await expect(pendingCount(db)).resolves.toBe(1)
  })
})

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompassDb, META_KEYS, setSyncPoke, uuidv7 } from '@/offline'
import { downloadBundle, lastBundleAt, saveBundle, toCachedStops } from '../trip-bundle'
import { aBundle, STOP_IDS, TRIP_ID } from './fixtures'

let db: CompassDb

beforeEach(async () => {
  setSyncPoke(() => {})
  db = new CompassDb(`test-${uuidv7()}`)
  await db.open()
})

describe('the offline bundle, written into Dexie', () => {
  it('AC-EXE-04 saves the trip, its stops and their lines so the phone needs no signal', async () => {
    const result = await saveBundle(aBundle(), db, new Date('2026-10-02T03:05:00+05:30'))

    expect(result).toMatchObject({ tripId: TRIP_ID, version: 3, stops: 6 })
    await expect(db.trips.get(TRIP_ID)).resolves.toMatchObject({
      tripRef: 'REF-07 · Trip 1',
      vehicleCode: 'REF-07',
      status: 'RELEASED',
      tempClass: 'CHILLED',
      planDate: '2026-10-02',
      stopCount: 6,
      bundleVersion: 3,
    })

    const stops = await db.stops.where('tripId').equals(TRIP_ID).sortBy('sequence')
    expect(stops.map((s) => s.outletName)).toEqual([
      'Fresh Kadawatha',
      'Fresh Ja-Ela',
      'Fresh Seeduwa',
      'Fresh Negombo Road',
      'Fresh Katunayake',
      'Fresh Minuwangoda',
    ])
    expect(stops[0]).toMatchObject({
      windowStart: '06:00',
      windowEnd: '08:00',
      district: 'gampaha',
      contactPhone: '+94711234567',
      // The bundle versions itself whole, so this is the version a stop event sends as baseVersion.
      version: 3,
    })
    // Access notes ride along, which is what D9 shows with the network off.
    expect(stops[0]?.accessNote).toContain('Rear dock off Kandy Road')

    await expect(db.stopLines.where('stopId').equals(STOP_IDS[0]).count()).resolves.toBe(3)
    await expect(db.stopLines.count()).resolves.toBe(18)
    await expect(lastBundleAt(db)).resolves.toEqual(new Date('2026-10-02T03:05:00+05:30'))
  })

  it('AC-EXE-04 records the bundle version through the outbox, never straight to the API', async () => {
    const fetchBundle = vi.fn(async () => ({ data: aBundle() }))
    await downloadBundle(TRIP_ID, { database: db, fetchBundle })

    const queued = await db.outbox.toArray()
    expect(queued).toHaveLength(1)
    expect(queued[0]?.event).toMatchObject({
      kind: 'driver',
      type: 'TRIP_DOWNLOADED',
      tripId: TRIP_ID,
      baseVersion: 3,
    })
    expect(queued[0]?.clientUuid).toMatch(/-7[0-9a-f]{3}-/)
    expect(queued[0]?.status).toBe('pending')
  })

  it('a re-download after a revision leaves no ghost stop or line behind', async () => {
    await saveBundle(aBundle(), db)

    const revised = aBundle({ version: 4 })
    revised.stops = revised.stops.slice(0, 4)
    await saveBundle(revised, db)

    const stops = await db.stops.where('tripId').equals(TRIP_ID).toArray()
    expect(stops).toHaveLength(4)
    await expect(db.stopLines.count()).resolves.toBe(12)
    await expect(db.stopLines.where('stopId').equals(STOP_IDS[5]).count()).resolves.toBe(0)
    await expect(db.trips.get(TRIP_ID)).resolves.toMatchObject({ stopCount: 4, bundleVersion: 4 })
  })

  it('AC-EXE-05 a failed download keeps the bundle the phone already holds', async () => {
    await saveBundle(aBundle(), db, new Date('2026-10-02T03:05:00+05:30'))
    const fetchBundle = vi.fn(async () => {
      throw new Error('offline')
    })

    await expect(
      downloadBundle(TRIP_ID, { database: db, fetchBundle, now: () => new Date('2026-10-02T04:31:00+05:30') }),
    ).rejects.toThrow('offline')

    // Nothing moved: the 03:05 bundle is still there, and no TRIP_DOWNLOADED was queued for 04:31.
    await expect(db.trips.get(TRIP_ID)).resolves.toMatchObject({ bundleVersion: 3 })
    await expect(db.stops.where('tripId').equals(TRIP_ID).count()).resolves.toBe(6)
    await expect(db.outbox.count()).resolves.toBe(0)
    await expect(lastBundleAt(db)).resolves.toEqual(new Date('2026-10-02T03:05:00+05:30'))
  })

  it('sorts an unsequenced stop last, so the list never opens on it', async () => {
    const bundle = aBundle()
    bundle.stops[0]!.seq = null
    const stops = toCachedStops(bundle)
    expect(stops[0]?.sequence).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('has no last-download time before the first download', async () => {
    await expect(lastBundleAt(db)).resolves.toBeNull()
    await expect(db.meta.get(META_KEYS.lastBundleAt)).resolves.toBeUndefined()
  })
})

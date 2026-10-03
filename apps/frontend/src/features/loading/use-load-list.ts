import { useTripLoadingLoadList, type LoadFlagDto, type LoadLineDto, type LoadListDto, type LoadStopDto } from '@compass/api-client'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo } from 'react'
import { db, useCachedLoadFlags, useCachedLoadLines, type CachedLoadFlag, type CachedLoadLine, type OutboxRow } from '@/offline'

/**
 * L2's data. The shape, the copy and every action come from `GET /trips/{id}/load-list`; what the
 * loader has tapped since comes from Dexie, which `enqueue` moves the moment a tick is queued.
 *
 * The two are merged rather than chosen between, because the dock's wifi drops behind a reefer
 * truck and the tick must still be on screen when it does: the server owns the list, the device
 * owns what has happened to it in the last few seconds.
 */
export interface LoadLineView extends LoadLineDto {
  /** True while this line's tap is still in the outbox. */
  queued: boolean
}

export interface LoadStopView extends Omit<LoadStopDto, 'lines'> {
  lines: LoadLineView[]
}

const isLoaderRow = (row: OutboxRow): boolean => row.event.kind === 'loader'

/** The ids a queued tap is holding: the server's copy of these must not overwrite the screen. */
const heldIds = (rows: readonly OutboxRow[]): Set<string> => {
  const held = new Set<string>()
  for (const row of rows) {
    if (row.event.kind !== 'loader') continue
    if (row.event.loadLineId) held.add(row.event.loadLineId)
    if (row.event.loadFlagId) held.add(row.event.loadFlagId)
  }
  return held
}

/** Loader taps still on their way to the server, oldest first. */
export const usePendingLoaderEvents = (tripId: string | undefined): OutboxRow[] =>
  useLiveQuery(
    async () => {
      if (!tripId) return []
      const rows = await db.outbox.where('status').anyOf('pending', 'sending').toArray()
      return rows.filter((row) => isLoaderRow(row) && row.event.tripId === tripId)
    },
    [tripId],
    [],
  ) ?? []

/**
 * Mirror the server's list into Dexie so the optimistic reducer has rows to move and the tablet
 * keeps the list when the signal goes. A line or flag a queued tap is holding is left alone: the
 * server has not heard about that tap yet, and writing its older answer over the top would make
 * the tick blink off under the loader's hand.
 */
export async function cacheLoadList(list: LoadListDto): Promise<void> {
  const pending = await db.outbox.where('status').anyOf('pending', 'sending').toArray()
  const held = heldIds(pending)

  const lines: CachedLoadLine[] = []
  const flags: CachedLoadFlag[] = []
  let loadSequence = 0
  for (const stop of list.stops) {
    for (const line of stop.lines) {
      // The load list's stop group is one order, so the order's id is the group key here; the dock
      // never joins these rows to the driver's `stops` table.
      lines.push({
        id: line.id,
        tripId: line.tripId,
        stopId: stop.orderId,
        loadSequence: loadSequence++,
        itemName: line.itemName ?? line.sku ?? stop.orderNo,
        qtyPlanned: line.qtyExpected,
        qtyLoaded: line.qtyLoaded ?? null,
        status: line.status,
        tempClass: null,
        fragile: false,
        checkedByName: line.checkedByName ?? null,
        version: list.listRevision,
      })
      for (const flag of line.flags) {
        flags.push({
          id: flag.id,
          tripId: flag.tripId,
          loadLineId: flag.loadLineId,
          status: flag.status,
          reason: flag.reason,
          qtyAffected: flag.qtyAffected,
          note: flag.note ?? null,
          decision: flag.decision ?? null,
          decisionNote: flag.decisionNote ?? null,
          raisedByName: flag.raisedByName,
          version: list.listRevision,
        })
      }
    }
  }

  const serverFlagLines = new Set(flags.map((flag) => flag.loadLineId))
  await db.transaction('rw', [db.trips, db.loadLines, db.loadFlags], async () => {
    await db.loadLines.bulkPut(lines.filter((line) => !held.has(line.id)))
    await db.loadFlags.bulkPut(flags.filter((flag) => !held.has(flag.id)))
    // A flag raised on this tablet is keyed by its tap's clientUuid until it syncs; once the server
    // answers with its own row for that line, the local stand-in is dropped rather than shown twice.
    const local = await db.loadFlags.where('tripId').equals(list.trip.id).toArray()
    const stale = local
      .filter((flag) => !held.has(flag.id) && serverFlagLines.has(flag.loadLineId) && !flags.some((server) => server.id === flag.id))
      .map((flag) => flag.id)
    if (stale.length > 0) await db.loadFlags.bulkDelete(stale)
  })
}

const overlayLine = (line: LoadLineDto, cached: CachedLoadLine | undefined, queued: boolean, localFlags: readonly CachedLoadFlag[]): LoadLineView => {
  const flags: LoadFlagDto[] =
    line.flags.length > 0
      ? line.flags
      : localFlags.map((flag) => ({
          id: flag.id,
          tripId: flag.tripId,
          loadLineId: flag.loadLineId,
          reason: flag.reason as LoadFlagDto['reason'],
          qtyAffected: flag.qtyAffected,
          note: flag.note,
          status: flag.status,
          decision: (flag.decision ?? undefined) as LoadFlagDto['decision'],
          decisionNote: flag.decisionNote,
          raisedByName: flag.raisedByName ?? '',
          raisedAt: '',
          // A flag that has not reached the server carries no link: there is nothing to undo on a
          // row the server has never seen, and L3a's Undo works off the queue instead.
          _links: {},
        }))
  if (!cached) return { ...line, flags, queued }
  return {
    ...line,
    status: cached.status,
    qtyLoaded: cached.qtyLoaded,
    checkedByName: cached.checkedByName,
    flags,
    queued,
  }
}

export interface LoadListState {
  list: LoadListDto | undefined
  stops: LoadStopView[]
  /** Lines settled against lines on the list, after the device's own taps. */
  checked: number
  total: number
  isPending: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

export function useLoadList(tripId: string | undefined): LoadListState {
  const query = useTripLoadingLoadList(tripId ?? '', { query: { enabled: Boolean(tripId) } })
  const list = query.data?.data
  const cachedLines = useCachedLoadLines(tripId)
  const cachedFlags = useCachedLoadFlags(tripId)
  const pending = usePendingLoaderEvents(tripId)

  useEffect(() => {
    if (list) void cacheLoadList(list)
  }, [list])

  const stops = useMemo<LoadStopView[]>(() => {
    if (!list) return []
    const byId = new Map(cachedLines.map((line) => [line.id, line]))
    const queued = heldIds(pending)
    return list.stops.map((stop) => ({
      ...stop,
      lines: stop.lines.map((line) =>
        overlayLine(
          line,
          byId.get(line.id),
          queued.has(line.id),
          cachedFlags.filter((flag) => flag.loadLineId === line.id),
        ),
      ),
    }))
  }, [list, cachedLines, cachedFlags, pending])

  const all = stops.flatMap((stop) => stop.lines)
  return {
    list,
    stops,
    checked: all.filter((line) => line.status === 'OK' || line.status === 'REPLACED' || line.status === 'REMOVED').length,
    total: all.length,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}

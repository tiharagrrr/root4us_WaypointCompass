import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, META_KEYS } from './db'
import { conflictCount, pendingCount } from './outbox'

/**
 * Everything the offline banner needs: D6 shows "3 records waiting to send", and the dock shows the
 * same count on L2. Reads live, so it moves the moment a tap is queued or a batch drains.
 */
export interface OfflineStatus {
  online: boolean
  pending: number
  conflicts: number
  /** A 401 paused sync: the records are safe and wait for the same person to sign back in. */
  paused: boolean
  lastSyncAt: Date | null
}

export const useOfflineStatus = (): OfflineStatus => {
  const online = useOnline()
  const pending = useLiveQuery(() => pendingCount(), [], 0)
  const conflicts = useLiveQuery(() => conflictCount(), [], 0)
  const paused = useLiveQuery(() => db.meta.get(META_KEYS.syncPaused), [], undefined)
  const lastSync = useLiveQuery(() => db.meta.get(META_KEYS.lastSyncAt), [], undefined)
  return {
    online,
    pending: pending ?? 0,
    conflicts: conflicts ?? 0,
    paused: paused?.value === 1,
    lastSyncAt: typeof lastSync?.value === 'string' ? new Date(lastSync.value) : null,
  }
}

/** navigator.onLine, as a hook. False is reliable; true only means a network, not a reachable API. */
export const useOnline = (): boolean => {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** The trip the driver is running, or the dock tablet is loading, read from Dexie. */
export const useCachedTrip = (tripId: string | undefined) =>
  useLiveQuery(() => (tripId ? db.trips.get(tripId) : undefined), [tripId], undefined)

/** A trip's stops in delivery order (D1, D3). */
export const useCachedStops = (tripId: string | undefined) =>
  useLiveQuery(
    () => (tripId ? db.stops.where('tripId').equals(tripId).sortBy('sequence') : []),
    [tripId],
    [],
  )

/** A trip's load lines in loading order: last stop first (L2). */
export const useCachedLoadLines = (tripId: string | undefined) =>
  useLiveQuery(
    () => (tripId ? db.loadLines.where('tripId').equals(tripId).sortBy('loadSequence') : []),
    [tripId],
    [],
  )

export const useCachedLoadFlags = (tripId: string | undefined) =>
  useLiveQuery(
    () => (tripId ? db.loadFlags.where('tripId').equals(tripId).toArray() : []),
    [tripId],
    [],
  )

/** The name typed on a shared dock tablet, remembered between taps (AC-LOD-03). */
export const useCheckedByName = (): [string | null, (name: string | null) => Promise<void>] => {
  const row = useLiveQuery(() => db.meta.get(META_KEYS.checkedByName), [], undefined)
  /** null clears it, so each item is signed on its own again. */
  const set = async (name: string | null) => {
    if (name === null) await db.meta.delete(META_KEYS.checkedByName)
    else await db.meta.put({ key: META_KEYS.checkedByName, value: name })
  }
  return [typeof row?.value === 'string' ? row.value : null, set]
}

/** The depot's loader roster from A6, kept on the tablet so Checked by works offline (AC-LOD-20). */
export const useDockLoaders = (): [string[], (names: readonly string[]) => Promise<void>] => {
  const row = useLiveQuery(() => db.meta.get(META_KEYS.dockLoaders), [], undefined)
  const set = async (names: readonly string[]) => {
    await db.meta.put({ key: META_KEYS.dockLoaders, value: JSON.stringify(names) })
  }
  return [parseNames(row?.value), set]
}

const parseNames = (value: unknown): string[] => {
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

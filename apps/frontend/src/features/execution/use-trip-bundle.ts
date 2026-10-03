import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, META_KEYS } from '@/offline'
import { downloadBundle } from './trip-bundle'

export type BundleState = 'idle' | 'downloading' | 'saved' | 'failed'

export interface TripBundle {
  state: BundleState
  error: unknown
  /** When this phone last saved any bundle, for D2's last successful download time. */
  lastBundleAt: Date | null
  retry: () => void
}

/**
 * Keep this phone's copy of the trip current, and say how that is going.
 *
 * It downloads when the trip changes and when the server's version is ahead of the one on the
 * phone, and never otherwise: a driver on the road reads Dexie and must not be made to wait on a
 * network that is not there. A failure leaves the saved bundle alone and shows D2 (AC-EXE-05).
 */
export function useTripBundle(tripId: string | undefined, serverVersion: number | undefined): TripBundle {
  const [state, setState] = useState<BundleState>('idle')
  const [error, setError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  const running = useRef(false)

  const cached = useLiveQuery(() => (tripId ? db.trips.get(tripId) : undefined), [tripId], undefined)
  const lastSaved = useLiveQuery(() => db.meta.get(META_KEYS.lastBundleAt), [], undefined)

  const held = cached?.bundleVersion
  const stale = held === undefined || (serverVersion !== undefined && serverVersion > held)

  useEffect(() => {
    if (!tripId || !stale || running.current) return
    running.current = true
    setState('downloading')
    setError(null)
    downloadBundle(tripId)
      .then(() => {
        setState('saved')
      })
      .catch((cause: unknown) => {
        setError(cause)
        setState('failed')
      })
      .finally(() => {
        running.current = false
      })
  }, [tripId, stale, attempt])

  // Nothing to fetch and a bundle already on the phone: it is saved, whatever the network is doing.
  const settled: BundleState = state === 'idle' && held !== undefined ? 'saved' : state

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    state: settled,
    error,
    lastBundleAt: typeof lastSaved?.value === 'string' ? new Date(lastSaved.value) : null,
    retry,
  }
}

import { useEffect } from 'react'
import { SyncEngine } from './sync-engine'

/** One engine per tab: the outbox is one queue, so two flushers would send the same batch twice. */
export const syncEngine = new SyncEngine()

/** specs/sync/spec.md: while anything is pending the engine also tries on its own every 30 seconds. */
export const PENDING_POLL_MS = 30_000

/**
 * Starts the sync engine while a driver or dock shell is on screen (specs/sync/spec.md, Triggers):
 * once at mount, on the `online` event, on return to the foreground and every 30 seconds. A tap
 * pokes it too, through the outbox. `signedIn` is true once the session answers: a 401 paused the
 * engine, and the same person signing back in is what resumes it, so nothing queued was dropped.
 */
export const useSyncEngine = (signedIn: boolean): void => {
  useEffect(() => {
    syncEngine.start()
    const kick = () => void syncEngine.flush()
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick()
    }
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(kick, PENDING_POLL_MS)
    return () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
      syncEngine.stop()
    }
  }, [])

  useEffect(() => {
    if (signedIn) syncEngine.resume()
  }, [signedIn])
}

import { useEffect } from 'react'
import { SyncEngine } from './sync-engine'

/** One engine per tab: the outbox is one queue, so two flushers would send the same batch twice. */
export const syncEngine = new SyncEngine()

/** specs/sync/spec.md: while anything is pending the engine also tries on its own every 30 seconds. */
export const PENDING_POLL_MS = 30_000

/**
 * Starts the sync engine while a driver or dock shell is on screen (specs/sync/spec.md, Triggers):
 * once at mount, on the `online` event, on return to the foreground and every 30 seconds. A tap
 * pokes it too, through the outbox. Every tap is already safe in Dexie the moment it is made
 * (architecture rule 10); this is what sends it.
 *
 * `signedIn` is true once the session answers: a 401 paused the engine, and the same person signing
 * back in is what resumes it, so nothing queued was dropped. `engine` is a parameter so a test can
 * hand in one wired to a throwaway database.
 */
export function useSyncEngine(signedIn = true, engine: SyncEngine = syncEngine): void {
  useEffect(() => {
    engine.start()
    const kick = () => void engine.flush()
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
      engine.stop()
    }
  }, [engine])

  useEffect(() => {
    if (signedIn) engine.resume()
  }, [signedIn, engine])
}

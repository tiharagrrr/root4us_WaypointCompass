import { serverClock } from '@compass/api-client'
import { useCallback, useSyncExternalStore } from 'react'

export interface ServerClockState {
  /** Server time now: the local clock plus the offset from the last envelope's meta.serverTime. */
  now: Date
  /** Server minus local, in ms. Hours or days when the demo clock is shifted. */
  offsetMs: number
  /** False until a response has carried meta.serverTime. */
  synced: boolean
}

/**
 * The server's clock for display and time rules on the web. compassFetch aligns it to
 * meta.serverTime on every response; this re-renders every tickMs.
 */
export const useServerClock = (tickMs = 1000): ServerClockState => {
  const { offsetMs, serverTime } = useSyncExternalStore(serverClock.subscribe, serverClock.getSnapshot)
  const subscribeTick = useCallback(
    (onTick: () => void) => {
      const id = setInterval(onTick, tickMs)
      return () => clearInterval(id)
    },
    [tickMs],
  )
  const tick = useSyncExternalStore(subscribeTick, () => Math.floor(Date.now() / tickMs) * tickMs)
  return { now: new Date(tick + offsetMs), offsetMs, synced: serverTime !== null }
}

/** Server time now, for event handlers and other code outside render. */
export const serverNow = (): Date => new Date(serverClock.now())

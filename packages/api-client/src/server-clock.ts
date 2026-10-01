/**
 * The server's clock, as seen in meta.serverTime of the last envelope. compassFetch feeds it;
 * the web app's useServerClock() reads it. In demo mode the server clock can be shifted, so the
 * offset may be hours, not milliseconds.
 */
export interface ServerClockSnapshot {
  /** serverTime minus the local clock when the response arrived, in ms. */
  offsetMs: number;
  /** The last meta.serverTime seen, or null before the first response. */
  serverTime: string | null;
  /** Local epoch ms when it was seen. */
  syncedAt: number | null;
}

type Listener = () => void;

const INITIAL: ServerClockSnapshot = { offsetMs: 0, serverTime: null, syncedAt: null };
/** Offsets that move less than this are network jitter and do not notify. */
const JITTER_MS = 1000;

let snapshot: ServerClockSnapshot = INITIAL;
const listeners = new Set<Listener>();

export const serverClock = {
  getSnapshot: (): ServerClockSnapshot => snapshot,
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Server time now, in epoch ms. */
  now: (): number => Date.now() + snapshot.offsetMs,
};

export const syncServerClock = (serverTime: unknown, receivedAt: number = Date.now()): void => {
  if (typeof serverTime !== 'string') return;
  const instant = Date.parse(serverTime);
  if (Number.isNaN(instant)) return;
  const offsetMs = instant - receivedAt;
  if (snapshot.serverTime !== null && Math.abs(offsetMs - snapshot.offsetMs) < JITTER_MS) return;
  snapshot = { offsetMs, serverTime, syncedAt: receivedAt };
  for (const listener of listeners) listener();
};

/** Tests only: forget the last sync. */
export const resetServerClock = (): void => {
  snapshot = INITIAL;
  for (const listener of listeners) listener();
};

import { useEffect } from 'react'

/** One frame of GET /streams/me: the DomainEvent JSON the outbox published (specs/realtime/spec.md). */
export interface DomainEvent {
  /** Payload version; a consumer ignores what it does not understand. */
  v: number
  /** `<entity>.<past-tense verb>`, e.g. order.submitted. */
  type: string
  aggregate: { type: string; id: string }
  routing: { depotId?: string | null; outletIds?: string[]; userIds?: string[] }
  data: Record<string, unknown>
  occurredAt: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Narrows a parsed frame; anything that is not a domain event is dropped rather than thrown. */
export const isDomainEvent = (value: unknown): value is DomainEvent =>
  isRecord(value) && typeof value.type === 'string' && isRecord(value.aggregate) && isRecord(value.routing)

type Listener = (event: DomainEvent) => void

const listeners = new Set<Listener>()

/**
 * Every live event, for the parts of the UI that react to one rather than refetch: toasts, the
 * dock's "Plan updated" notice, the driver's banner. useEventStream() feeds it.
 */
export const eventBus = {
  emit(event: DomainEvent): void {
    for (const listener of [...listeners]) listener(event)
  },
  on(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Runs the handler for each live event of these types while the component is mounted. */
export function useDomainEvent(types: readonly string[], handler: (event: DomainEvent) => void): void {
  useEffect(() => {
    return eventBus.on((event) => {
      if (types.includes(event.type)) handler(event)
    })
    // The caller keeps the handler stable, or accepts a resubscribe per render.
  }, [types, handler])
}

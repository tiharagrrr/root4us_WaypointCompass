/**
 * What the kernel needs from the audit trail (ROO-23, AuditService in
 * modules/audit) and the outbox (ROO-24, OutboxService). core/ imports no
 * module, so SimpleCrudCommands takes these interfaces and a subclass passes
 * the real services in. Both must run inside the use case's transaction.
 */

export interface AuditEntry {
  /** '<module>.<entity>.<past-tense verb>', e.g. 'fleet.vehicle.updated'. */
  action: string;
  entity: [type: string, id: string];
  before?: unknown;
  after?: unknown;
  reasonCode?: string;
  reasonNote?: string;
  /** For events synced from a device; defaults to ClockService.now(). */
  occurredAt?: Date;
  clientUuid?: string;
}

export interface AuditRecorder {
  record(entry: AuditEntry): Promise<unknown>;
}

/** Which SSE channels and notification recipients an event reaches. */
export interface EventRouting {
  aggregate: [type: string, id: string];
  depotId?: string | null;
  outletIds?: string[];
  userIds?: string[];
}

/** A versioned payload with ids and the few fields consumers need. */
export type EventPayload = { v: number } & Record<string, unknown>;

export interface OutboxWriter {
  add(
    type: string,
    data: EventPayload,
    routing: EventRouting,
  ): Promise<unknown>;
}

import { Injectable } from '@nestjs/common';

/** The Redis channel every relayed event is published on, for the SSE gateway (ROO-25). */
export const EVENTS_CHANNEL = 'waypoint:events';

/** One outbox row as a consumer receives it; `id` is the dedupe key. */
export interface DeliveredEvent {
  id: string;
  type: string;
  depotId: string | null;
  outletIds: string[];
  userIds: string[];
  payload: unknown;
  occurredAt: Date;
  correlationId: string | null;
}

/**
 * Something in this process that reacts to domain events: a module's
 * listener, registered when the module starts. `handle` runs inside the
 * relay's transaction for that one event, so whatever it writes commits
 * together with the event being marked published. Delivery is at least once:
 * a consumer dedupes on `event.id`.
 */
export interface EventConsumer {
  readonly name: string;
  consumes(type: string): boolean;
  handle(event: DeliveredEvent): Promise<unknown>;
}

/**
 * Who consumes which event types. Modules register here (core imports no
 * module); the outbox relay asks it whom to deliver each row to.
 *
 *   onModuleInit() {
 *     this.bus.register({ name: 'loading', consumes: ..., handle: (e) => this.builder.handle(e) });
 *   }
 */
@Injectable()
export class EventBus {
  private readonly consumers: EventConsumer[] = [];

  register(consumer: EventConsumer): void {
    if (this.consumers.some((c) => c.name === consumer.name))
      throw new Error(
        `An event consumer named ${consumer.name} is already registered`,
      );
    this.consumers.push(consumer);
  }

  /** The consumers of an event type, in registration order. */
  consumersOf(type: string): EventConsumer[] {
    return this.consumers.filter((c) => c.consumes(type));
  }
}

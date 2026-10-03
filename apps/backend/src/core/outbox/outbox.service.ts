import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { ClockService } from '../clock/clock.service';
import { RequestContext } from '../context/request-context';
import type {
  EventPayload,
  EventRouting,
  OutboxWriter,
} from '../persistence/ports';
import type { StampedDrizzleAdapter } from '../persistence/transactions';
import { outboxEvents } from '../../db/schema';

/**
 * Writes a domain event into outbox_events inside the use case's
 * transaction, so the event exists exactly when the change does. The
 * worker's `OutboxRelay` delivers each row after commit to the consumers that
 * registered on the `EventBus`, then publishes it on Redis for SSE.
 */
@Injectable()
export class OutboxService implements OutboxWriter {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly context: RequestContext,
  ) {}

  async add(
    type: string,
    data: EventPayload,
    routing: EventRouting,
  ): Promise<{ id: string }> {
    if (!this.txHost.isTransactionActive())
      throw new Error('outbox.add() must run inside a transaction');
    const [aggregateType, aggregateId] = routing.aggregate;
    const [row] = await this.txHost.tx
      .insert(outboxEvents)
      .values({
        type,
        aggregateType,
        aggregateId,
        depotId: routing.depotId ?? null,
        outletIds: routing.outletIds ?? [],
        userIds: routing.userIds ?? [],
        payload: data,
        correlationId: this.context.correlationId ?? null,
        occurredAt: this.clock.now(),
      })
      .returning({ id: outboxEvents.id });
    return row;
  }
}

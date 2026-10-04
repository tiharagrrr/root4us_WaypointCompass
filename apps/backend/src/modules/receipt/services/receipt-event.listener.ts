import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import { RECEIPT_CONSUMES } from '../receipt.constants';
import { ReceiptService } from './receipt.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one event receipt reacts to: `stop.completed`, from execution. When the driver's
 * DELIVERED or PARTIAL record finally syncs, a receipt the store confirmed early stops
 * waiting and its order moves on (AC-RCP-03). Nothing is stored for a receipt that was not
 * confirmed early: M5 opens from the order's status, so there is nothing to "open".
 *
 * The relay delivers at least once. Reconciling is idempotent by state, because a replay
 * finds no receipt still waiting, so it needs no dedupe table of its own.
 */
@Injectable()
export class ReceiptEventListener {
  constructor(
    private readonly receipts: ReceiptService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(ReceiptEventListener.name);
  }

  static consumes(type: string): boolean {
    return type === RECEIPT_CONSUMES.stopCompleted;
  }

  async handle(event: DeliveredEvent): Promise<boolean> {
    if (!ReceiptEventListener.consumes(event.type)) return false;
    const orderId = (event.payload as { orderId?: unknown } | null)?.orderId;
    if (typeof orderId !== 'string' || !UUID.test(orderId)) {
      this.log.warn(
        { eventId: event.id, type: event.type },
        'stop.completed without a usable orderId',
      );
      return false;
    }
    return this.receipts.reconcile(orderId);
  }
}

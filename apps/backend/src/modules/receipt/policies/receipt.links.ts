import { Injectable } from '@nestjs/common';
import { type Actor, can } from '@waypoint/shared';
import { ClockService } from '../../../core/clock/clock.service';
import { LinkBuilder, type LinkMap } from '../../../core/http/links';
import type { ReceiptDto } from '../dto/receipt.dto';
import type { ReceiptView } from '../services/receipt.queries';

/** The order statuses from which a store can report a problem: it has reached the store. */
const REPORTABLE = new Set(['DELIVERED', 'PARTIAL', 'RECEIVED']);

/** An order's receipt.`confirm` appears only while the store can still confirm it. */
@Injectable()
export class ReceiptLinks extends LinkBuilder<ReceiptView, ReceiptDto> {
  constructor(protected readonly clock: ClockService) {
    super();
  }

  protected self(r: ReceiptView) {
    return `/api/v1/orders/${r.orderId}/receipt`;
  }

  protected actions(r: ReceiptView, actor: Actor): LinkMap {
    return {
      order: { href: `/api/v1/orders/${r.orderId}` },
      confirm: r.mode !== null &&
        can(actor, 'receipt:confirm') && {
          href: this.self(r),
          method: 'POST',
          title: 'Confirm receipt',
          requires: ['If-Match', 'Idempotency-Key'],
        },
      // A problem can be reported once the order has reached the store.
      reportIssue: REPORTABLE.has(r.orderStatus) &&
        can(actor, 'issue:create') && {
          href: '/api/v1/issues',
          method: 'POST',
          title: 'Report an issue',
          requires: ['If-Match', 'Idempotency-Key'],
        },
    };
  }

  protected present(r: ReceiptView): ReceiptDto {
    return {
      id: r.id,
      orderId: r.orderId,
      orderNo: r.orderNo,
      receiptId: r.receiptId,
      status: r.status,
      orderStatus: r.orderStatus,
      stopStatus: r.stopStatus,
      etaAt: r.etaAt,
      awaitingDriverSync: r.awaitingDriverSync,
      note: r.note,
      confirmedAt: r.confirmedAt,
      confirmedById: r.confirmedById,
      version: r.version,
      lines: r.lines,
      proof: r.proof,
      issueIds: r.issueIds,
      _links: {},
    };
  }
}

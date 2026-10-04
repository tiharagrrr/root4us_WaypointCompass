import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { Actor, ReceiptStatus } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  type FieldError,
  StateConflictError,
  ValidationError,
  VersionMismatchError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { issues, receiptLines, receipts } from '../../../db/schema';
import { AuditService } from '../../audit';
import { OrderLifecycleService, OrderQueries } from '../../ordering';
import {
  baselineOf,
  coversEveryLine,
  type ExpectedLine,
  findDiscrepancies,
} from '../domain/discrepancies';
import type { ConfirmReceiptDto } from '../dto/receipt.dto';
import type {
  IssueReportedEvent,
  ReceiptConfirmedEvent,
} from '../events/receipt.events';
import {
  CONFIRMABLE_STATUSES,
  RECEIPT_AUDIT,
  RECEIPT_EVENTS,
  RECEIPT_LOGS,
} from '../receipt.constants';
import { DeliveryReadModel } from './delivery.read-model';
import { ReceiptQueries, type ReceiptView } from './receipt.queries';

const invalid = (errors: FieldError[]) => new ValidationError(errors);

/**
 * Confirming a receipt (M5): the store says what arrived, the module compares it with what
 * the driver delivered, opens an issue for each line that is wrong and moves the order to
 * RECEIVED or ISSUE_REPORTED through OrderLifecycleService, the one way an order's status
 * moves (architecture rule 2). The receipt, its lines, its issues, their audit rows and
 * their outbox events are one transaction (architecture rule 4).
 *
 * A store may confirm before the driver's record has synced, once the ETA has passed
 * (AC-RCP-03). That receipt is stored with `awaitingDriverSync` and the order stays
 * IN_TRANSIT, because the order has no IN_TRANSIT to RECEIVED move; `reconcile` finishes the
 * job when `stop.completed` arrives.
 */
@Injectable()
export class ReceiptService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly queries: ReceiptQueries,
    private readonly orders: OrderQueries,
    private readonly delivery: DeliveryReadModel,
    private readonly lifecycle: OrderLifecycleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: ClockService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(ReceiptService.name);
  }

  @Transactional()
  async confirm(
    orderId: string,
    dto: ConfirmReceiptDto,
    actor: Actor,
    version: number,
  ): Promise<ReceiptView> {
    const order = await this.orders.getWithLines(orderId, actor);
    const before = await this.queries.build(order);
    if (before.version !== version) throw new VersionMismatchError('order');
    if (before.mode === null) throw this.refusalFor(before);

    const expected = this.expectedLines(before);
    this.checkLines(expected, dto);
    const discrepancies = findDiscrepancies(
      expected,
      dto.lines,
      dto.note ?? null,
    );
    const early = before.mode === 'EARLY';
    const status: ReceiptStatus = discrepancies.length
      ? 'CONFIRMED_WITH_ISSUES'
      : 'CONFIRMED';
    const stop = await this.delivery.stopOfOrder(order);

    const [receipt] = await this.txHost.tx
      .insert(receipts)
      .values({
        orderId,
        stopId: stop?.id ?? null,
        status,
        note: dto.note ?? null,
        confirmedById: actor.id,
        confirmedAt: this.clock.now(),
        awaitingDriverSync: early,
      })
      .returning();
    await this.txHost.tx.insert(receiptLines).values(
      dto.lines.map((line) => ({
        receiptId: receipt.id,
        orderLineId: line.orderLineId,
        qtyReceived: line.qtyReceived,
        condition: line.condition,
      })),
    );

    const raised: IssueReportedEvent[] = [];
    for (const d of discrepancies) {
      const [issue] = await this.txHost.tx
        .insert(issues)
        .values({
          outletId: order.outletId,
          orderId,
          stopId: stop?.id ?? null,
          receiptId: receipt.id,
          orderLineId: d.orderLineId,
          type: d.type,
          qtyAffected: d.qtyAffected,
          description: d.description,
          raisedById: actor.id,
          raisedByRole: actor.role,
          createdAt: this.clock.realNow(),
        })
        .returning();
      await this.audit.record({
        action: RECEIPT_AUDIT.issueReported,
        entity: ['issue', issue.id],
        after: { type: issue.type, qtyAffected: issue.qtyAffected, orderId },
        reasonCode: issue.type,
      });
      const event: IssueReportedEvent = {
        v: 1,
        issueId: issue.id,
        type: issue.type,
        outletId: order.outletId,
        orderId,
        ...(stop && { stopId: stop.id }),
        raisedById: actor.id,
        qtyAffected: issue.qtyAffected,
      };
      await this.outbox.add(RECEIPT_EVENTS.issueReported, event, {
        aggregate: ['issue', issue.id],
        depotId: order.depotId,
        outletIds: [order.outletId],
      });
      raised.push(event);
    }

    // A normal confirmation moves the order; an early one waits for stop.completed.
    if (!early) await this.moveOrder(orderId, status);

    await this.audit.record({
      action: RECEIPT_AUDIT.confirmed,
      entity: ['receipt', receipt.id],
      after: {
        orderId,
        status,
        awaitingDriverSync: early,
        issues: raised.length,
      },
    });
    const confirmed: ReceiptConfirmedEvent = {
      v: 1,
      receiptId: receipt.id,
      orderId,
      outletId: order.outletId,
      status,
      issues: raised.length,
      awaitingDriverSync: early,
    };
    await this.outbox.add(RECEIPT_EVENTS.confirmed, confirmed, {
      aggregate: ['receipt', receipt.id],
      depotId: order.depotId,
      outletIds: [order.outletId],
    });
    this.log.info(
      {
        event: RECEIPT_LOGS.confirmed,
        receiptId: receipt.id,
        orderId,
        status,
        issues: raised.length,
        awaitingDriverSync: early,
      },
      'receipt confirmed',
    );
    return this.queries.forOrder(orderId, actor);
  }

  /**
   * `stop.completed` arrived for an order whose receipt was confirmed early: the driver's
   * record is in, so the receipt stops waiting and the order, which execution has just
   * moved to DELIVERED or PARTIAL, goes on to RECEIVED or ISSUE_REPORTED (AC-RCP-03).
   * A replay finds nothing waiting and does nothing, so the relay's at-least-once
   * delivery is harmless.
   */
  @Transactional()
  async reconcile(orderId: string): Promise<boolean> {
    const receipt = await this.queries.rowOf(orderId);
    if (!receipt?.awaitingDriverSync) return false;
    const order = await this.delivery.orderById(orderId);
    if (
      !order ||
      !(CONFIRMABLE_STATUSES as readonly string[]).includes(order.status)
    )
      return false;

    const stop = await this.delivery.stopOfOrder(order);
    await this.txHost.tx
      .update(receipts)
      .set({ awaitingDriverSync: false, stopId: stop?.id ?? receipt.stopId })
      .where(eq(receipts.id, receipt.id));
    await this.moveOrder(orderId, receipt.status);
    await this.audit.record({
      action: RECEIPT_AUDIT.reconciled,
      entity: ['receipt', receipt.id],
      before: { awaitingDriverSync: true },
      after: { awaitingDriverSync: false, orderId },
    });
    this.log.info(
      { event: RECEIPT_LOGS.reconciled, receiptId: receipt.id, orderId },
      'early receipt reconciled',
    );
    return true;
  }

  private moveOrder(orderId: string, status: ReceiptStatus) {
    return status === 'CONFIRMED_WITH_ISSUES'
      ? this.lifecycle.markIssueReported(orderId)
      : this.lifecycle.markReceived(orderId);
  }

  private expectedLines(view: ReceiptView): ExpectedLine[] {
    return view.lines.map((line) => ({
      orderLineId: line.orderLineId,
      name: line.name,
      qtyExpected: line.qtyExpected,
      qtyDelivered: line.qtyDelivered,
    }));
  }

  private checkLines(expected: ExpectedLine[], dto: ConfirmReceiptDto): void {
    const errors: FieldError[] = [];
    const { missing, unknown, repeated } = coversEveryLine(expected, dto.lines);
    for (const id of missing)
      errors.push({
        field: 'lines',
        code: 'missing',
        message: `Line ${id} is missing: answer for every line of the order.`,
      });
    for (const id of unknown)
      errors.push({
        field: 'lines',
        code: 'unknown',
        message: `Line ${id} is not on this order.`,
      });
    for (const id of repeated)
      errors.push({
        field: 'lines',
        code: 'repeated',
        message: `Line ${id} appears more than once.`,
      });

    const byLine = new Map(expected.map((l) => [l.orderLineId, l]));
    dto.lines.forEach((got, i) => {
      const line = byLine.get(got.orderLineId);
      if (!line) return;
      const most = Math.max(line.qtyExpected, baselineOf(line));
      if (got.qtyReceived > most)
        errors.push({
          field: `lines[${i}].qtyReceived`,
          code: 'max',
          message: `At most ${most} packs of ${line.name} can have arrived.`,
        });
    });
    if (errors.length) throw invalid(errors);
  }

  private refusalFor(view: ReceiptView): StateConflictError {
    if (view.receiptId)
      return new StateConflictError('This order has already been confirmed.');
    if (
      view.orderStatus === 'RECEIVED' ||
      view.orderStatus === 'ISSUE_REPORTED'
    )
      return new StateConflictError('This order has already been received.');
    return new StateConflictError(
      'This order has not been delivered yet: confirm once the driver has delivered it or the ETA has passed.',
    );
  }
}

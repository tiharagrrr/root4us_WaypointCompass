import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { issues, receiptLines, receipts } from '../../../db/schema';
import { type OrderView, OrderQueries } from '../../ordering';
import { type ConfirmMode, confirmMode } from '../domain/confirmable';
import type { ReceiptDto } from '../dto/receipt.dto';
import type { LineCondition } from '../receipt.constants';
import { DeliveryReadModel } from './delivery.read-model';

export type ReceiptRow = typeof receipts.$inferSelect;

/** The receipt as a response, before links decide what the caller may do next. */
export type ReceiptView = Omit<ReceiptDto, '_links'> & {
  /** How the store can confirm now, or null when it cannot. */
  mode: ConfirmMode | null;
};

/**
 * M5's read: the order's lines as expected, as the driver delivered them and as the
 * store confirmed them, with the proof of delivery. A receipt is read through its
 * order, so the order's scope decides who sees it (a store its outlet's, a dispatcher
 * its depot's) and a row outside it answers 404 (AC-RCP-09).
 */
@Injectable()
export class ReceiptQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly orders: OrderQueries,
    private readonly delivery: DeliveryReadModel,
    private readonly clock: ClockService,
  ) {}

  async forOrder(orderId: string, actor: Actor): Promise<ReceiptView> {
    return this.build(await this.orders.getWithLines(orderId, actor));
  }

  /** The receipt row for an order, if the store has confirmed it. */
  async rowOf(orderId: string): Promise<ReceiptRow | undefined> {
    const [row] = await this.txHost.tx
      .select()
      .from(receipts)
      .where(eq(receipts.orderId, orderId));
    return row;
  }

  async build(order: OrderView): Promise<ReceiptView> {
    const receipt = await this.rowOf(order.id);
    const stop = await this.delivery.stopOfOrder(order);
    const delivered = stop
      ? await this.delivery.deliveredQty(stop.id)
      : new Map<string, number>();
    const proof = stop ? await this.delivery.proofOf(stop) : undefined;
    const confirmed = receipt
      ? new Map(
          (
            await this.txHost.tx
              .select()
              .from(receiptLines)
              .where(eq(receiptLines.receiptId, receipt.id))
          ).map((l) => [l.orderLineId, l]),
        )
      : new Map<string, typeof receiptLines.$inferSelect>();
    const issueIds = receipt
      ? (
          await this.txHost.tx
            .select({ id: issues.id })
            .from(issues)
            .where(eq(issues.receiptId, receipt.id))
        ).map((i) => i.id)
      : [];

    const iso = (at: Date | null | undefined) =>
      at ? this.clock.toIso(at) : null;
    const fileOf = (id: string | null) =>
      id ? { id, href: `/api/v1/attachments/${id}` } : null;

    return {
      id: order.id,
      orderId: order.id,
      orderNo: order.orderNo,
      receiptId: receipt?.id ?? null,
      status: receipt?.status ?? 'PENDING',
      orderStatus: order.status,
      stopStatus: stop?.status ?? null,
      etaAt: iso(stop?.etaAt),
      awaitingDriverSync: receipt?.awaitingDriverSync ?? false,
      note: receipt?.note ?? null,
      confirmedAt: iso(receipt?.confirmedAt),
      confirmedById: receipt?.confirmedById ?? null,
      version: order.version,
      lines: (order.lines ?? []).map((line) => {
        const got = confirmed.get(line.id);
        return {
          orderLineId: line.id,
          itemId: line.itemId,
          sku: line.sku,
          name: line.name,
          packLabel: line.packLabel,
          qtyExpected: line.qty,
          qtyDelivered: delivered.get(line.id) ?? null,
          qtyReceived: got?.qtyReceived ?? null,
          condition: (got?.condition as LineCondition | undefined) ?? null,
        };
      }),
      proof: {
        receiverName: proof?.receiverName ?? null,
        deliveredAt: iso(proof?.deliveredAt),
        signature: fileOf(proof?.signatureId ?? null),
        photo: fileOf(proof?.photoId ?? null),
      },
      issueIds,
      mode: confirmMode(
        {
          orderStatus: order.status,
          hasReceipt: Boolean(receipt),
          stopStatus: stop?.status ?? null,
          etaAt: stop?.etaAt ?? null,
        },
        this.clock.now(),
      ),
    };
  }
}

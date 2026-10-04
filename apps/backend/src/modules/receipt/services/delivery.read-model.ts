import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { AttachmentsService } from '../../../core/attachments/attachments.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deliveryLines,
  orderLines,
  orders,
  stops,
  trips,
} from '../../../db/schema';

export type StopRow = typeof stops.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;

/** What the driver left at the dock, as the store sees it on M5. */
export interface ProofOfDelivery {
  receiverName: string | null;
  deliveredAt: Date | null;
  signatureId: string | null;
  photoId: string | null;
}

/**
 * Read-only views of execution's tables: the stop an order was delivered on, the
 * quantities the driver recorded and the proof of delivery. Receipt reads them but
 * never writes them; the stop and its lines belong to execution, which owns the
 * driver's record (architecture rule 2).
 */
@Injectable()
export class DeliveryReadModel {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly attachments: AttachmentsService,
  ) {}

  /** The order's live stop: the one it is on now, or the last one it had. */
  async stopOfOrder(order: {
    id: string;
    activeStopId: string | null;
  }): Promise<StopRow | undefined> {
    if (order.activeStopId) {
      const [active] = await this.txHost.tx
        .select()
        .from(stops)
        .where(eq(stops.id, order.activeStopId));
      if (active) return active;
    }
    const [latest] = await this.txHost.tx
      .select()
      .from(stops)
      .where(and(eq(stops.orderId, order.id), ne(stops.status, 'CANCELLED')))
      .orderBy(desc(stops.createdAt))
      .limit(1);
    return latest;
  }

  /** Packs the driver recorded for each order line; empty until the record has synced. */
  async deliveredQty(stopId: string): Promise<Map<string, number>> {
    const rows = await this.txHost.tx
      .select({
        orderLineId: deliveryLines.orderLineId,
        qtyDelivered: deliveryLines.qtyDelivered,
      })
      .from(deliveryLines)
      .where(eq(deliveryLines.stopId, stopId));
    return new Map(rows.map((r) => [r.orderLineId, r.qtyDelivered]));
  }

  /** The receiver, the time and the files, read from the stop and its uploaded attachments. */
  async proofOf(stop: StopRow): Promise<ProofOfDelivery> {
    const files = (await this.attachments.of('stop', stop.id)).filter(
      (file) => file.uploadedAt !== null,
    );
    const latest = (kind: string) =>
      [...files].reverse().find((file) => file.kind === kind)?.id ?? null;
    return {
      receiverName: stop.receiverName,
      deliveredAt: stop.completedAt,
      signatureId: latest('SIGNATURE'),
      photoId: latest('POD_PHOTO'),
    };
  }

  /**
   * A stop on one of this driver's own trips, with its order: how a driver raises an
   * issue from D5 without any access to the store's order API. Undefined when the stop
   * is someone else's, so the caller answers 404 and learns nothing.
   */
  async driverStop(
    driverId: string,
    ref: { stopId?: string; orderId?: string },
  ): Promise<{ stop: StopRow; order: OrderRow } | undefined> {
    const where = ref.stopId
      ? eq(stops.id, ref.stopId)
      : ref.orderId
        ? eq(stops.orderId, ref.orderId)
        : undefined;
    if (!where) return undefined;
    const [row] = await this.txHost.tx
      .select({ stop: stops, order: orders })
      .from(stops)
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .innerJoin(orders, eq(orders.id, stops.orderId))
      .where(and(where, eq(trips.driverId, driverId)))
      .orderBy(desc(stops.createdAt))
      .limit(1);
    return row;
  }

  /** The order row by id, for a command that already decided the caller may see it. */
  async orderById(id: string): Promise<OrderRow | undefined> {
    const [row] = await this.txHost.tx
      .select()
      .from(orders)
      .where(eq(orders.id, id));
    return row;
  }

  /** Which of these order lines belong to the order. */
  async lineIdsOf(orderId: string, ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.txHost.tx
      .select({ id: orderLines.id })
      .from(orderLines)
      .where(
        and(eq(orderLines.orderId, orderId), inArray(orderLines.id, [...ids])),
      );
    return rows.map((r) => r.id);
  }
}

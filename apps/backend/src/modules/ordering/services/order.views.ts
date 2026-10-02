import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { minuteLabel } from '@waypoint/shared';
import { count, eq, inArray } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { items, orderLines } from '../../../db/schema';
import {
  effectiveWindow,
  type OutletRow,
  OutletQueries,
} from '../../master-data';
import { computeTotals } from '../domain/totals';
import { cutoffKey, CutoffService } from './cutoff.service';
import type {
  DeliveryWindow,
  OrderLineView,
  OrderRow,
  OrderView,
} from './order.view';

/** An order row that may already carry its lines, from `?include=lines`. */
type RowWithLines = OrderRow & {
  lines?: (typeof orderLines.$inferSelect & {
    item?: { sku: string; name: string; packLabel: string } | null;
  })[];
  outlet?: OutletRow | null;
};

/**
 * Turns order rows into the shape a response needs: the outlet's name, the
 * cutoff instant, the receiving window on the delivery day and the totals
 * with their line count. One pass per list, so a page of 25 orders costs
 * three extra queries rather than 25.
 */
@Injectable()
export class OrderViews {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly outlets: OutletQueries,
    private readonly cutoff: CutoffService,
  ) {}

  async one(row: RowWithLines): Promise<OrderView> {
    return (await this.many([row]))[0];
  }

  /** The same order with its lines loaded, as every line write answers. */
  async withLines(row: OrderRow): Promise<OrderView> {
    const lines = await this.linesOf(row.id);
    return this.one({ ...row, lines });
  }

  async many(rows: RowWithLines[]): Promise<OrderView[]> {
    if (rows.length === 0) return [];
    const [outlets, cutoffs, lineCounts] = await Promise.all([
      this.outletsFor(rows),
      this.cutoff.cutoffsFor(
        rows.map((r) => ({ depotId: r.depotId, deliveryDate: r.deliveryDate })),
      ),
      this.lineCountsFor(rows),
    ]);

    return rows.map((row) => {
      const outlet = outlets.get(row.outletId);
      const lines = row.lines?.map(toLineView);
      // `cutoffsFor` answers for every pair it was given, so the fallback is
      // unreachable; it errs towards "locked" rather than handing out edit
      // links the server would refuse.
      const editableUntil =
        cutoffs.get(cutoffKey(row.depotId, row.deliveryDate)) ?? new Date(0);
      return {
        ...row,
        lines,
        outlet: { id: row.outletId, name: outlet?.name ?? row.outletId },
        editableUntil,
        deliveryWindow: windowOf(outlet),
        totals: {
          // The stored columns are what the engine plans on; only the line
          // count is derived, because `orders` has no column for it.
          lines: lines?.length ?? lineCounts.get(row.id) ?? 0,
          units: row.units,
          weightKg: row.weightKg,
          volumeM3: row.volumeM3,
          valueLkr: row.valueLkr,
        },
      } satisfies OrderView;
    });
  }

  /** An order's lines with the item fields M1's table shows, in item order. */
  async linesOf(orderId: string): Promise<OrderLineView[]> {
    const rows = await this.txHost.tx
      .select({
        line: orderLines,
        sku: items.sku,
        name: items.name,
        packLabel: items.packLabel,
      })
      .from(orderLines)
      .innerJoin(items, eq(items.id, orderLines.itemId))
      .where(eq(orderLines.orderId, orderId))
      .orderBy(items.name);
    return rows.map((r) => ({
      ...r.line,
      sku: r.sku,
      name: r.name,
      packLabel: r.packLabel,
    }));
  }

  /** Totals as the lines in hand add up to, for a write that just changed them. */
  totalsOf(lines: readonly OrderLineView[]) {
    return computeTotals(lines);
  }

  private async outletsFor(
    rows: RowWithLines[],
  ): Promise<Map<string, OutletRow>> {
    const embedded = rows.filter((r) => r.outlet).map((r) => r.outlet!);
    const missing = rows.filter((r) => !r.outlet).map((r) => r.outletId);
    const loaded = await this.outlets.byIds(missing);
    for (const outlet of embedded) loaded.set(outlet.id, outlet);
    return loaded;
  }

  private async lineCountsFor(
    rows: RowWithLines[],
  ): Promise<Map<string, number>> {
    const needed = rows.filter((r) => r.lines === undefined).map((r) => r.id);
    if (needed.length === 0) return new Map();
    const counted = await this.txHost.tx
      .select({ orderId: orderLines.orderId, lines: count() })
      .from(orderLines)
      .where(inArray(orderLines.orderId, needed))
      .groupBy(orderLines.orderId);
    return new Map(counted.map((r) => [r.orderId, Number(r.lines)]));
  }
}

function toLineView(
  line: typeof orderLines.$inferSelect & {
    item?: { sku: string; name: string; packLabel: string } | null;
  },
): OrderLineView {
  return {
    ...line,
    sku: line.item?.sku ?? '',
    name: line.item?.name ?? '',
    packLabel: line.item?.packLabel ?? '',
  };
}

/**
 * The window a delivery may arrive in: the outlet's receiving hours narrowed
 * by the mall's, when it sits in one (master-data's `effectiveWindow`).
 */
function windowOf(outlet: OutletRow | undefined): DeliveryWindow {
  const { openMin, closeMin } = outlet
    ? effectiveWindow(outlet)
    : { openMin: 0, closeMin: 0 };
  return {
    openMin,
    open: minuteLabel(openMin),
    closeMin,
    close: minuteLabel(closeMin),
  };
}

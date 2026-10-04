import type { IssueType } from '@waypoint/shared';
import type { LineCondition } from '../receipt.constants';

/** One line of the order as the store is asked about it. */
export interface ExpectedLine {
  orderLineId: string;
  name: string;
  /** What the order asked for. */
  qtyExpected: number;
  /** What the driver recorded; null until the driver's record has synced. */
  qtyDelivered: number | null;
}

/** One line of the store's answer. */
export interface ReceivedLine {
  orderLineId: string;
  qtyReceived: number;
  condition: LineCondition;
  /** How many packs the problem touches; derived when the store does not say. */
  qtyAffected?: number;
  note?: string;
}

/** A line the store reported something wrong with: it becomes one issue. */
export interface Discrepancy {
  orderLineId: string;
  type: IssueType;
  qtyAffected: number;
  description: string;
}

const TYPE_OF: Record<Exclude<LineCondition, 'ok'>, IssueType> = {
  damaged: 'DAMAGED',
  short: 'SHORT',
  missing: 'MISSING',
  temperature: 'TEMPERATURE',
};

/**
 * What the store is checking the delivery against: what the driver recorded, or
 * what the order asked for when the driver's record has not synced yet.
 */
export const baselineOf = (line: ExpectedLine): number =>
  line.qtyDelivered ?? line.qtyExpected;

/**
 * The lines that need an issue (specs/receipt/spec.md, Invariants): a bad condition,
 * or fewer packs than were delivered. A partial delivery the store accepts as
 * delivered is no discrepancy, because the baseline is what the driver delivered
 * (AC-RCP-04). One issue per line (decided in the spec's Open questions).
 */
export function findDiscrepancies(
  expected: readonly ExpectedLine[],
  received: readonly ReceivedLine[],
  receiptNote?: string | null,
): Discrepancy[] {
  const byLine = new Map(expected.map((line) => [line.orderLineId, line]));
  const found: Discrepancy[] = [];
  for (const got of received) {
    const line = byLine.get(got.orderLineId);
    if (!line) continue;
    const baseline = baselineOf(line);
    const shortfall = Math.max(baseline - got.qtyReceived, 0);
    if (got.condition === 'ok' && shortfall === 0) continue;

    const type: IssueType =
      got.condition === 'ok' ? 'SHORT' : TYPE_OF[got.condition];
    const qtyAffected =
      got.qtyAffected ?? (shortfall > 0 ? shortfall : baseline);
    found.push({
      orderLineId: got.orderLineId,
      type,
      qtyAffected,
      description:
        got.note?.trim() ||
        receiptNote?.trim() ||
        `${line.name}: ${qtyAffected} ${type.toLowerCase()}`,
    });
  }
  return found;
}

/** Whether the answer covers every order line once, and nothing else. */
export function coversEveryLine(
  expected: readonly ExpectedLine[],
  received: readonly ReceivedLine[],
): { missing: string[]; unknown: string[]; repeated: string[] } {
  const known = new Set(expected.map((line) => line.orderLineId));
  const seen = new Set<string>();
  const repeated: string[] = [];
  const unknown: string[] = [];
  for (const got of received) {
    if (!known.has(got.orderLineId)) unknown.push(got.orderLineId);
    else if (seen.has(got.orderLineId)) repeated.push(got.orderLineId);
    seen.add(got.orderLineId);
  }
  const missing = [...known].filter((id) => !seen.has(id));
  return { missing, unknown, repeated };
}

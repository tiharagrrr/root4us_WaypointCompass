/**
 * An order's totals, recomputed from its lines on every line change. The
 * engine plans on these numbers, so they are derived here and nowhere else
 * (specs/ordering/spec.md, "Totals are recomputed on every line change").
 */

/** kg and m³ carry 2 decimals in the API; sums round once, at the end. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LineSnapshot {
  qty: number;
  unitWeightKg: number;
  unitVolumeM3: number;
  unitValueLkr: number | null;
}

export interface OrderTotals {
  /** Distinct items, as M1's "5 lines · 40 packs" shows. */
  lines: number;
  /** Packs across every line. */
  units: number;
  weightKg: number;
  volumeM3: number;
  /** Tech orders carry value; null when no line has one. */
  valueLkr: number | null;
}

export function computeTotals(lines: readonly LineSnapshot[]): OrderTotals {
  let units = 0;
  let weightKg = 0;
  let volumeM3 = 0;
  let valueLkr: number | null = null;
  for (const line of lines) {
    units += line.qty;
    weightKg += line.qty * line.unitWeightKg;
    volumeM3 += line.qty * line.unitVolumeM3;
    if (line.unitValueLkr != null)
      valueLkr = (valueLkr ?? 0) + line.qty * line.unitValueLkr;
  }
  return {
    lines: lines.length,
    units,
    weightKg: round2(weightKg),
    volumeM3: round2(volumeM3),
    valueLkr: valueLkr == null ? null : Math.round(valueLkr),
  };
}

/** One line's own weight and volume, as M1's table shows them. */
export function lineMeasures(line: LineSnapshot): {
  weightKg: number;
  volumeM3: number;
  valueLkr: number | null;
} {
  return {
    weightKg: round2(line.qty * line.unitWeightKg),
    volumeM3: round2(line.qty * line.unitVolumeM3),
    valueLkr:
      line.unitValueLkr == null
        ? null
        : Math.round(line.qty * line.unitValueLkr),
  };
}

export interface SnapshotItem {
  id: string;
  unitWeightKg: number;
  unitVolumeM3: number;
  unitValueLkr: number | null;
}

/**
 * A line as it is stored: the item's size and value copied onto it, so a
 * later catalog change never moves a placed order's weight.
 */
export function snapshotLine(
  item: SnapshotItem,
  qty: number,
): { itemId: string; qty: number } & LineSnapshot {
  return {
    itemId: item.id,
    qty,
    unitWeightKg: item.unitWeightKg,
    unitVolumeM3: item.unitVolumeM3,
    unitValueLkr: item.unitValueLkr,
  };
}

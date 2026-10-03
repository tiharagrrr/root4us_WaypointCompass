import type { CatalogItem } from './catalog';

export interface LineSpec {
  sku: string;
  qty: number;
  unitWeightKg: number;
  unitVolumeM3: number;
  unitValueLkr: number | null;
}

/** FNV-1a: a small, stable hash so an order always gets the same lines. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Thousandths, so the sums are exact in the database's float columns. */
const milli = (n: number) => Math.round(n * 1000);

/**
 * Catalog lines for a seeded order that add up exactly to its weight and volume
 * (specs/data/datasets.md, task2b_peak_day_scenarios.csv): three to five of the brand's items take
 * up to about 80 % of the order, and the brand's adjustment item carries the rest as one line whose
 * unit is the remainder. Deterministic: the order reference picks the items.
 */
export function linesFor(
  ref: string,
  totals: { weightKg: number; volumeM3: number },
  items: readonly CatalogItem[],
  adjustment: CatalogItem,
): LineSpec[] {
  const h = hash(ref);
  const count = 3 + (h % 3);
  const start = h % items.length;
  const picked: CatalogItem[] = [];
  for (let i = 0; picked.length < Math.min(count, items.length); i += 1) {
    const item = items[(start + i * 7) % items.length];
    if (item && !picked.includes(item)) picked.push(item);
    if (i > items.length * 7) break;
  }

  const weight = milli(totals.weightKg);
  const volume = milli(totals.volumeM3);
  let usedW = 0;
  let usedV = 0;
  const lines: LineSpec[] = [];
  for (const item of picked) {
    const w = milli(item.unitWeightKg);
    const v = milli(item.unitVolumeM3);
    const share = Math.floor((weight * 0.8) / picked.length);
    let qty = Math.max(1, Math.floor(share / w));
    // Leave room for the adjustment line on both measures.
    while (
      qty > 0 &&
      (usedW + qty * w > weight * 0.9 || usedV + qty * v > volume * 0.9)
    )
      qty -= 1;
    if (qty === 0) continue;
    usedW += qty * w;
    usedV += qty * v;
    lines.push({
      sku: item.sku,
      qty,
      unitWeightKg: item.unitWeightKg,
      unitVolumeM3: item.unitVolumeM3,
      unitValueLkr: item.unitValueLkr,
    });
  }
  lines.push({
    sku: adjustment.sku,
    qty: 1,
    unitWeightKg: (weight - usedW) / 1000,
    unitVolumeM3: (volume - usedV) / 1000,
    unitValueLkr: null,
  });
  return lines;
}

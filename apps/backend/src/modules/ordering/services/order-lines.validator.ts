import { Injectable } from '@nestjs/common';
import type { Brand, TempClass } from '@waypoint/shared';
import {
  type FieldError,
  ValidationError,
} from '../../../core/errors/domain-errors';
import { type ItemRow, ItemQueries } from '../../master-data';
import { type LineSnapshot, snapshotLine } from '../domain/totals';

/** One line as a request gives it: an item and how many whole packs of it. */
export interface LineInput {
  itemId: string;
  qty: number;
}

/** The order the lines are going onto; its class and brand decide what fits. */
export interface LineHost {
  brand: Brand;
  tempClass: TempClass;
}

export type SnapshottedLine = { itemId: string; qty: number } & LineSnapshot;

/**
 * What may go on an order's lines (specs/ordering/spec.md, "Enforced by the
 * service"): the item exists, belongs to the outlet's brand, matches the
 * order's temperature class and is still in the catalog. Each refusal is a
 * 400 naming `itemId` on the line that broke the rule, because M1a's picker
 * shows the error against the row the shopper just tapped (AC-ORD-05,
 * AC-ORD-12).
 *
 * Every accepted line carries the item's weight, volume and value as a
 * snapshot, so a later catalog edit never moves a placed order's totals.
 */
@Injectable()
export class OrderLinesValidator {
  constructor(private readonly items: ItemQueries) {}

  /**
   * `field` names the path the errors hang off: 'lines' for a list, '' for a
   * single line added through POST /orders/{id}/lines.
   */
  async snapshot(
    lines: readonly LineInput[],
    host: LineHost,
    field = 'lines',
  ): Promise<SnapshottedLine[]> {
    const at = (i: number) => (field ? `${field}[${i}].itemId` : 'itemId');
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    lines.forEach((line, i) => {
      if (seen.has(line.itemId))
        errors.push({
          field: at(i),
          code: 'duplicate',
          message:
            'This item is already on the order. Change its quantity instead.',
        });
      seen.add(line.itemId);
    });

    const catalog = await this.items.byIds(lines.map((l) => l.itemId));
    const snapshots: SnapshottedLine[] = [];
    lines.forEach((line, i) => {
      const item = catalog.get(line.itemId);
      const problem = item ? this.problemWith(item, host) : 'unknown';
      if (problem) errors.push({ field: at(i), ...MESSAGES[problem] });
      else snapshots.push(snapshotLine(item!, line.qty));
    });

    if (errors.length) throw new ValidationError(errors);
    return snapshots;
  }

  /**
   * The same rules, but a line that no longer fits is dropped instead of
   * refused: M8's reorder rebuilds what it still can and names the rest in a
   * notice (AC-ORD-07).
   */
  async classify(
    lines: readonly LineInput[],
    host: LineHost,
  ): Promise<ClassifiedLines> {
    const catalog = await this.items.byIds(lines.map((l) => l.itemId));
    const kept: SnapshottedLine[] = [];
    const droppedNames: string[] = [];
    for (const line of lines) {
      const item = catalog.get(line.itemId);
      if (item && !this.problemWith(item, host))
        kept.push(snapshotLine(item, line.qty));
      else droppedNames.push(item?.name ?? line.itemId);
    }
    return { kept, droppedNames };
  }

  /** The one rule the item breaks, or undefined when it fits the order. */
  private problemWith(item: ItemRow, host: LineHost): Problem | undefined {
    if (!item.active) return 'inactive';
    if (item.brand !== host.brand) return 'brand';
    if (item.tempClass !== host.tempClass)
      return item.tempClass === 'CHILLED' ? 'chilled' : 'ambient';
    return undefined;
  }
}

type Problem = 'unknown' | 'inactive' | 'brand' | 'chilled' | 'ambient';

const MESSAGES: Record<Problem, { code: string; message: string }> = {
  unknown: { code: 'not_found', message: 'This item is not in the catalog.' },
  inactive: {
    code: 'inactive',
    message: 'This item has left the catalog, so it cannot be ordered.',
  },
  brand: {
    code: 'wrong_brand',
    message: "This item belongs to another brand's range.",
  },
  chilled: {
    code: 'wrong_class',
    message: 'Add chilled items to a chilled order',
  },
  ambient: {
    code: 'wrong_class',
    message: 'A chilled order takes chilled items only',
  },
};

/** What a reorder keeps and what it has to leave behind (AC-ORD-07). */
export interface ClassifiedLines {
  kept: SnapshottedLine[];
  /** Item names a notice can list, in the order the lines came in. */
  droppedNames: string[];
}

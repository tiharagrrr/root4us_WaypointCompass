import type { Brand } from '@waypoint/shared';

/** One sequence per brand, so Fresh, Style and Tech number independently. */
const PREFIX: Record<Brand, string> = {
  FRESH: 'WF',
  STYLE: 'WS',
  TECH: 'WT',
};

/** The Postgres sequence behind each brand's numbers. */
export const ORDER_NO_SEQUENCE: Record<Brand, string> = {
  FRESH: 'order_no_fresh_seq',
  STYLE: 'order_no_style_seq',
  TECH: 'order_no_tech_seq',
};

/** "WF-0171" for the 171st Fresh order. Four digits, more when it runs past. */
export function orderNoFor(brand: Brand, n: number): string {
  return `${PREFIX[brand]}-${String(n).padStart(4, '0')}`;
}

/** The brand an order number belongs to, or undefined for anything else. */
export function brandOfOrderNo(orderNo: string): Brand | undefined {
  const prefix = orderNo.slice(0, 2).toUpperCase();
  return (Object.keys(PREFIX) as Brand[]).find((b) => PREFIX[b] === prefix);
}

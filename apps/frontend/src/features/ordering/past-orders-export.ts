import { ordersList, type OrderDto, type OrdersListParams } from '@compass/api-client'

/** The list's page cap (100 for offset lists); the export walks the pages. */
const PAGE = 100

const COLUMNS: [string, (o: OrderDto) => string | number | null][] = [
  ['order', (o) => o.orderNo],
  ['outlet', (o) => o.outlet.name],
  ['district', (o) => o.districtId],
  ['brand', (o) => o.brand],
  ['temp', (o) => o.tempClass],
  ['weight_kg', (o) => o.totals.weightKg],
  ['volume_m3', (o) => o.totals.volumeM3],
  ['requested', (o) => o.requestedDate],
  ['delivery', (o) => o.deliveryDate],
  ['result', (o) => o.status],
  ['cancel_reason', (o) => o.cancelReason],
]

const cell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Every order the filters match, as CSV text with a header row. */
export async function pastOrdersCsv(params: OrdersListParams): Promise<string> {
  const rows: OrderDto[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await ordersList({ ...params, limit: PAGE, offset })
    rows.push(...page.data)
    if (rows.length >= page.meta.page.total || page.data.length === 0) break
  }
  return [COLUMNS.map(([name]) => name).join(','), ...rows.map((o) => COLUMNS.map(([, get]) => cell(get(o))).join(','))].join('\n')
}

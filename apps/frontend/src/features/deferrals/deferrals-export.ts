import { deferralsList, type DeferralDto, type DeferralsListParams } from '@compass/api-client'
import { STORE_CHIP, shortName } from './deferral-copy'

/** The list's page cap (100 for offset lists); the export walks the pages. */
const PAGE = 100

const COLUMNS: [string, (d: DeferralDto) => string | number | null][] = [
  ['order', (d) => d.orderNo],
  ['outlet', (d) => d.outletName],
  ['from', (d) => d.fromDate],
  ['to', (d) => d.toDate],
  ['reason', (d) => d.reasonLabel],
  ['skips_30d', (d) => d.skips30d],
  ['repeat_skip', (d) => (d.repeatSkip ? 'yes' : 'no')],
  ['store', (d) => STORE_CHIP[d.storeResponse]?.label ?? d.storeResponse],
  ['store_note', (d) => d.storeNote],
  ['logged_by', (d) => shortName(d.decidedByName)],
  ['reply', (d) => d.dispatcherReply],
]

const cell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Every deferral the filters match, as CSV text with a header row. */
export async function deferralsCsv(params: DeferralsListParams): Promise<string> {
  const rows: DeferralDto[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await deferralsList({ ...params, limit: PAGE, offset })
    rows.push(...page.data)
    if (rows.length >= page.meta.page.total || page.data.length === 0) break
  }
  return [COLUMNS.map(([name]) => name).join(','), ...rows.map((d) => COLUMNS.map(([, get]) => cell(get(d))).join(','))].join('\n')
}

/** Hands the CSV to the browser as a download. */
export function download(csv: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

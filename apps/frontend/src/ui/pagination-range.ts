/** One slot in the pager: a page number (1-based) or a fold. */
export type PageItem = number | 'ellipsis-start' | 'ellipsis-end'

/**
 * Figma: Pagination · 429:150. Always page 1 and the last page, plus up to 3 pages around the
 * current one (the window slides to stay inside); the rest fold into "…".
 */
export const pageItems = (current: number, last: number): PageItem[] => {
  if (last <= 1) return [1]
  const page = Math.min(Math.max(current, 1), last)
  const start = Math.min(Math.max(page - 1, 2), Math.max(2, last - 3))
  const end = Math.min(start + 2, last - 1)
  const items: PageItem[] = [1]
  if (start > 2) items.push('ellipsis-start')
  for (let p = start; p <= end; p += 1) items.push(p)
  if (end < last - 1) items.push('ellipsis-end')
  items.push(last)
  return items
}

/** meta.page as the API sends it for offset lists. */
export interface OffsetPage {
  limit: number
  offset: number
  total: number
}

export const pageState = ({ limit, offset, total }: OffsetPage) => {
  const size = Math.max(limit, 1)
  const last = Math.max(Math.ceil(total / size), 1)
  const current = Math.min(Math.floor(offset / size) + 1, last)
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + size, total)
  return { current, last, from, to, size }
}

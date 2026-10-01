import { cn } from '@/lib/cn'
import { Button } from './button'
import { pageItems, pageState, type OffsetPage } from './pagination-range'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

export interface PaginationProps {
  /** meta.page from the list envelope. */
  page: OffsetPage
  /** Called with the new offset when a page is chosen. */
  onOffsetChange: (offset: number) => void
  /** Called with the new limit; the caller goes back to offset 0. Omit to hide the picker. */
  onLimitChange?: (limit: number) => void
  pageSizes?: readonly number[]
  className?: string
}

/**
 * Figma: Pagination · 429:150. Footer for server-paged tables, inside the table card below the
 * last row. Page p asks for limit = page size and offset = (p − 1) × page size.
 */
export function Pagination({ page, onOffsetChange, onLimitChange, pageSizes = [10, 25, 50], className }: PaginationProps) {
  const { current, last, from, to, size } = pageState(page)
  const goTo = (p: number) => onOffsetChange((p - 1) * size)

  return (
    <nav
      aria-label="Pagination"
      data-slot="pagination"
      className={cn('flex h-[52px] items-center justify-between border-t border-border bg-background px-4 py-2.5', className)}
    >
      <div className="flex items-center gap-2">
        {onLimitChange ? (
          <>
            <span className="type-body-small text-muted-foreground">Rows per page</span>
            <Select value={String(size)} onValueChange={(value) => onLimitChange(Number(value))}>
              <SelectTrigger size="sm" aria-label="Rows per page" className="type-data w-auto gap-1.5 pl-2.5 pr-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((n) => (
                  <SelectItem key={n} value={String(n)} className="type-data">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span aria-hidden="true" className="h-4 w-px bg-slate-200" />
          </>
        ) : null}
        <span className="type-data text-slate-700">
          {from}–{to} of {page.total}
        </span>
      </div>

      {last > 1 ? (
        <div className="flex items-center gap-1 pl-2">
          <Button variant="outline" size="sm" disabled={current <= 1} onClick={() => goTo(current - 1)}>
            Previous
          </Button>
          {pageItems(current, last).map((item) =>
            typeof item === 'number' ? (
              <button
                key={item}
                type="button"
                aria-current={item === current ? 'page' : undefined}
                aria-label={`Page ${item}`}
                onClick={() => goTo(item)}
                className={cn(
                  'flex size-8 min-w-8 cursor-pointer items-center justify-center rounded-md border px-2 transition-colors duration-100',
                  item === current
                    ? 'type-data-bold border-primary bg-accent text-primary'
                    : 'type-data border-transparent text-slate-700 hover:bg-slate-100',
                )}
              >
                {item}
              </button>
            ) : (
              <span key={item} aria-hidden="true" className="type-data flex size-8 items-center justify-center text-muted-foreground">
                …
              </span>
            ),
          )}
          <Button variant="outline" size="sm" disabled={current >= last} onClick={() => goTo(current + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </nav>
  )
}

import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

// Figma: "Table" in A1 (185:8845). The card holds the table and, below the last row, Pagination.

/** The bordered card around a table and its pagination footer. */
export function TableContainer({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="table-container" className={cn('w-full overflow-hidden rounded-lg border border-border bg-background shadow-sm', className)} {...props} />
}

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full border-collapse text-left', className)} {...props} />
    </div>
  )
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('border-b border-border bg-page', className)} {...props} />
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&>tr:first-child]:border-t-0', className)} {...props} />
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('h-[53px] border-t border-slate-100 data-[state=selected]:bg-accent', className)} {...props} />
}

/** Header cell: Compass/Label, capitals, muted (NAME, ROLE, LINKED TO, STATUS). */
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return <th data-slot="table-head" scope="col" className={cn('type-label h-9 px-3 text-left align-middle font-normal uppercase whitespace-nowrap text-muted-foreground', className)} {...props} />
}

/** Body cell: 13/18.85 slate-700 ("Store manager", "Depot · Peliyagoda"). */
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('type-body px-3 align-middle text-slate-700', className)} {...props} />
}

/** Name with a mono second line (A1's name and email or phone). */
export function TableCellStack({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="flex flex-col gap-px">
      <span className="type-body-strong text-[13px] text-foreground">{primary}</span>
      {secondary ? <span className="type-mono-small text-muted-foreground">{secondary}</span> : null}
    </div>
  )
}

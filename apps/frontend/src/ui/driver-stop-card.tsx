import type { ReactNode } from 'react'
import { Card, CardContent } from './card'
import { Icon } from './icon'

// Figma: D3 Next stop · 185:20107 (and the stop list on D1). The card a driver reads at a glance
// through a windscreen: where they are going, and the times that decide whether they are late.
export interface StopDetailRow {
  label: string
  value: ReactNode
}

export interface DriverStopCardProps {
  /** "NEXT STOP", or "STOP 4 OF 8". */
  eyebrow?: string
  /** Outlet name, e.g. "Ja-Ela". */
  name: string
  /** Street address under the name. */
  address?: string
  /** A chilled drop carries the leaf mark in the frames. */
  chilled?: boolean
  /** ETA, Window, Mall window: label left, value right. */
  rows?: readonly StopDetailRow[]
  /** Anything after the rows: the dock-and-access link, actions. */
  children?: ReactNode
  className?: string
}

export function DriverStopCard({ eyebrow, name, address, chilled = false, rows = [], children, className }: DriverStopCardProps) {
  return (
    <Card data-slot="driver-stop-card" className={className}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          {eyebrow ? <span className="type-label uppercase text-muted-foreground">{eyebrow}</span> : null}
          <span className="flex items-center gap-1.5">
            {chilled ? <Icon name="leaf" size={18} className="text-teal-700" /> : null}
            <span className="type-heading text-foreground">{name}</span>
          </span>
          {address ? <span className="type-body text-muted-foreground">{address}</span> : null}
        </div>

        {rows.length > 0 ? (
          <dl className="m-0 flex flex-col">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0 first:pt-0">
                <dt className="type-body m-0 text-primary">{row.label}</dt>
                <dd className="type-data-bold m-0 text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {children}
      </CardContent>
    </Card>
  )
}

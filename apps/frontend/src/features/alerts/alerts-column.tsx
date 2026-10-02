// Figma: 19 Tracking · 185:17224 (the right-hand "Alerts" column: the OPEN count, the type
// filter, the open alert card and the compact rows below it)
import type { AlertDto, AlertDtoType } from '@compass/api-client'
import { useState } from 'react'
import { useServerClock } from '@/lib/server-clock'
import { Card, CardContent } from '@/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { ALERT_TYPE_OPTIONS } from './alert-copy'
import { AlertDetailCard } from './alert-detail-card'
import { AlertRow } from './alert-row'
import { useDepotAlerts } from './use-depot-alerts'

const ALL = 'all'

export interface AlertsColumnProps {
  depotId: string
  /** 19a narrows the column to one trip's alerts. */
  tripId?: string
  /** What the alerts are about, when the screen knows ("REF-07 Trip 1"). */
  reference?: string | null
  className?: string
}

/**
 * 19's alerts column. The alert at the top is open in full with its fixes;
 * the rest are one line each until you pick one.
 *
 * Resolved alerts stay in the list rather than vanishing. A dispatcher who
 * watched "VAN-03 offline" sit there for twenty minutes needs to see it go
 * green, or they will keep checking whether anyone did anything about it.
 */
export function AlertsColumn({ depotId, tripId, reference, className }: AlertsColumnProps) {
  const { now } = useServerClock(30_000)
  const [type, setType] = useState<AlertDtoType | typeof ALL>(ALL)
  const [openedId, setOpenedId] = useState<string | null>(null)

  const { alerts, open, isPending, isError, error, refetch } = useDepotAlerts({
    depotId,
    tripId,
    ...(type === ALL ? {} : { type }),
    limit: 20,
  })

  // The server's order decides which alert opens; a dispatcher's own pick
  // wins until they clear it, so a new alert arriving does not snatch the
  // panel away mid-read. Acting on an alert pins it too: acknowledging one
  // moves it below the open alerts, and the card they just pressed should
  // not vanish as a result.
  const opened = alerts.find((alert) => alert.id === openedId) ?? alerts[0]
  const rest = alerts.filter((alert) => alert.id !== opened?.id)

  return (
    <Card data-slot="alerts-column" className={className}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="type-card-title m-0 text-foreground">Alerts</h2>
          {isPending ? null : (
            <StatusChip tone={open.length > 0 ? 'danger' : 'success'}>
              {open.length} open
            </StatusChip>
          )}
        </div>
        <Select value={type} onValueChange={(value) => setType(value === ALL ? ALL : (value as AlertDtoType))}>
          <SelectTrigger size="sm" aria-label="Filter alerts by type" className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {ALERT_TYPE_OPTIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <CardContent className="pt-0">
          <ErrorState error={error} onRetry={refetch} />
        </CardContent>
      ) : isPending ? (
        <CardContent className="flex flex-col gap-3 pt-0">
          <Skeleton className="h-[152px] w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      ) : !opened ? (
        <EmptyState
          title={type === ALL ? 'No alerts' : 'None of that kind'}
          description={
            type === ALL
              ? 'Every run is inside its window and no one has flagged a problem.'
              : 'Change the filter to see the rest of the depot’s alerts.'
          }
        />
      ) : (
        <>
          <div className="px-4 pb-3">
            <AlertDetailCard alert={opened} now={now} reference={reference} onAct={(acted) => setOpenedId(acted.id)} />
          </div>
          {rest.length > 0 ? (
            <ul className="m-0 flex list-none flex-col divide-y divide-border border-t border-border p-0">
              {rest.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  now={now}
                  reference={reference}
                  selected={alert.id === openedId}
                  onSelect={(picked: AlertDto) => setOpenedId(picked.id)}
                />
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Card>
  )
}

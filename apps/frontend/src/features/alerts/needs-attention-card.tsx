// Figma: 01 Dashboard · 488:8577 ("Needs Attention", the exception panel in the right column)
import { Link as RouterLink } from 'react-router'
import { useServerClock } from '@/lib/server-clock'
import { Card, CardContent, CardHeader } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { AlertRow } from './alert-row'
import { useDepotAlerts } from './use-depot-alerts'

/** 01 shows the worst handful; the rest are a click away on 19. */
const SHOWN = 6

export interface NeedsAttentionCardProps {
  depotId: string
}

/**
 * 01's exception panel: the depot's open alerts, worst first, each pointing
 * at what would fix it.
 *
 * It is a read, not a workspace. A dispatcher scanning the dashboard wants to
 * know what is wrong and where to go; the fixes themselves are on 19, which
 * is why the card ends in a link to tracking rather than a row of buttons.
 *
 * The frame puts the vehicle beside each alert ("Late risk · REF-07"), but an
 * alert points at its trip by id with no foreign key and alerts never joins
 * the fleet (specs/alerts/spec.md, Model), so the heading here is the alert's
 * kind alone. 19a passes a reference in, because that screen knows the trip.
 */
export function NeedsAttentionCard({ depotId }: NeedsAttentionCardProps) {
  const { now } = useServerClock(30_000)
  const { open, isPending, isError, error, refetch } = useDepotAlerts({
    depotId,
    status: 'OPEN,ACKNOWLEDGED',
    limit: SHOWN,
  })

  return (
    <Card data-slot="needs-attention">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <h2 className="type-card-title m-0 text-foreground">Needs Attention</h2>
        <span className="type-body text-muted-foreground">{isPending ? '' : open.length}</span>
      </CardHeader>

      {isError ? (
        <CardContent className="pt-0">
          <ErrorState error={error} onRetry={refetch} />
        </CardContent>
      ) : isPending ? (
        <CardContent className="flex flex-col gap-3 pt-0">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      ) : open.length === 0 ? (
        <EmptyState title="Nothing needs you" description="Every run is inside its window and no one has flagged a problem." />
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {open.map((alert) => (
            <AlertRow key={alert.id} alert={alert} now={now} />
          ))}
        </ul>
      )}

      {open.length > 0 ? (
        <div className="border-t border-border px-4 py-3">
          <RouterLink to="/dispatch/tracking" className="type-body text-primary hover:underline">
            Open tracking to fix these
          </RouterLink>
        </div>
      ) : null}
    </Card>
  )
}

// Figma: L2 Loading list · 185:19377 (Box / REF-07 in the rail) and L2m-a Runs · 254:1306
import type { LoadTripSummaryDto } from '@compass/api-client'
import { useTranslation } from 'react-i18next'
import { formatColombo } from '@/lib/format-colombo'
import { StatusChip } from '@/ui/status-chip'
import { tempClassLabel, tripStatusLabel, tripStatusTone } from './loading-copy'

export interface TripRowProps {
  trip: LoadTripSummaryDto
}

/**
 * One run, as the rail draws it on the tablet and the panel draws it on a phone: what it is, how
 * far the dock has got, and whether anything is stuck.
 */
export function TripRow({ trip }: TripRowProps) {
  const { t } = useTranslation()
  const { progress } = trip
  const departs = trip.releasedAt
    ? t('loading.departedAt', { time: formatColombo(trip.releasedAt, 'HH:mm') })
    : t('loading.departsStops', {
        time: trip.plannedDepartAt ? formatColombo(trip.plannedDepartAt, 'HH:mm') : '—',
        count: trip.outletCount,
      })

  return (
    <>
      <span className="flex w-full items-center gap-2">
        <span className="type-data-bold text-[14px] text-foreground">{trip.vehicleId}</span>
        <span className="font-sans text-[14px] text-slate-700">{tempClassLabel(trip.tempClass)}</span>
        <span className="flex-1" />
        {progress.openFlags > 0 ? (
          <StatusChip tone="danger">{t('loading.flaggedChip')}</StatusChip>
        ) : (
          <StatusChip tone={tripStatusTone(trip.status)}>{tripStatusLabel(trip.status)}</StatusChip>
        )}
      </span>
      <span className="type-body w-full text-muted-foreground">
        {departs}
        {progress.checked > 0 && !trip.releasedAt
          ? ` · ${t('loading.itemsOf', { checked: progress.checked, total: progress.lines })}`
          : ''}
      </span>
    </>
  )
}

// Figma: L4 Release trip · 185:19748 (Card / REF-07 · Trip 1, the right-hand 400 px card)
import type { LoadListDto } from '@compass/api-client'
import { useTranslation } from 'react-i18next'
import { formatColombo } from '@/lib/format-colombo'
import { Icon } from '@/ui/icon'
import { StatusChip } from '@/ui/status-chip'
import { tempClassLabel } from './loading-copy'

export interface TripSummaryCardProps {
  list: LoadListDto
  /** The driver's name when the release checks name them; the id is no use to a loader. */
  driver?: string | null
  className?: string
}

const SHOWN = 5

/**
 * What is about to leave the dock, in delivery order — the opposite order to the load list, which
 * is the point: the loader sees that the last thing they put in is the first thing off.
 */
export function TripSummaryCard({ list, driver, className }: TripSummaryCardProps) {
  const { t } = useTranslation()
  const delivery = [...list.stops].sort((a, b) => a.stopSeq - b.stopSeq)
  const shown = delivery.slice(0, SHOWN)
  const more = delivery.length - shown.length

  return (
    <aside data-slot="trip-summary" className={className}>
      <div className="flex h-full flex-col rounded-lg border border-border bg-background shadow-sm">
        <div className="flex flex-col gap-1.5 border-b border-border px-4 pb-[17px] pt-4">
          <div className="flex items-center gap-2">
            <h2 className="type-title m-0 text-foreground">{list.trip.vehicleId}</h2>
            {list.trip.tempClass === 'CHILLED' ? <StatusChip tone="muted">{t('loading.reeferChip')}</StatusChip> : null}
            <StatusChip tone="muted">{tempClassLabel(list.trip.tempClass).toUpperCase()}</StatusChip>
          </div>
          <dl className="m-0 flex flex-col">
            <Row label={t('loading.driver')} value={driver ?? t('loading.noDriver')} />
            <Row label={t('loading.departs')} value={list.trip.plannedDepartAt ? formatColombo(list.trip.plannedDepartAt, 'HH:mm') : '—'} />
            <Row label={t('loading.stops')} value={String(delivery.length)} />
            <Row label={t('loading.items')} value={t('loading.itemsOf', { checked: list.progress.checked, total: list.progress.lines })} />
          </dl>
        </div>
        <div className="flex flex-col px-4 py-3">
          <p className="type-label m-0 pb-1.5 uppercase text-muted-foreground">{t('loading.stopsInDeliveryOrder')}</p>
          <ol className="m-0 flex list-none flex-col p-0">
            {shown.map((stop) => (
              <li key={stop.orderId} className="flex items-center border-t border-slate-100 pb-[9px] pt-2.5">
                <span className="type-data-bold w-[28.5px] text-muted-foreground">{stop.stopSeq}</span>
                <span className="flex flex-1 items-center gap-1.5">
                  <Icon name="leaf" size={14} className="text-status-success-icon" />
                  <span className="font-sans text-[14px] font-medium text-foreground">{stop.outletName}</span>
                </span>
                <span className="type-data text-slate-700">{stop.orderNo}</span>
              </li>
            ))}
          </ol>
          {more > 0 ? <p className="type-body m-0 pt-2 text-muted-foreground">{t('loading.moreStops', { count: more })}</p> : null}
        </div>
      </div>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-t border-slate-100 pb-2 pt-[9px]">
      <dt className="type-body m-0 text-muted-foreground">{label}</dt>
      <dd className="type-body-strong m-0 text-right text-foreground">{value}</dd>
    </div>
  )
}

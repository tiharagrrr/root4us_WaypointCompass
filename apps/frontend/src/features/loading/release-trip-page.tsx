// Figma: L4 Release trip · 185:19748 (tablet 1194 × 834: the checklist beside the trip card) and
// L4m Release trip · 254:1675 (phone 390 × 844: back button, the card under the checklist, and
// Release holding the bottom edge)
import {
  getTripLoadingLoadListQueryKey,
  useTripLoadingReleaseChecks,
  useTripLoadingReleaseTrip,
  type ReleaseCheckDto,
  type TripLoadingReleaseTrip200,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { cn } from '@/lib/cn'
import { useOfflineStatus, uuidv7 } from '@/offline'
import { Action } from '@/ui/action'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { ErrorState } from '@/ui/states'
import { useCheckedBy } from './checked-by'
import { DockOfflineBanner } from './dock-offline-banner'
import { TripReleased } from './trip-released-page'
import { TripSummaryCard } from './trip-summary-card'
import { useLoadList } from './use-load-list'

/** "3.2" to 3.2; anything else is "nothing typed yet", which is a failing check, not an error. */
const parseTemp = (typed: string): number | undefined => {
  const value = Number(typed.trim())
  return typed.trim() === '' || Number.isNaN(value) ? undefined : value
}

/**
 * L4. The release is the one loader write that needs a connection: it has to confirm the trip is
 * still on the plan's latest revision, and a tablet with no signal cannot know that (AC-LOD-17).
 * So this screen alone uses the mutation hook rather than the outbox, and says so when it is off.
 *
 * The checklist is the server's `releaseChecks`, drawn pass or fail. The same list comes back on a
 * refused release, so the screen never has to guess why the button did nothing.
 */
export function ReleaseTripPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const checkedBy = useCheckedBy()
  const { online } = useOfflineStatus()
  const [temp, setTemp] = useState('')
  const tempC = parseTemp(temp)

  // The reading goes to the server so the temperature check answers live; keeping the previous
  // answer while it does means the field the loader is typing in does not vanish under them.
  const checks = useTripLoadingReleaseChecks(id, tempC === undefined ? undefined : { reeferTempC: tempC }, {
    query: { placeholderData: (previous) => previous },
  })
  const { list } = useLoadList(id)
  const release = useTripLoadingReleaseTrip({
    mutation: {
      // The release answers with the list it just closed, so L5 draws itself from the response
      // rather than asking for it again.
      onSuccess: (answer: TripLoadingReleaseTrip200) => {
        qc.setQueryData(getTripLoadingLoadListQueryKey(id), answer)
      },
      // A refusal is the checklist moving under the dock's feet, so take the server's new answer.
      onError: () => void checks.refetch(),
    },
  })

  const data = checks.data?.data
  const driver = data?.checks.find((check) => check.id === 'DRIVER_ASSIGNED' && check.pass)?.detail

  const releaseTrip = () =>
    checkedBy.withName((checkedByName) => {
      release.mutate({
        id,
        data: {
          checkedByName,
          clientUuid: uuidv7(),
          planRevision: data?.planRevision,
          ...(tempC === undefined ? {} : { reeferTempC: tempC }),
        },
      })
    })

  if (list && list.trip.status === 'RELEASED') return <TripReleased list={list} driver={driver} />

  return (
    <div data-slot="release-trip" className="flex min-h-0 flex-1 flex-col gap-3">
      <DockOfflineBanner />
      {checks.isError ? (
        <ErrorState error={checks.error} onRetry={() => void checks.refetch()} />
      ) : (
        <div className="grid flex-1 grid-cols-1 content-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr_auto]">
          <section className="flex min-w-px flex-col lg:col-start-1 lg:row-start-1">
            <div className="flex items-center gap-2.5 pb-2">
              <Link
                to={`/dock/trips/${id}`}
                aria-label={t('loading.release.back')}
                className="flex size-11 shrink-0 items-center justify-center rounded-md text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 lg:hidden"
              >
                <Icon name="back" size={22} />
              </Link>
              <div className="flex min-w-px flex-col gap-1">
                <h1 className="type-heading m-0 text-foreground lg:type-page-title">{t('loading.release.title')}</h1>
                <p className="type-body m-0 text-muted-foreground lg:type-body-medium">
                  <span className="hidden lg:inline">{t('loading.release.subtitle')}</span>
                  <span className="lg:hidden">{t('loading.release.subtitleShort', { trip: list?.trip.vehicleId ?? '' })}</span>
                </p>
              </div>
            </div>

            {checks.isPending || !data ? (
              <div className="flex flex-col gap-3 pt-3">
                <Skeleton className="h-[60px] w-full" />
                <Skeleton className="h-[60px] w-full" />
                <Skeleton className="h-[60px] w-full" />
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {data.checks.map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    input={
                      check.id === 'REEFER_TEMP' ? (
                        <span className="flex items-center gap-2">
                          <Input
                            aria-label={t('loading.release.reeferLabel')}
                            inputMode="decimal"
                            value={temp}
                            onChange={(event) => setTemp(event.target.value)}
                            className="type-data-bold h-12 w-[90px] text-right text-[15px]"
                          />
                          <span className="font-sans text-[15px] text-slate-700">°C</span>
                        </span>
                      ) : null
                    }
                  />
                ))}
              </ul>
            )}

          </section>

          {list ? <TripSummaryCard list={list} driver={driver} className="w-full lg:col-start-2 lg:row-span-3 lg:row-start-1" /> : null}

          <footer className="flex flex-col gap-2 border-t border-border pt-3 lg:col-start-1 lg:row-start-3 lg:self-end lg:border-t-0 lg:pt-0">
            {release.isError ? <ErrorState error={release.error} /> : null}
              <Action
                link={data?._links.release}
                variant="primary"
                className="h-[52px] w-full text-[16px]"
                disabled={!online || !data?.canRelease}
                loading={release.isPending}
                onAction={() => releaseTrip()}
              >
                {t('loading.release.submit')}
              </Action>
            <p className="type-body m-0 text-center text-muted-foreground">
              {online ? t('loading.release.afterwards') : t('loading.release.needsConnection')}
            </p>
          </footer>
        </div>
      )}
      {checkedBy.dialog}
    </div>
  )
}

function CheckRow({ check, input }: { check: ReleaseCheckDto; input?: React.ReactNode }) {
  return (
    <li data-slot="release-check" data-pass={check.pass} className="flex items-center gap-[14px] border-t border-slate-100 pb-4 pt-[17px]">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-[30px] shrink-0 items-center justify-center rounded-full border',
          check.pass ? 'border-slate-900 bg-slate-900 text-background' : 'border-input bg-background',
        )}
      >
        {check.pass ? <Icon name="check" size={18} /> : null}
      </span>
      <span className="flex min-w-px flex-1 flex-col gap-0.5">
        <span className="type-card-title text-foreground">{check.label}</span>
        <span className="type-body text-muted-foreground">{check.detail}</span>
      </span>
      {input}
    </li>
  )
}

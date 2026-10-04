// Figma: 22 Forecast · 185:18562
import { useDepotForecastsList, type DepotForecastDto, type DepotForecastsListBrand, type ForecastWeekDto } from '@compass/api-client'
import { instantAt } from '@waypoint/shared'
import { useState } from 'react'
import { useDepot } from '@/app/layouts/depot-context'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { cn } from '@/lib/cn'
import { formatColombo } from '@/lib/format-colombo'
import { Checkbox } from '@/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'

const WEEKS = 10
const ALL_BRANDS = 'ALL'
const BRAND_LABELS: Record<DepotForecastsListBrand, string> = { FRESH: 'Fresh', STYLE: 'Style', TECH: 'Tech' }
const isBrand = (value: string): value is DepotForecastsListBrand => value in BRAND_LABELS

/** The plot is 300 px tall as in the frame: 240 px of scale under 60 px of room for the chips. */
const PLOT_PX = 300
const SCALE_PX = 240
const TICKS = 3

type Overlay = 'paydays' | 'festivals' | 'monsoon'
const OVERLAYS: readonly { key: Overlay; label: string }[] = [
  { key: 'paydays', label: 'Paydays' },
  { key: 'festivals', label: 'Festivals' },
  { key: 'monsoon', label: 'Monsoon' },
]

const m3 = (n: number) => Math.round(n).toLocaleString('en-US')
const weekDate = (week: ForecastWeekDto) => formatColombo(instantAt(week.weekStart, 720), 'd MMM')
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** The top of the scale: three even steps of a round size that clear the tallest bar and the capacity. */
function scaleTop(weeks: readonly ForecastWeekDto[]): number {
  const peak = Math.max(1, ...weeks.map((w) => Math.max(w.totalVolumeM3, w.capacityM3)))
  const rough = peak / TICKS
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 4, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough
  return step * TICKS
}

/**
 * 22: the ten weeks ahead at the picked depot, chilled and ambient volume against what the fleet
 * can move, with the weeks over capacity listed below (AC-FC-01). The server flags a gap week and
 * sizes the gap; this screen only draws it. The brand filter narrows the volume, not the fleet.
 */
export function ForecastPage() {
  const { depot } = useDepot()
  const [brand, setBrand] = useState<DepotForecastsListBrand | undefined>()
  const [overlays, setOverlays] = useState<Record<Overlay, boolean>>({ paydays: true, festivals: true, monsoon: true })
  const forecast = useDepotForecastsList(depot, { weeks: WEEKS, ...(brand ? { brand } : {}) })
  const data = forecast.data?.data

  usePageHeader({ eyebrow: `Forecast · next ${WEEKS} weeks`, title: 'Demand forecast' })

  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <Select value={brand ?? ALL_BRANDS} onValueChange={(value) => setBrand(isBrand(value) ? value : undefined)}>
          <SelectTrigger size="sm" aria-label="Brand" className="w-[124px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANDS}>Brand · All</SelectItem>
            {Object.entries(BRAND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                Brand · {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </HeaderActions>

      {forecast.isError ? (
        <ErrorState error={forecast.error} onRetry={() => void forecast.refetch()} />
      ) : !data ? (
        <LoadingState />
      ) : data.weeks.every((w) => w.brands.length === 0) ? (
        <EmptyState
          title="No forecast yet"
          description="Weeks show here once a forecast is imported or the depot has order history to work a baseline from."
        />
      ) : (
        <>
          <VolumeCard
            data={data}
            overlays={overlays}
            onOverlay={(key, on) => setOverlays((current) => ({ ...current, [key]: on }))}
          />
          <GapWeeks data={data} />
        </>
      )}
    </div>
  )
}

function VolumeCard({ data, overlays, onOverlay }: { data: DepotForecastDto; overlays: Record<Overlay, boolean>; onOverlay: (key: Overlay, on: boolean) => void }) {
  const top = scaleTop(data.weeks)
  const px = (volume: number) => (volume / top) * SCALE_PX
  const last = data.weeks[data.weeks.length - 1]
  const gaps =
    data.gapWeeks === 0 ? 'No gap weeks: the fleet covers every week.' : `${plural(data.gapWeeks, 'gap week')} where demand exceeds the fleet.`

  return (
    <section aria-label="Weekly volume" className="rounded-lg border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 pb-[13px] pt-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="type-card-title m-0 text-foreground">Weekly volume · m³</h2>
          <p className="type-caption m-0 text-muted-foreground">Chilled and ambient against fleet capacity. {gaps}</p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="type-label uppercase text-muted-foreground">Overlays</span>
          {OVERLAYS.map(({ key, label }) => (
            <label key={key} className="type-body flex cursor-pointer items-center gap-1.5 text-foreground">
              <Checkbox className="size-[18px] [&_svg]:size-[13px]" checked={overlays[key]} onCheckedChange={(on) => onOverlay(key, on === true)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="px-5 pb-3 pt-4">
        <div className="flex">
          <div aria-hidden className="type-mono-small relative w-12 shrink-0 text-slate-400" style={{ height: PLOT_PX }}>
            {Array.from({ length: TICKS + 1 }, (_, i) => (
              <span key={i} className="absolute right-2 translate-y-1/2" style={{ bottom: (SCALE_PX / TICKS) * i }}>
                {m3((top / TICKS) * i)}
              </span>
            ))}
          </div>
          <div className="relative flex min-w-0 flex-1 border-b border-border" style={{ height: PLOT_PX }}>
            {Array.from({ length: TICKS }, (_, i) => (
              <div key={i} aria-hidden className="absolute inset-x-0 border-t border-slate-100" style={{ bottom: (SCALE_PX / TICKS) * (i + 1) }} />
            ))}
            {data.weeks.map((week, i) => (
              <WeekColumn key={week.weekStart} week={week} index={i} px={px} overlays={overlays} monsoonStarts={week.monsoon && !data.weeks[i - 1]?.monsoon} />
            ))}
            {last ? (
              <span
                className="type-mono-small absolute right-0 -translate-y-full rounded-[3px] bg-slate-900 px-1.5 py-0.5 font-bold text-white"
                style={{ bottom: px(last.capacityM3) + 4 }}
              >
                FLEET CAPACITY {m3(last.capacityM3)} m³
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex pl-12 pt-2">
          {data.weeks.map((week, i) => (
            <div key={week.weekStart} aria-hidden className="flex min-w-0 flex-1 flex-col items-center gap-px">
              <span className={cn('type-metadata font-bold', week.overCapacity ? 'text-destructive-foreground' : 'text-foreground')}>W{i + 1}</span>
              <span className="type-mono-small font-sans text-muted-foreground">{weekDate(week)}</span>
            </div>
          ))}
        </div>

        <div className="type-caption flex items-center gap-[18px] pl-12 pt-3 text-slate-700">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-primary" />
            Chilled m³
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px] bg-blue-200" />
            Ambient m³
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-slate-900" />
            Fleet capacity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="type-mono-small font-bold text-destructive-foreground">W</span>
            Gap week
          </span>
        </div>
      </div>
    </section>
  )
}

function WeekColumn({
  week,
  index,
  px,
  overlays,
  monsoonStarts,
}: {
  week: ForecastWeekDto
  index: number
  px: (volume: number) => number
  overlays: Record<Overlay, boolean>
  monsoonStarts: boolean
}) {
  const chips = [...(overlays.paydays && week.payday ? ['Payday'] : []), ...(overlays.festivals ? week.festivals : [])]
  const shaded = overlays.monsoon && week.monsoon
  return (
    <div
      role="group"
      aria-label={`W${index + 1}, week of ${weekDate(week)}: ${m3(week.totalVolumeM3)} m³ against ${m3(week.capacityM3)} m³${week.overCapacity ? ', over capacity' : ''}`}
      className={cn('relative flex h-full min-w-0 flex-1 flex-col items-center justify-end', shaded && 'bg-page')}
    >
      {shaded && monsoonStarts ? (
        <span className="type-mono-small absolute left-2 top-[22px] bg-background px-1 py-px font-bold text-muted-foreground">MONSOON</span>
      ) : null}
      {chips.length > 0 ? (
        <div className="absolute top-0 flex flex-col items-center gap-0.5">
          {chips.map((chip) => (
            <span key={chip} className="type-mono-small rounded-[3px] border border-slate-200 bg-background px-1.5 py-0.5 font-bold uppercase text-slate-700">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
      <span className={cn('type-mono-small relative pb-1 font-bold', week.overCapacity ? 'text-destructive-foreground' : 'text-slate-700')}>
        {m3(week.totalVolumeM3)}
      </span>
      <div className="relative flex w-11 flex-col overflow-hidden rounded-t-sm">
        <div className="bg-blue-200" style={{ height: px(week.ambientVolumeM3) }} />
        <div className="bg-primary" style={{ height: px(week.chilledVolumeM3) }} />
      </div>
      <div aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-slate-900" style={{ bottom: px(week.capacityM3) }} />
    </div>
  )
}

/** What a gap week is short of, in the frame's words: "+1 reefer", "+2 vehicles". */
function gapText(week: ForecastWeekDto): string {
  const parts = [
    ...(week.extraReefers ? [`+${plural(week.extraReefers, 'reefer')}`] : []),
    ...(week.extraVehicles ? [`+${plural(week.extraVehicles, 'vehicle')}`] : []),
  ]
  return parts.length > 0 ? parts.join(' · ') : `+${m3(Math.max(week.gapVolumeM3, week.chilledGapVolumeM3))} m³`
}

const gapWhy = (week: ForecastWeekDto) => [...(week.payday ? ['Payday'] : []), ...(week.monsoon ? ['monsoon'] : []), ...week.festivals].join(' · ')

function GapWeeks({ data }: { data: DepotForecastDto }) {
  const gaps = data.weeks.flatMap((week, i) => (week.overCapacity ? [{ week, label: `W${i + 1}` }] : []))
  return (
    <TableContainer aria-label="Gap weeks" role="region">
      <div className="flex items-center justify-between border-b border-border px-4 pb-[13px] pt-3">
        <h2 className="type-card-title m-0 text-foreground">Gap weeks</h2>
        <span className="type-metadata text-muted-foreground">{gaps.length}</span>
      </div>
      {gaps.length === 0 ? (
        <EmptyState title="No gap weeks" description="The fleet covers the forecast in every week ahead." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week</TableHead>
              <TableHead className="text-right">Total m³</TableHead>
              <TableHead className="text-right">Chilled m³</TableHead>
              <TableHead className="text-right">Vehicles</TableHead>
              <TableHead className="text-right">Drivers</TableHead>
              <TableHead className="text-right">Reefers</TableHead>
              <TableHead>Gap vs fleet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gaps.map(({ week, label }) => (
              <TableRow key={week.weekStart} className="h-[49px]">
                <TableCell className="type-metadata font-bold text-foreground">{label}</TableCell>
                <Num>{m3(week.totalVolumeM3)}</Num>
                <Num>{m3(week.chilledVolumeM3)}</Num>
                <Num>{data.fleet.vehicles}</Num>
                <Num>{data.fleet.drivers}</Num>
                <Num>{data.fleet.reefers}</Num>
                <TableCell>
                  <div className="flex flex-col gap-px">
                    <span className="type-metadata font-bold text-destructive-foreground">{gapText(week)}</span>
                    {gapWhy(week) ? <span className="type-mono-small font-sans text-muted-foreground">{gapWhy(week)}</span> : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableContainer>
  )
}

function Num({ children }: { children: React.ReactNode }) {
  return <TableCell className="type-metadata text-right text-slate-700">{children}</TableCell>
}

function LoadingState() {
  return (
    <div aria-busy className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-background p-5 shadow-sm">
        <Skeleton className="h-5 w-48" />
        <div className="flex items-end gap-6 pl-12 pt-6" style={{ height: PLOT_PX }}>
          {Array.from({ length: WEEKS }, (_, i) => (
            <Skeleton key={i} className="w-11 flex-1" style={{ height: 120 + ((i * 37) % 90) }} />
          ))}
        </div>
      </div>
      <Skeleton className="h-[160px] w-full rounded-lg" />
    </div>
  )
}

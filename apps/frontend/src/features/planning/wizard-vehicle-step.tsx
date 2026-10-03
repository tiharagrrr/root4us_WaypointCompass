// Figma: 06 Add vehicle · Vehicle · 265:2419 (dialog 265:2537)
import type { PlanVehicleOptionDto } from '@compass/api-client'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { SegmentedControl } from '@/ui/segmented-control'
import { StatusChip } from '@/ui/status-chip'
import { Bar } from './plan-panels'
import { canTakeTrip, kg, percent, vehicleKind } from './plan-copy'

type Kind = 'all' | 'reefers' | 'trucks' | 'vans'

const matches = (kind: Kind, v: PlanVehicleOptionDto): boolean =>
  kind === 'all' ||
  (kind === 'reefers' && v.temp === 'REEFER' && v.type !== 'VAN') ||
  (kind === 'trucks' && v.type === 'TRUCK' && v.temp === 'AMBIENT') ||
  (kind === 'vans' && v.type === 'VAN')

const STATUS: Record<string, string> = {
  AVAILABLE: 'Available',
  NO_TRIPS_LEFT: 'No trips left',
  WORKSHOP: 'In workshop',
  BREAKDOWN: 'Broken down',
  UNAVAILABLE: 'Unavailable',
}

export interface VehicleStepProps {
  vehicles: readonly PlanVehicleOptionDto[]
  selected: string | undefined
  onSelect: (vehicleId: string) => void
}

/** 06: every vehicle with what it has left; the ones that cannot run say why (AC-PLN-15). */
export function VehicleStep({ vehicles, selected, onSelect }: VehicleStepProps) {
  const [kind, setKind] = useState<Kind>('all')
  const count = (k: Kind) => vehicles.filter((v) => matches(k, v)).length
  const available = vehicles.filter(canTakeTrip).length
  const workshop = vehicles.filter((v) => v.unavailableReason === 'WORKSHOP').length
  const shown = vehicles.filter((v) => matches(kind, v))

  return (
    <div className="flex flex-col gap-3 px-5 py-3.5">
      <div className="flex items-center justify-between">
        <SegmentedControl<Kind>
          aria-label="Vehicle type"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: 'all', label: 'All', count: count('all') },
            { value: 'reefers', label: 'Reefers', count: count('reefers') },
            { value: 'trucks', label: 'Trucks', count: count('trucks') },
            { value: 'vans', label: 'Vans', count: count('vans') },
          ]}
        />
        <p className="type-mono-small m-0 uppercase text-muted-foreground">
          {available} available · {workshop} in workshop
        </p>
      </div>
      <div role="radiogroup" aria-label="Vehicle" className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="flex h-[37px] items-center border-b border-border bg-page">
          <span className="w-10" />
          {['Vehicle', 'Type', 'Capacity', 'Fuel this week', 'Trips', 'Status'].map((h, i) => (
            <span key={h} className={cn('type-label px-3 uppercase text-muted-foreground', COLUMN[i])}>
              {h}
            </span>
          ))}
        </div>
        {shown.map((v) => {
          const usable = canTakeTrip(v)
          const fuelUsed = percent(v.weeklyFuelQuotaL - v.fuelLeftL, v.weeklyFuelQuotaL)
          const checked = selected === v.vehicleId
          const dim = usable ? 'text-slate-700' : 'text-slate-400'
          return (
            <button
              key={v.vehicleId}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={!usable}
              onClick={() => onSelect(v.vehicleId)}
              className="flex h-[47px] w-full cursor-pointer items-center border-0 border-t border-slate-100 bg-transparent p-0 text-left outline-none first-of-type:border-t-0 hover:bg-slate-50 focus-visible:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <span className="flex w-10 justify-center">
                <span
                  className={cn(
                    'size-4 rounded-full border',
                    checked ? 'border-[5px] border-blue-700' : usable ? 'border-input' : 'border-slate-200',
                  )}
                />
              </span>
              <span className={cn('px-3 font-mono text-[13px] font-bold', COLUMN[0], usable ? 'text-foreground' : 'text-slate-400')}>{v.code}</span>
              <span className={cn('type-body-small px-3', COLUMN[1], dim)}>{vehicleKind(v.type, v.temp)}</span>
              <span className={cn('type-metadata px-3', COLUMN[2], dim)}>
                {kg(v.weightCapKg)} · {v.volumeCapM3} m³
              </span>
              <span className={cn('flex items-center gap-2 px-3', COLUMN[3])}>
                <Bar value={fuelUsed} className="h-1.5 min-w-px flex-1" />
                <span className={cn('type-metadata', dim)}>{fuelUsed}%</span>
              </span>
              <span className={cn('type-metadata px-3', COLUMN[4], dim)}>
                {v.available ? `${v.tripsUsed} of ${v.tripsUsed + v.tripsLeft}` : '—'}
              </span>
              <span className={cn('px-3', COLUMN[5])}>
                <StatusChip tone="neutral">{STATUS[v.status] ?? v.status}</StatusChip>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const COLUMN = ['w-[122px]', 'w-[90px]', 'w-[158px]', 'w-[158px]', 'w-[90px]', 'w-[120px]']

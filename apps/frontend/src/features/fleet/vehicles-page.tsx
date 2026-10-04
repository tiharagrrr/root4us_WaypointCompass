// Figma: A5 Vehicles · 185:9904
import {
  getVehicleFuelFuelQueryOptions,
  useDepotsList,
  useVehiclesList,
  type VehicleDto,
} from '@compass/api-client'
import { keepPreviousData, useQueries } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { HeaderActions } from '@/app/layouts/header-actions'
import {
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUS_TONES,
  VEHICLE_TEMP_LABELS,
  VEHICLE_TYPE_LABELS,
} from '@/features/master-data/master-data-copy'
import { cn } from '@/lib/cn'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { CapacityMeter } from '@/ui/capacity-meter'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableCellStack, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { EditVehicleDialog } from './edit-vehicle-dialog'
import { VehicleStatusDialog } from './vehicle-status-dialog'

const STATUSES = [
  { value: 'all', label: 'Every status' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'WORKSHOP', label: 'In workshop' },
  { value: 'BREAKDOWN', label: 'Broken down' },
] as const

/**
 * The fleet an admin keeps: capacities and fuel figures, who drives what, the
 * status that takes a vehicle out of planning, and this week's fuel against
 * its quota (AC-FLT-06, AC-FLT-07). A status change needs a reason and reaches
 * planning, which offers to repair the plans the vehicle was in.
 */
export function VehiclesPage() {
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const [depotId, setDepotId] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [limit, setLimit] = useState(10)
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<VehicleDto | null>(null)
  const [changingStatus, setChangingStatus] = useState<VehicleDto | null>(null)

  const depots = useDepotsList()
  const vehicles = useVehiclesList(
    {
      limit,
      offset,
      sort: 'code',
      ...(q ? { q } : {}),
      ...(depotId === 'all' ? {} : { 'filter[depotId]': depotId }),
      ...(status === 'all' ? {} : { 'filter[status]': status }),
    },
    { query: { placeholderData: keepPreviousData } },
  )

  const rows = vehicles.data?.data ?? []
  // One small fuel request per row on the page, and only for a caller the row
  // offers the fuel link to (A5 shows this week's litres against the quota).
  const fuel = useQueries({
    queries: rows.map((vehicle) => ({
      ...getVehicleFuelFuelQueryOptions(vehicle.id),
      enabled: Boolean(getLink(vehicle._links, 'fuel')),
    })),
  })
  const busy = !vehicles.isPending && vehicles.isFetching
  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value)
    setOffset(0)
  }

  return (
    <>
      <HeaderActions>
        <Input
          size="sm"
          className="w-60"
          type="search"
          aria-label="Search vehicles"
          placeholder="Search vehicles"
          leading={<Icon name="search" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
        />
        <Select value={depotId} onValueChange={reset(setDepotId)}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Depot">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Every depot</SelectItem>
            {(depots.data?.data ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={reset(setStatus)}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </HeaderActions>

      <p className="type-body m-0 text-muted-foreground">
        A vehicle that is not active leaves planning at once, with the reason beside it. Fuel counts against the weekly quota the engine plans to.
      </p>

      {vehicles.error ? (
        <ErrorState error={vehicles.error} onRetry={() => void vehicles.refetch()} />
      ) : !vehicles.isPending && rows.length === 0 ? (
        <EmptyState
          title={q ? `No vehicle matches “${q}”` : 'No vehicles yet'}
          description={q ? 'Try another code or registration.' : "Vehicles arrive with the seed from the booklet's vehicles.csv."}
        />
      ) : (
        <TableContainer aria-busy={busy || undefined} className={cn(busy && 'opacity-60 transition-opacity')}>
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-[16%]">Vehicle</TableHead>
                <TableHead className="w-[12%]">Kind</TableHead>
                <TableHead className="w-[16%]">Capacity</TableHead>
                <TableHead className="w-[14%]">Driver</TableHead>
                <TableHead className="w-[18%]">Fuel this week</TableHead>
                <TableHead className="w-[14%]">Status</TableHead>
                <TableHead className="w-[150px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {vehicles.isPending
                ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
                : rows.map((vehicle, index) => {
                    const week = fuel[index]?.data?.data
                    return (
                      <TableRow key={vehicle.id}>
                        <TableCell>
                          <TableCellStack primary={vehicle.code} secondary={vehicle.registrationNo} />
                        </TableCell>
                        <TableCell>
                          <TableCellStack
                            primary={VEHICLE_TYPE_LABELS[vehicle.type]}
                            secondary={`${VEHICLE_TEMP_LABELS[vehicle.temp]} · ${vehicle.depotId}`}
                          />
                        </TableCell>
                        <TableCell>
                          <TableCellStack
                            primary={`${vehicle.weightCapKg.toLocaleString('en-GB')} kg`}
                            secondary={`${vehicle.volumeCapM3} m³ · ${vehicle.kmPerL} km/L`}
                          />
                        </TableCell>
                        <TableCell>
                          {vehicle.driver ? vehicle.driver.name : <span className="text-muted-foreground">No driver linked</span>}
                        </TableCell>
                        <TableCell>
                          {week ? (
                            <CapacityMeter label="Fuel" value={week.usedL} limit={week.quotaL} unit="L" />
                          ) : (
                            <span className="type-body text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <StatusChip tone={VEHICLE_STATUS_TONES[vehicle.status]}>{VEHICLE_STATUS_LABELS[vehicle.status]}</StatusChip>
                            {vehicle.statusReason && vehicle.status !== 'ACTIVE' ? (
                              <span className="type-caption text-muted-foreground">{vehicle.statusReason}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Action variant="ghost" size="sm" className="text-slate-700" link={getLink(vehicle._links, 'status')} onAction={() => setChangingStatus(vehicle)}>
                              Status
                            </Action>
                            <Action variant="ghost" size="sm" className="text-slate-700" link={getLink(vehicle._links, 'edit')} onAction={() => setEditing(vehicle)}>
                              Edit
                            </Action>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
            </TableBody>
          </Table>
          {vehicles.data ? (
            <Pagination
              page={vehicles.data.meta.page}
              onOffsetChange={setOffset}
              onLimitChange={(next) => {
                setLimit(next)
                setOffset(0)
              }}
            />
          ) : null}
        </TableContainer>
      )}

      {editing ? <EditVehicleDialog vehicle={editing} onOpenChange={(open) => !open && setEditing(null)} /> : null}
      {changingStatus ? (
        <VehicleStatusDialog vehicle={changingStatus} onOpenChange={(open) => !open && setChangingStatus(null)} />
      ) : null}
    </>
  )
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-[22px] w-16" />
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

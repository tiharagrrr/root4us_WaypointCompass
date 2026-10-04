// Figma: A3 Outlets · 185:9392
import {
  useDepotsList,
  useOutletsList,
  type OutletDto,
} from '@compass/api-client'
import { keepPreviousData } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { HeaderActions } from '@/app/layouts/header-actions'
import { cn } from '@/lib/cn'
import { Action } from '@/ui/action'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { SegmentedControl } from '@/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableCellStack, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { EditOutletDialog } from './edit-outlet-dialog'
import { DOCK_LABELS, PARKING_LABELS } from './master-data-copy'

/** A3's manager filter: every outlet, or only the ones that need a manager. */
type Managed = 'all' | 'false' | 'true'

const MANAGED: readonly { value: Managed; label: string }[] = [
  { value: 'all', label: 'All outlets' },
  { value: 'false', label: 'Needs a manager' },
  { value: 'true', label: 'Has a manager' },
]

const BRANDS = [
  { value: 'all', label: 'Every brand' },
  { value: 'FRESH', label: 'Fresh' },
  { value: 'STYLE', label: 'Style' },
  { value: 'TECH', label: 'Tech' },
] as const

/**
 * The outlets an admin keeps: delivery windows, dock and parking, the
 * receiving contact and the access notes a driver reads on D9. An outlet with
 * no store manager is flagged, because nobody there can place an order
 * (AC-MD-05).
 */
export function OutletsPage() {
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const [brand, setBrand] = useState<string>('all')
  const [depotId, setDepotId] = useState<string>('all')
  const [managed, setManaged] = useState<Managed>('all')
  const [limit, setLimit] = useState(10)
  const [offset, setOffset] = useState(0)
  const [editing, setEditing] = useState<OutletDto | null>(null)

  const depots = useDepotsList()
  // keepPreviousData: a new filter or page keeps the rows on screen, marked
  // busy, instead of blanking the table for the length of a request.
  const outlets = useOutletsList(
    {
      limit,
      offset,
      sort: 'name',
      ...(q ? { q } : {}),
      ...(brand === 'all' ? {} : { 'filter[brand]': brand }),
      ...(depotId === 'all' ? {} : { 'filter[depotId]': depotId }),
      ...(managed === 'all' ? {} : { 'filter[hasManager]': managed }),
    },
    { query: { placeholderData: keepPreviousData } },
  )

  const rows = outlets.data?.data ?? []
  const busy = !outlets.isPending && outlets.isFetching
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
          aria-label="Search outlets"
          placeholder="Search outlets"
          leading={<Icon name="search" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
        />
        <Select value={brand} onValueChange={reset(setBrand)}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Brand">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BRANDS.map((b) => (
              <SelectItem key={b.value} value={b.value}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      </HeaderActions>

      <p className="type-body m-0 text-muted-foreground">
        Windows, docks and access notes travel with every order: the engine plans to them and the driver reads them at the dock.
      </p>
      <SegmentedControl
        aria-label="Manager"
        className="self-start"
        value={managed}
        onValueChange={reset(setManaged)}
        options={MANAGED}
      />

      {outlets.error ? (
        <ErrorState error={outlets.error} onRetry={() => void outlets.refetch()} />
      ) : !outlets.isPending && rows.length === 0 ? (
        <EmptyState
          title={q ? `No outlet matches “${q}”` : managed === 'false' ? 'Every outlet has a manager' : 'No outlets yet'}
          description={
            q
              ? 'Try another name or outlet code.'
              : managed === 'false'
                ? 'Nothing to chase here.'
                : 'Outlets arrive with the seed from the booklet’s outlets.csv.'
          }
        />
      ) : (
        <TableContainer aria-busy={busy || undefined} className={cn(busy && 'opacity-60 transition-opacity')}>
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-[24%]">Outlet</TableHead>
                <TableHead className="w-[14%]">Where</TableHead>
                <TableHead className="w-[16%]">Delivery window</TableHead>
                <TableHead className="w-[18%]">Dock</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead className="w-[110px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {outlets.isPending
                ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={i} />)
                : rows.map((outlet) => (
                    <TableRow key={outlet.id}>
                      <TableCell>
                        <TableCellStack primary={outlet.name} secondary={`${outlet.id} · ${outlet.brand}`} />
                      </TableCell>
                      <TableCell>
                        <TableCellStack primary={outlet.districtId} secondary={outlet.depotId} />
                      </TableCell>
                      <TableCell>
                        <TableCellStack
                          primary={`${outlet.windowOpen}–${outlet.windowClose}`}
                          secondary={outlet.mallWindowOpen ? `Mall ${outlet.mallWindowOpen}–${outlet.mallWindowClose}` : undefined}
                        />
                      </TableCell>
                      <TableCell>
                        <TableCellStack
                          primary={DOCK_LABELS[outlet.dockType]}
                          secondary={PARKING_LABELS[outlet.parkingConstraint]}
                        />
                      </TableCell>
                      <TableCell>
                        {outlet.manager ? (
                          outlet.manager.name
                        ) : (
                          <StatusChip tone="danger">No manager</StatusChip>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Action variant="ghost" size="sm" className="text-slate-700" link={outlet._links.edit} onAction={() => setEditing(outlet)}>
                          Edit
                        </Action>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {outlets.data ? (
            <Pagination
              page={outlets.data.meta.page}
              onOffsetChange={setOffset}
              onLimitChange={(next) => {
                setLimit(next)
                setOffset(0)
              }}
            />
          ) : null}
        </TableContainer>
      )}

      {editing ? <EditOutletDialog outlet={editing} onOpenChange={(open) => !open && setEditing(null)} /> : null}
    </>
  )
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-28" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-32" />
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

// Figma: M7 Deferrals · 185:11685; /store/deferrals/:id opens M4 over it.
import { useDeferralsList, type DeferralDto } from '@compass/api-client'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { usePageHeader } from '@/app/layouts/header-slot'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { Pagination } from '@/ui/pagination'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { dayLabel } from '@/features/ordering/order-format'
import { RESPONSE_CHIP } from './deferral-copy'
import { DeferralNotice } from './deferral-notice'

/**
 * M7: the outlet's deferrals, newest first, each with why and the store's answer. The ones that
 * still wait on the store carry a respond link and lead to M4; repeat skips are marked (the
 * dispatcher needed a note to defer them again).
 */
export function DeferralsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [paging, setPaging] = useState({ limit: 10, offset: 0 })
  const list = useDeferralsList({ ...paging, sort: '-createdAt' })
  const rows = list.data?.data ?? []
  const meta = list.data?.meta.page
  const waiting = rows.filter((d) => getLink(d._links, 'respond')).length
  const repeats = rows.filter((d) => d.repeatSkip).length
  usePageHeader({ eyebrow: 'Deferrals', title: 'Deferrals' })

  const open = (d: DeferralDto) => void navigate(`/store/deferrals/${d.id}`)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Deferred" value={meta?.total ?? rows.length} caption="orders moved to a later run" />
        <Stat label="Repeat skips" value={repeats} caption="deferred on the run before too" danger={repeats > 0} />
        <Stat label="Waiting on you" value={waiting} caption="acknowledge or ask for priority" />
      </div>

      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-[320px] w-full" />
      ) : rows.length === 0 ? (
        <EmptyState title="No deferrals" description="When a run can’t carry one of your orders, it shows here with the reason." />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Moved</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Your response</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => {
                const respond = getLink(d._links, 'respond')
                return (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-[12px] font-bold">
                      #{d.orderNo}
                      {d.repeatSkip ? (
                        <StatusChip tone="danger" className="ml-2">
                          Repeat skip
                        </StatusChip>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-[12px]">
                      {dayLabel(d.fromDate)} → {dayLabel(d.toDate)}
                    </TableCell>
                    <TableCell className="type-body">{d.reasonLabel}</TableCell>
                    <TableCell>
                      <StatusChip tone={respond ? 'danger' : 'neutral'}>{RESPONSE_CHIP[d.storeResponse] ?? d.storeResponse}</StatusChip>
                    </TableCell>
                    <TableCell className="text-right">
                      {respond ? (
                        <Button variant="default" size="sm" onClick={() => open(d)}>
                          View notice
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => open(d)}>
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {meta ? (
            <Pagination
              page={meta}
              onOffsetChange={(offset) => setPaging((p) => ({ ...p, offset }))}
              onLimitChange={(limit) => setPaging({ limit, offset: 0 })}
            />
          ) : null}
        </TableContainer>
      )}
      <p className="type-body-small m-0 text-muted-foreground">A store deferred two runs in a row is flagged to the dispatcher as a repeat skip.</p>

      {id ? <DeferralNotice id={id} onClose={() => void navigate('/store/deferrals')} /> : null}
    </div>
  )
}

function Stat({ label, value, caption, danger }: { label: string; value: number; caption: string; danger?: boolean }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3.5">
      <span className="type-label uppercase text-muted-foreground">{label}</span>
      <span className={`font-sans text-[28px] font-bold leading-tight ${danger ? 'text-status-danger-fg' : 'text-foreground'}`}>{value}</span>
      <span className="type-body-small text-muted-foreground">{caption}</span>
    </section>
  )
}

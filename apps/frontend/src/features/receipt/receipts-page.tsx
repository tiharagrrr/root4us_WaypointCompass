// Figma: M5 Confirm receipt · 185:11384 and M6 Report issue · 185:11543 open over this list, which
// the sidebar's Receipts entry leads to (the frames draw only the per-order dialogs).
import { useIssuesList, useOrdersList, type OrderDto } from '@compass/api-client'
import { useState } from 'react'
import { useMatch, useNavigate, useParams } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { usePageHeader } from '@/app/layouts/header-slot'
import { getLink } from '@/lib/links'
import { Button } from '@/ui/button'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { OrderTimelineDialog } from '@/features/audit/order-timeline-dialog'
import { brandWord } from '@/features/ordering/order-copy'
import { dayLabel } from '@/features/ordering/order-format'
import { ConfirmReceiptDialog } from './confirm-receipt-dialog'
import { IssueDialog } from './issue-dialog'
import { IssuesTable } from './issues-table'
import { ReportIssueDialog } from './report-issue-dialog'

/** Delivered and waiting for the store, and delivered and answered. */
const TO_CONFIRM = 'DELIVERED,PARTIAL'
const CONFIRMED = 'RECEIVED,ISSUE_REPORTED'

type Tab = 'to-confirm' | 'confirmed' | 'issues'

const kind = (o: OrderDto) => `${brandWord(o.brand)} · ${o.tempClass === 'CHILLED' ? 'Chilled' : 'Dry'}`

/**
 * The store's receipts: deliveries waiting to be confirmed (there is no auto-confirm, AC-RCP-06),
 * the ones already answered, and the issues raised. M5 opens over a row, M6 from M5 or directly,
 * and an issue opens its thread.
 */
export function ReceiptsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const reporting = useMatch('/store/orders/:id/issue')
  const issuing = useMatch('/store/issues/:id')
  const [tab, setTab] = useState<Tab>('to-confirm')
  const waiting = useOrdersList({ 'filter[status]': TO_CONFIRM, sort: '-deliveryDate', limit: 25 })
  const answered = useOrdersList({ 'filter[status]': CONFIRMED, sort: '-deliveryDate', limit: 25 })
  const issues = useIssuesList({ limit: 1 })
  usePageHeader({ eyebrow: 'Receipts', title: 'Receipts' })

  const back = () => void navigate('/store/receipts')

  return (
    <div className="flex flex-col gap-4">
      <HeaderActions>
        <SegmentedControl<Tab>
          aria-label="Receipts"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'to-confirm', label: 'To confirm', count: waiting.data?.meta.page.total ?? 0 },
            { value: 'confirmed', label: 'Confirmed', count: answered.data?.meta.page.total ?? 0 },
            { value: 'issues', label: 'Issues', count: issues.data?.meta.page.total ?? 0 },
          ]}
        />
      </HeaderActions>

      {tab === 'issues' ? (
        <IssuesTable
          emptyTitle="No issues"
          emptyDescription="If something is wrong with a delivery, report it from the receipt and it shows here."
          onOpen={(issue) => void navigate(`/store/issues/${issue.id}`)}
        />
      ) : (
        <OrdersTable
          status={tab === 'to-confirm' ? TO_CONFIRM : CONFIRMED}
          confirmed={tab === 'confirmed'}
          onOpen={(order) => void navigate(`/store/orders/${order.id}/receipt`)}
        />
      )}

      {id && reporting ? (
        <ReportIssueDialog orderId={id} onClose={back} />
      ) : id && issuing ? (
        <IssueDialog id={id} onClose={back} />
      ) : id ? (
        <ConfirmReceiptDialog orderId={id} onClose={back} />
      ) : null}
    </div>
  )
}

function OrdersTable({ status, confirmed, onOpen }: { status: string; confirmed: boolean; onOpen: (order: OrderDto) => void }) {
  // The same request as the tab counts, so React Query serves it from the cache.
  const query = useOrdersList({ 'filter[status]': status, sort: '-deliveryDate', limit: 25 })
  const rows = query.data?.data ?? []
  const [timeline, setTimeline] = useState<OrderDto | null>(null)
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (query.isPending) return <Skeleton className="h-[240px] w-full" />
  if (rows.length === 0)
    return (
      <EmptyState
        title={confirmed ? 'Nothing confirmed yet' : 'Nothing to confirm'}
        description={confirmed ? 'Deliveries you confirm show here.' : 'When a delivery reaches you, it waits here until you confirm it.'}
      />
    )
  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Delivered</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <span className="font-mono text-[12px] font-bold text-foreground">#{order.orderNo}</span>
                <span className="type-body ml-2 text-foreground">{kind(order)}</span>
                {order.status === 'ISSUE_REPORTED' ? (
                  <StatusChip tone="danger" className="ml-2">
                    Issue reported
                  </StatusChip>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-[12px]">{dayLabel(order.deliveryDate)}</TableCell>
              <TableCell className="text-right">
                <span className="flex items-center justify-end gap-2">
                  {getLink(order._links, 'timeline') ? (
                    <Button variant="ghost" size="sm" onClick={() => setTimeline(order)}>
                      Timeline
                    </Button>
                  ) : null}
                  <Button variant={confirmed ? 'ghost' : 'default'} size="sm" onClick={() => onOpen(order)}>
                    {confirmed ? 'View' : 'Confirm'}
                  </Button>
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {timeline ? <OrderTimelineDialog orderId={timeline.id} orderNo={timeline.orderNo} onClose={() => setTimeline(null)} /> : null}
    </TableContainer>
  )
}

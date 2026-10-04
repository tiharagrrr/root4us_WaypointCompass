import { useIssuesList, type IssueDto } from '@compass/api-client'
import { useState } from 'react'
import { formatColombo } from '@/lib/format-colombo'
import { Button } from '@/ui/button'
import { Pagination } from '@/ui/pagination'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { ISSUE_STATUS_WORDS, ISSUE_TYPE_WORDS, issueTone, RESOLUTION_WORDS } from './receipt-copy'

export interface IssuesTableProps {
  /** Comma-separated issue statuses to list; every status when left out. */
  status?: string
  emptyTitle: string
  emptyDescription: string
  onOpen: (issue: IssueDto) => void
}

/**
 * The issues the caller may read, newest first: a store's own outlet, a dispatcher's depot. The
 * API applies that scope, so this table never filters by who is asking (AC-RCP-11).
 */
export function IssuesTable({ status, emptyTitle, emptyDescription, onOpen }: IssuesTableProps) {
  const [paging, setPaging] = useState({ limit: 10, offset: 0 })
  const list = useIssuesList({ ...paging, sort: '-createdAt', ...(status ? { 'filter[status]': status } : {}) })
  const rows = list.data?.data ?? []
  const meta = list.data?.meta.page

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  if (list.isPending) return <Skeleton className="h-[240px] w-full" />
  if (rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />

  return (
    <TableContainer>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Problem</TableHead>
            <TableHead>Raised</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((issue) => (
            <TableRow key={issue.id}>
              <TableCell className="font-mono text-[12px] font-bold">#{issue.orderNo ?? '—'}</TableCell>
              <TableCell className="type-body">
                {ISSUE_TYPE_WORDS[issue.type] ?? issue.type}
                {issue.qtyAffected !== null ? ` · ${issue.qtyAffected} affected` : ''}
                <span className="block max-w-[320px] truncate text-muted-foreground">{issue.description}</span>
              </TableCell>
              <TableCell className="font-mono text-[12px]">{formatColombo(issue.createdAt, 'EEE d MMM, HH:mm')}</TableCell>
              <TableCell>
                <StatusChip tone={issueTone(issue.status)}>
                  {ISSUE_STATUS_WORDS[issue.status] ?? issue.status}
                  {issue.resolution ? ` · ${RESOLUTION_WORDS[issue.resolution] ?? issue.resolution}` : ''}
                </StatusChip>
              </TableCell>
              <TableCell className="text-right">
                <Button variant={issue.status === 'RESOLVED' ? 'ghost' : 'default'} size="sm" onClick={() => onOpen(issue)}>
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
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
  )
}

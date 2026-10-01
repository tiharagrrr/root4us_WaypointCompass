// Figma: A1 Users · 185:8751
import {
  getInvitationsListQueryKey,
  getUsersListQueryOptions,
  useInvitationsList,
  useInvitationsResend,
  useInvitationsRevoke,
  useUsersList,
  type InvitationDto,
  type UserDto,
  type UserRole,
} from '@compass/api-client'
import { keepPreviousData, useQueries, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { AdminHeaderActions } from '@/app/layouts/admin-header-actions'
import { cn } from '@/lib/cn'
import { getLink } from '@/lib/links'
import { roleLabel } from '@/lib/roles'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { SegmentedControl } from '@/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableCellStack, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'
import { EditUserDialog } from './edit-user-dialog'
import { InviteUserDialog } from './invite-user-dialog'
import { formatPhone, scopeLabel } from './scope-label'

type Segment = 'all' | Exclude<UserRole, 'admin'>

const SEGMENTS: readonly { value: Segment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'store_manager', label: 'Store managers' },
  { value: 'dispatcher', label: 'Dispatchers' },
  { value: 'loader', label: 'Loaders' },
  { value: 'driver', label: 'Drivers' },
]

/** Invitations A1 lists beside the users: still open, or expired and waiting for a resend. */
const OPEN_INVITATIONS = new Set(['PENDING', 'EXPIRED'])

const PLACEHOLDER_EMAIL = /@(drivers|loaders)\.waypoint\.local$/

/** The second line under a name: the email, or the phone for drivers and loaders without one. */
function contactOf(person: { email: string | null; phoneNumber: string | null }): string {
  if (person.email && !PLACEHOLDER_EMAIL.test(person.email)) return person.email
  return person.phoneNumber ? formatPhone(person.phoneNumber) : (person.email ?? '')
}

export function UsersPage() {
  const queryClient = useQueryClient()
  const [segment, setSegment] = useState<Segment>('all')
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search.trim())
  const [limit, setLimit] = useState(10)
  const [offset, setOffset] = useState(0)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<UserDto | null>(null)

  const role = segment === 'all' ? undefined : segment
  // keepPreviousData: switching tab or page keeps the rows on screen, marked busy, instead of
  // blanking the table for the length of a request.
  const keepRows = { query: { placeholderData: keepPreviousData } } as const
  const users = useUsersList(
    { limit, offset, sort: 'name', ...(q ? { q } : {}), ...(role ? { 'filter[role]': role } : {}) },
    keepRows,
  )
  const invitations = useInvitationsList({ limit: 100, sort: '-createdAt', ...(q ? { q } : {}) }, keepRows)
  const counts = useQueries({
    queries: SEGMENTS.map((s) =>
      getUsersListQueryOptions({ limit: 1, ...(s.value === 'all' ? {} : { 'filter[role]': s.value }) }),
    ),
  })
  const resend = useInvitationsResend()
  const revoke = useInvitationsRevoke()

  const openInvitations = (invitations.data?.data ?? []).filter(
    (i) => OPEN_INVITATIONS.has(i.status) && (!role || i.role === role),
  )
  const create = getLink(invitations.data?._links, 'create')
  const changeSegment = (next: Segment) => {
    setSegment(next)
    setOffset(0)
  }
  const refreshInvitations = () => queryClient.invalidateQueries({ queryKey: getInvitationsListQueryKey() })

  const isPending = users.isPending || invitations.isPending
  /** Rows are on screen but a newer page or filter is still loading. */
  const busy = !isPending && (users.isFetching || invitations.isFetching)
  const error = users.error ?? invitations.error
  const nothing = !isPending && !error && users.data?.data.length === 0 && openInvitations.length === 0

  return (
    <>
      <AdminHeaderActions>
        <Input
          size="sm"
          className="w-60"
          type="search"
          aria-label="Search users"
          placeholder="Search users"
          leading={<Icon name="search" />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
        />
        <Select value={segment} onValueChange={(v) => changeSegment(v as Segment)}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEGMENTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.value === 'all' ? 'All roles' : s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {create ? (
          <Button variant="primary" onClick={() => setInviting(true)}>
            {create.title ?? 'Invite user'}
          </Button>
        ) : null}
      </AdminHeaderActions>

      <p className="type-body m-0 text-muted-foreground">Every user is scoped to an outlet, depot or vehicle. They only see data for that scope.</p>
      <SegmentedControl
        aria-label="Role"
        className="self-start"
        value={segment}
        onValueChange={changeSegment}
        options={SEGMENTS.map((s, i) => ({ ...s, count: counts[i]?.data?.meta.page.total }))}
      />

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void users.refetch()
            void invitations.refetch()
          }}
        />
      ) : nothing ? (
        <EmptyState
          title={q ? `No one matches “${q}”` : 'No users yet'}
          description={q ? 'Try another name or email.' : 'Invite a store manager, dispatcher, loader or driver.'}
        />
      ) : (
        <TableContainer aria-busy={busy || undefined} className={cn(busy && 'opacity-60 transition-opacity')}>
          <Table>
            <TableHeader>
              <tr>
                <TableHead className="w-[26%]">Name</TableHead>
                <TableHead className="w-[16%]">Role</TableHead>
                <TableHead>Linked to</TableHead>
                <TableHead className="w-[140px]">Status</TableHead>
                <TableHead className="w-[150px]">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {isPending
                ? Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} />)
                : null}
              {!isPending
                ? openInvitations.map((invitation) => (
                    <InvitationRow
                      key={invitation.id}
                      invitation={invitation}
                      onResend={async ({ headers }) => {
                        await resend.mutateAsync({ id: invitation.id, headers: { 'Idempotency-Key': headers['Idempotency-Key'] } })
                        await refreshInvitations()
                        toast({ title: `Invite sent again to ${invitation.name}`, tone: 'success' })
                      }}
                      onRevoke={async () => {
                        await revoke.mutateAsync({ id: invitation.id })
                        await refreshInvitations()
                        toast({ title: `Invitation to ${invitation.name} withdrawn` })
                      }}
                    />
                  ))
                : null}
              {!isPending
                ? users.data?.data.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <TableCellStack primary={user.name} secondary={contactOf(user)} />
                      </TableCell>
                      <TableCell>{roleLabel(user.role)}</TableCell>
                      <TableCell>{scopeLabel(user)}</TableCell>
                      <TableCell>
                        {user.banned ? <StatusChip tone="muted">Deactivated</StatusChip> : <StatusChip>Active</StatusChip>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Action variant="ghost" size="sm" className="text-slate-700" link={user._links.edit} onAction={() => setEditing(user)}>
                          Edit
                        </Action>
                      </TableCell>
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
          {users.data ? (
            <Pagination
              page={users.data.meta.page}
              onOffsetChange={setOffset}
              onLimitChange={(next) => {
                setLimit(next)
                setOffset(0)
              }}
            />
          ) : null}
        </TableContainer>
      )}

      <InviteUserDialog open={inviting} onOpenChange={setInviting} />
      {editing ? <EditUserDialog user={editing} onOpenChange={(open) => !open && setEditing(null)} /> : null}
    </>
  )
}

interface InvitationRowProps {
  invitation: InvitationDto
  onResend: (ctx: { headers: Record<string, string> }) => Promise<void>
  onRevoke: () => Promise<void>
}

/** A pending or expired invitation, as A1 shows it among the users. */
function InvitationRow({ invitation, onResend, onRevoke }: InvitationRowProps) {
  const expired = invitation.status === 'EXPIRED'
  return (
    <TableRow>
      <TableCell>
        <TableCellStack primary={invitation.name} secondary={contactOf(invitation)} />
      </TableCell>
      <TableCell>{roleLabel(invitation.role)}</TableCell>
      <TableCell>{scopeLabel(invitation)}</TableCell>
      <TableCell>
        <StatusChip tone={expired ? 'danger' : 'neutral'}>{expired ? 'Invite expired' : 'Invite sent'}</StatusChip>
      </TableCell>
      <TableCell className="text-right">
        {expired ? (
          <Action variant="outline" size="sm" link={invitation._links.resend} onAction={onResend}>
            Resend invite
          </Action>
        ) : (
          <Action
            variant="ghost"
            size="sm"
            className="text-slate-700"
            link={invitation._links.revoke}
            confirm={{ title: `Withdraw the invitation to ${invitation.name}?`, description: 'Their link stops working.', confirmLabel: 'Withdraw' }}
            onAction={onRevoke}
          >
            Revoke
          </Action>
        )}
      </TableCell>
    </TableRow>
  )
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-32" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-48" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-[22px] w-16" />
      </TableCell>
      <TableCell />
    </TableRow>
  )
}

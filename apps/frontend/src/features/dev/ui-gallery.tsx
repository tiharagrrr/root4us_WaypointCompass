// Development only (/dev/ui): every Compass component in src/ui, built from the A1, A2 and A6
// frames, for side-by-side checks with Figma. Not linked from the app and not in production builds.
import { useState } from 'react'
import { AdminHeaderActions } from '@/app/layouts/admin-header-actions'
import { Action } from '@/ui/action'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { DemoTimeBadge } from '@/ui/demo-time-badge'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from '@/ui/dialog'
import { Field } from '@/ui/field'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { QuantityStepper } from '@/ui/quantity-stepper'
import { RadioCards } from '@/ui/radio-cards'
import { SegmentedControl } from '@/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { StatusChip } from '@/ui/status-chip'
import { Switch } from '@/ui/switch'
import { Table, TableBody, TableCell, TableCellStack, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'
import { EmptyState, ErrorState } from '@/ui/states'
import { ApiProblem } from '@compass/api-client'

const rows = [
  { name: 'Nimesha Periyapperuma', contact: 'nimesha.p@waypoint.lk', role: 'Store manager', linked: 'Outlet · Fresh Kadawatha', status: 'ACTIVE', expired: false },
  { name: 'Pradeep Kumara', contact: '+94 76 903 1182', role: 'Driver', linked: 'Vehicle · REF-03 · WP CAR-5521', status: 'INVITE EXPIRED', expired: true },
  { name: 'Fathima Nazeer', contact: 'fathima.n@waypoint.lk', role: 'Store manager', linked: 'Outlet · Style Colombo 07', status: 'INVITE SENT', expired: false },
]

const problem = ApiProblem.from(503, 'Service Unavailable', {
  title: 'The planning engine is busy',
  detail: 'Try again in 30 seconds.',
  code: 'DEPENDENCY_UNAVAILABLE',
  requestId: '0192a3f5-1b2c-7d3e-8f4a-5b6c7d8e9f0a',
})

export function UiGallery() {
  const [segment, setSegment] = useState<'all' | 'store' | 'dispatch' | 'load' | 'drive'>('all')
  const [role, setRole] = useState<'store_manager' | 'dispatcher' | 'loader' | 'driver'>('store_manager')
  const [channel, setChannel] = useState<'email' | 'sms'>('sms')
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(10)
  const [packs, setPacks] = useState(5)

  return (
    <div className="flex flex-col gap-6">
      <AdminHeaderActions>
        <Input size="sm" className="w-60" placeholder="Search users" leading={<Icon name="search" />} />
        <Select defaultValue="all">
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="driver">Drivers</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="primary">Invite user</Button>
      </AdminHeaderActions>

      <p className="type-body m-0 text-muted-foreground">Every user is scoped to an outlet, depot or vehicle. They only see data for that scope.</p>
      <SegmentedControl
        aria-label="Role"
        value={segment}
        onValueChange={setSegment}
        options={[
          { value: 'all', label: 'All', count: 42 },
          { value: 'store', label: 'Store managers', count: 18 },
          { value: 'dispatch', label: 'Dispatchers', count: 3 },
          { value: 'load', label: 'Loaders', count: 7 },
          { value: 'drive', label: 'Drivers', count: 14 },
        ]}
      />

      <TableContainer>
        <Table>
          <TableHeader>
            <tr>
              <TableHead className="w-[315px]">Name</TableHead>
              <TableHead className="w-[197px]">Role</TableHead>
              <TableHead>Linked to</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[150px]" />
            </tr>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.name}>
                <TableCell>
                  <TableCellStack primary={r.name} secondary={r.contact} />
                </TableCell>
                <TableCell>{r.role}</TableCell>
                <TableCell>{r.linked}</TableCell>
                <TableCell>
                  <StatusChip tone={r.expired ? 'danger' : 'neutral'}>{r.status}</StatusChip>
                </TableCell>
                <TableCell className="text-right">
                  {r.expired ? (
                    <Action variant="outline" size="sm" link={{ href: '/api/v1/invitations/i1/resend', method: 'POST', title: 'Resend invite' }} onAction={() => toast({ title: 'Invite sent again', tone: 'success' })} />
                  ) : (
                    <Action variant="ghost" size="sm" className="text-slate-700" link={{ href: '/api/v1/users/u1', method: 'PATCH', title: 'Edit' }} onAction={() => undefined} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination
          page={{ limit, offset, total: 42 }}
          onOffsetChange={setOffset}
          onLimitChange={(n) => {
            setLimit(n)
            setOffset(0)
          }}
        />
      </TableContainer>

      <div className="flex flex-wrap items-center gap-4">
        <QuantityStepper label="Sugar 1 kg" value={packs} onValueChange={setPacks} />
        <QuantityStepper label="Fresh milk 1 L" value={1} min={1} onValueChange={() => undefined} />
        <QuantityStepper label="Ceylon tea 400 g" value={4} onValueChange={() => undefined} disabled />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary">Publish plan</Button>
        <Button>Assign</Button>
        <Button variant="secondary">Duplicate</Button>
        <Button variant="outline">Export</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Remove stop</Button>
        <Button variant="link">View log</Button>
        <Button variant="primary" loading>
          Publishing…
        </Button>
        <Button variant="outline" size="sm">
          Re-sequence
        </Button>
        <Button variant="outline" size="icon" aria-label="Notifications">
          <Icon name="bell" size={18} />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['neutral', 'muted', 'info', 'success', 'warning', 'danger', 'at-risk'] as const).map((tone) => (
          <StatusChip key={tone} tone={tone}>
            {tone}
          </StatusChip>
        ))}
        {(['neutral', 'muted', 'info', 'success', 'warning', 'danger'] as const).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
        <DemoTimeBadge serverTime="2026-10-01T10:25:00Z" shifted={false} />
        <DemoTimeBadge serverTime="2026-10-01T10:25:00Z" shifted />
      </div>

      <div className="grid max-w-[880px] grid-cols-2 gap-6">
        <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
          <Field label="Full name">{(control) => <Input {...control} defaultValue="Tharushi Madushani" />}</Field>
          <Field label="Email or phone" error="Enter a phone in +94 format or an email">
            {(control) => <Input {...control} placeholder="+94 77 … or name@waypoint.lk" />}
          </Field>
          <RadioCards
            aria-label="Role"
            value={role}
            onValueChange={setRole}
            options={[
              { value: 'store_manager', label: 'Store manager' },
              { value: 'dispatcher', label: 'Dispatcher' },
              { value: 'loader', label: 'Loader' },
              { value: 'driver', label: 'Driver' },
            ]}
          />
          <Field label="Link to" hint="Scopes what this person can see.">
            {(control) => (
              <Select defaultValue="OUT021">
                <SelectTrigger {...control}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OUT021">Outlet · Fresh Ja-Ela</SelectItem>
                  <SelectItem value="OUT014">Outlet · Fresh Kadawatha</SelectItem>
                </SelectContent>
              </Select>
            )}
          </Field>
          <SegmentedControl aria-label="Send invite by" value={channel} onValueChange={setChannel} options={[{ value: 'email', label: 'Email' }, { value: 'sms', label: 'SMS' }]} />
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Switch defaultChecked aria-label="Split chilled orders" />
            <Switch aria-label="Off" />
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader title="Invite user" description="They get a link to set a password. Access is limited to what you link them to." />
              <DialogBody>
                <Field label="Full name">{(control) => <Input {...control} />}</Field>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button variant="primary">Send invite</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Action
            variant="destructive"
            link={{ href: '/api/v1/users/u1/deactivate', method: 'POST', title: 'Deactivate' }}
            confirm={{ title: 'Deactivate Nimesha?', description: 'They can no longer sign in.' }}
            onAction={() => toast({ title: 'Nimesha deactivated', description: 'They can no longer sign in.' })}
          />
          <Skeleton className="h-8 w-60" />
          <ErrorState error={problem} onRetry={() => undefined} />
          <EmptyState title="No invitations yet" description="Invite a store manager, dispatcher, loader or driver." />
        </div>
      </div>
    </div>
  )
}

// Figma: A6 Settings · 185:10227 (Security; the frame draws no dock-tablet rows, so they follow its list items)
import {
  getDeviceId,
  getDevicesListQueryKey,
  isApiProblem,
  useDevicesClearDock,
  useDevicesList,
  useDevicesSetDock,
  useUsersScopeOptions,
  type AdminDeviceDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatColombo } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Pagination } from '@/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { toast } from '@/ui/toast-store'
import { SettingRow } from './setting-row'

const PAGE_SIZE = 10

/**
 * Registered devices, and which depot each dock tablet serves. Only a dock tablet of a depot lets
 * that depot's loaders sign in with a PIN (L1). Devices register themselves when the app opens.
 *
 * A page at a time, and a row shows its depot picker only while it is being changed: a picker on
 * every row costs more to render than the whole rest of A6.
 */
export function DockTabletsSection() {
  const [offset, setOffset] = useState(0)
  const devices = useDevicesList({ limit: PAGE_SIZE, offset, sort: '-lastSeenAt' })
  const depots = useUsersScopeOptions()
  const [editing, setEditing] = useState<string | null>(null)

  if (devices.isPending)
    return (
      <SettingRow title="Dock tablets" description="Loading devices…">
        <Skeleton className="h-9 w-[200px]" />
      </SettingRow>
    )
  if (devices.error)
    return (
      <SettingRow title="Dock tablets" description="Devices did not load.">
        <span />
      </SettingRow>
    )
  if (devices.data.data.length === 0)
    return (
      <EmptyState
        title="No devices yet"
        description="Sign in on the dock tablet once with an email and password; it registers itself and appears here, and you can mark it as that depot’s dock tablet."
      />
    )

  return (
    <>
      {devices.data.data.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          depots={depots.data?.data.depots ?? []}
          editing={editing === device.id}
          onEdit={(open) => setEditing(open ? device.id : null)}
        />
      ))}
      <Pagination
        className="border-t border-border"
        page={devices.data.meta.page}
        onOffsetChange={(next) => {
          setEditing(null)
          setOffset(next)
        }}
      />
    </>
  )
}

interface DeviceRowProps {
  device: AdminDeviceDto
  depots: { id: string; name: string }[]
  editing: boolean
  onEdit: (open: boolean) => void
}

function DeviceRow({ device, depots, editing, onEdit }: DeviceRowProps) {
  const queryClient = useQueryClient()
  const setDock = useDevicesSetDock()
  const clearDock = useDevicesClearDock()
  const [depotId, setDepotId] = useState(device.depotId ?? '')
  const [error, setError] = useState<string | null>(null)
  const name = device.label ?? device.id
  const depotName = depots.find((d) => d.id === device.depotId)?.name

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError(null)
    try {
      await action()
      await queryClient.invalidateQueries({ queryKey: getDevicesListQueryKey() })
    } catch (e) {
      setError(isApiProblem(e) ? (e.errors[0]?.message ?? e.detail ?? e.title) : 'That did not work. Try again.')
      throw e
    }
    onEdit(false)
    toast({ title: done, tone: 'success' })
  }

  const seen = device.lastSeenAt ? `last seen ${formatColombo(device.lastSeenAt, 'EEE d MMM HH:mm')}` : 'never seen'
  const dock = getLink(device._links, 'dock')
  // The browser the admin is using right now, so making this very tablet a dock is one click.
  const thisDevice = device.id === getDeviceId()
  return (
    <SettingRow
      title={name}
      description={
        <>
          {device.platform} · {seen}
          {thisDevice ? <StatusChip tone="info" className="ml-2">This device</StatusChip> : null}
          {device.isDockDevice ? <StatusChip className="ml-2">{`Dock · ${depotName ?? device.depotId}`}</StatusChip> : null}
        </>
      }
      error={error ?? undefined}
    >
      {!dock ? null : editing ? (
        <div className="flex items-center gap-2">
          <Select value={depotId} onValueChange={setDepotId}>
            <SelectTrigger size="sm" className="w-[160px]" aria-label={`Depot for ${name}`}>
              <SelectValue placeholder="Choose a depot" />
            </SelectTrigger>
            <SelectContent>
              {depots.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Action
            variant="outline"
            size="sm"
            link={dock}
            disabled={!depotId}
            onAction={() => run(() => setDock.mutateAsync({ id: device.id, data: { depotId } }), `${name} is a dock tablet now`)}
          >
            Save
          </Action>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onEdit(true)}>
            {device.isDockDevice ? 'Change depot' : 'Use as dock tablet'}
          </Button>
          <Action
            variant="ghost"
            size="sm"
            link={device._links.undock}
            onAction={() => run(() => clearDock.mutateAsync({ id: device.id }), `${name} is no longer a dock tablet`)}
          >
            Stop
          </Action>
        </div>
      )}
    </SettingRow>
  )
}

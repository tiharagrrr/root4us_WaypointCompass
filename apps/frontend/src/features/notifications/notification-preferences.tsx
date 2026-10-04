import {
  getNotificationPreferencesListQueryKey,
  useNotificationPreferencesList,
  useNotificationPreferencesResumeEmail,
  useNotificationPreferencesUpdate,
  type NotificationPreferenceDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { getLink, isLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { Switch } from '@/ui/switch'

type Channel = NotificationPreferenceDto['channels'][number]

const CHANNEL_LABELS: Record<Channel, string> = {
  IN_APP: 'In the app',
  EMAIL: 'Email',
  SMS: 'SMS',
  PUSH: 'Push',
}

/** Why a channel the event uses is not offered to this person. */
const UNAVAILABLE: Partial<Record<Channel, string>> = {
  EMAIL: 'No email address on your account',
  SMS: 'No verified phone number',
  PUSH: 'Push is not set up on this device',
}

/**
 * The person's own notification channels, one card per event that reaches their role (D12 on the
 * phone, 02's Settings on the desktop). In the app is the record of everything and stays on; a
 * channel they can't receive says why instead of offering a switch. Each switch saves at once
 * through the row's `update` link.
 */
export function NotificationPreferences({ touch = false }: { touch?: boolean }) {
  const qc = useQueryClient()
  const prefs = useNotificationPreferencesList()
  const refresh = () => qc.invalidateQueries({ queryKey: getNotificationPreferencesListQueryKey() })
  const update = useNotificationPreferencesUpdate({ mutation: { onSuccess: () => void refresh() } })
  const resume = useNotificationPreferencesResumeEmail({ mutation: { onSuccess: () => void refresh() } })

  if (prefs.isPending)
    return (
      <div className="flex flex-col gap-3" aria-label="Loading notification settings">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    )
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} />

  const sheet = prefs.data.data
  if (sheet.items.length === 0) return <EmptyState title="Nothing to set" description="No notifications reach your role yet." />

  const toggle = (item: NotificationPreferenceDto, channel: Channel, on: boolean) => {
    const next = on ? [...item.channels, channel] : item.channels.filter((c) => c !== channel)
    update.mutate({ eventType: item.eventType, data: { channels: next.filter((c) => c !== 'IN_APP') } })
  }

  return (
    <div className="flex flex-col gap-3">
      {sheet.emailSuppressed ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-3">
          <p className="type-body m-0 text-foreground">
            Email is off: a message to your address bounced or was marked as spam. Check your address, then turn it back on.
          </p>
          <div>
            <Action link={getLink(sheet._links, 'resumeEmail')} size="sm" variant="outline" onAction={() => resume.mutateAsync()} />
          </div>
          {resume.isError ? <ErrorState error={resume.error} /> : null}
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {sheet.items.map((item) => (
          <li key={item.eventType} aria-label={item.label} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
            <div className="flex flex-col gap-0.5">
              <span className="type-body-strong text-foreground">{item.label}</span>
              {item.example ? <span className="type-caption text-muted-foreground">{item.example}</span> : null}
            </div>
            <div className="flex flex-col">
              {item.defaults.map((channel) => {
                const available = item.available.includes(channel)
                const on = item.channels.includes(channel)
                const id = `pref-${item.eventType}-${channel}`
                return (
                  <div key={channel} className={cn('flex items-center justify-between gap-3 border-t border-border first:border-t-0', touch ? 'min-h-11 py-1' : 'py-2')}>
                    <label htmlFor={id} className="flex flex-col">
                      <span className="type-body text-foreground">{CHANNEL_LABELS[channel]}</span>
                      {channel === 'IN_APP' ? (
                        <span className="type-caption text-muted-foreground">Always on</span>
                      ) : !available ? (
                        <span className="type-caption text-muted-foreground">{UNAVAILABLE[channel]}</span>
                      ) : null}
                    </label>
                    <Switch
                      id={id}
                      checked={on}
                      disabled={channel === 'IN_APP' || !available || !isLink(getLink(item._links, 'update')) || update.isPending}
                      onCheckedChange={(next) => toggle(item, channel, next)}
                    />
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      {update.isError ? <ErrorState error={update.error} /> : null}
    </div>
  )
}

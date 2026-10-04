// Figma: 02 Notifications · 185:12422
import {
  getMyNotificationsListQueryKey,
  getMyNotificationsSummaryQueryKey,
  useMyNotificationsList,
  useMyNotificationsRead,
  useMyNotificationsReadAll,
  useMyNotificationsSummary,
  type NotificationDto,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/cn'
import { formatColombo, toColomboDate } from '@/lib/format-colombo'
import { getLink, isLink } from '@/lib/links'
import { useServerClock } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { CountBadge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'

type Tab = 'all' | 'unread' | 'stores'

/** What a store sends the dispatcher; the "Stores" tab. */
const FROM_STORES = new Set(['deferral.store_responded', 'issue.reported', 'issue.resolved'])
/** Red dot: something is going wrong right now. Everything else is blue. */
const URGENT = new Set(['load.flag_raised', 'trip.cant_run', 'alert.raised'])

/**
 * The 02 bell: the badge, and a panel of the signed-in person's in-app notifications, newest
 * first, grouped by day. Opening a line marks it read (its `read` link) and goes to where it
 * points; "Mark all read" shows while the summary carries its link. New notifications arrive
 * over the event stream (notification.created), which refetches both queries.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const summary = useMyNotificationsSummary()
  const unread = summary.data?.data.unread ?? 0

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative flex size-9 cursor-pointer items-center justify-center rounded-md border border-slate-300 bg-background text-slate-700 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-slate-100"
        >
          <Icon name="bell" size={18} />
          {unread ? <CountBadge className="absolute left-[22px] top-[-6px]">{unread}</CountBadge> : null}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 flex max-h-[min(760px,calc(100vh-96px))] w-[420px] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none"
        >
          <NotificationPanel unread={unread} summaryLinks={summary.data?.data._links} onClose={() => setOpen(false)} />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

interface NotificationPanelProps {
  unread: number
  summaryLinks: unknown
  onClose: () => void
}

export function NotificationPanel({ unread, summaryLinks, onClose }: NotificationPanelProps) {
  const [tab, setTab] = useState<Tab>('all')
  const qc = useQueryClient()
  const list = useMyNotificationsList({ limit: 50 })
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: getMyNotificationsListQueryKey().slice(0, 1) }),
      qc.invalidateQueries({ queryKey: getMyNotificationsSummaryQueryKey() }),
    ])
  const readAll = useMyNotificationsReadAll({ mutation: { onSuccess: () => void refresh() } })

  const items = list.data?.data ?? []
  const stores = items.filter((n) => FROM_STORES.has(n.eventType))
  const shown = tab === 'unread' ? items.filter((n) => !n.readAt) : tab === 'stores' ? stores : items

  return (
    <>
      <div className="flex items-center justify-between gap-3 px-[18px] pb-3 pt-4">
        <div className="flex items-baseline gap-2">
          <h2 className="type-card-title m-0 text-foreground">Notifications</h2>
          {unread ? <span className="type-label uppercase text-muted-foreground">{unread} unread</span> : null}
        </div>
        <div className="flex items-center gap-1">
          <Action
            link={getLink(summaryLinks, 'readAll')}
            variant="link"
            size="sm"
            loading={readAll.isPending}
            onAction={() => readAll.mutateAsync()}
          >
            Mark all read
          </Action>
          <Button variant="ghost" size="icon" aria-label="Close notifications" onClick={onClose}>
            <Icon name="close" size={16} />
          </Button>
        </div>
      </div>
      <div className="border-b border-border px-[18px] pb-3">
        <SegmentedControl<Tab>
          aria-label="Show"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'all', label: 'All', count: items.length },
            { value: 'unread', label: 'Unread', count: items.filter((n) => !n.readAt).length },
            { value: 'stores', label: 'Stores', count: stores.length },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <div className="flex flex-col gap-3 p-[18px]" aria-label="Loading notifications">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState className="m-[18px]" error={list.error} onRetry={() => void list.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState
            title={tab === 'unread' ? "You're all caught up" : 'No notifications yet'}
            description="Plans, deferrals, flags and deliveries that need you will show here."
          />
        ) : (
          <NotificationGroups items={shown} onOpened={onClose} onRead={refresh} />
        )}
      </div>
    </>
  )
}

function NotificationGroups({ items, onOpened, onRead }: { items: NotificationDto[]; onOpened: () => void; onRead: () => unknown }) {
  const { now } = useServerClock(60_000)
  const today = toColomboDate(now)
  const yesterday = toColomboDate(new Date(now.getTime() - 86_400_000))
  const groups = new Map<string, NotificationDto[]>()
  for (const item of items) {
    const day = toColomboDate(item.createdAt)
    const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : formatColombo(item.createdAt, 'EEE d MMM')
    groups.set(label, [...(groups.get(label) ?? []), item])
  }

  return (
    <div className="flex flex-col">
      {[...groups].map(([label, rows]) => (
        <section key={label} aria-label={label}>
          <p className="type-label m-0 px-[18px] pb-1 pt-3 uppercase text-muted-foreground">{label}</p>
          <ul className="m-0 list-none p-0">
            {rows.map((item) => (
              <NotificationLine key={item.id} item={item} onOpened={onOpened} onRead={onRead} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function NotificationLine({ item, onOpened, onRead }: { item: NotificationDto; onOpened: () => void; onRead: () => unknown }) {
  const navigate = useNavigate()
  const read = useMyNotificationsRead({ mutation: { onSuccess: () => void onRead() } })
  const readLink = getLink(item._links, 'read')
  const unread = !item.readAt

  const open = () => {
    if (isLink(readLink)) read.mutate({ id: item.id } as Parameters<typeof read.mutate>[0])
    if (item.link) {
      onOpened()
      void navigate(item.link)
    }
  }

  return (
    <li aria-label={item.title} className="flex gap-3 border-b border-border px-[18px] py-3 last:border-b-0">
      <span
        aria-hidden="true"
        className={cn('mt-[7px] size-2 shrink-0 rounded-full', unread ? (URGENT.has(item.eventType) ? 'bg-status-danger-icon' : 'bg-status-info-icon') : 'bg-transparent')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          {/* Only urgent lines carry an "Open" button (the frame); on the rest the title opens it. */}
          {item.link && !URGENT.has(item.eventType) ? (
            <button
              type="button"
              onClick={open}
              className={cn(
                'm-0 cursor-pointer rounded-sm p-0 text-left text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/40',
                unread ? 'type-body-strong' : 'type-body',
              )}
            >
              {item.title}
              {unread ? <span className="sr-only"> (unread)</span> : null}
            </button>
          ) : (
            <p className={cn('m-0 text-foreground', unread ? 'type-body-strong' : 'type-body')}>
              {item.title}
              {unread ? <span className="sr-only"> (unread)</span> : null}
            </p>
          )}
          <time className="type-mono-small shrink-0 text-muted-foreground" dateTime={item.createdAt}>
            {formatColombo(item.createdAt, 'HH:mm')}
          </time>
        </div>
        <p className="type-body m-0 text-slate-600">{item.body}</p>
        {item.link && URGENT.has(item.eventType) ? (
          <div className="pt-1">
            <Button size="sm" variant="outline" onClick={open}>
              Open
            </Button>
          </div>
        ) : !item.link && isLink(readLink) ? (
          <div className="pt-1">
            <Action link={readLink} size="sm" variant="outline" onAction={() => read.mutateAsync({ id: item.id } as Parameters<typeof read.mutateAsync>[0])} />
          </div>
        ) : null}
      </div>
    </li>
  )
}

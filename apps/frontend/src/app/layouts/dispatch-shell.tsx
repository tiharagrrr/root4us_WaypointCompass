// Figma: 03 Order queue · 185:12856 (the dispatcher chrome: sidebar, depot switch, demo-time
// badge and the frame 02 bell)
import { useClockGet, useMeGet } from '@compass/api-client'
import { DEPOTS, DEPOT_NAMES, type Depot } from '@waypoint/shared/domain'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useServerClock } from '@/lib/server-clock'
import { DemoTimeBadge } from '@/ui/demo-time-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { DepotContext, isDepot } from './depot-context'
import type { ShellNavItem } from './desktop-shell'
import { DesktopShell } from './desktop-shell'

/**
 * The dispatcher's shell (01 to 23). A dispatcher scoped to one depot sees only that depot; one
 * who covers them all starts at Peliyagoda and switches in the header, as GET / does for the
 * landing links.
 */
export function DispatchShell() {
  const { t } = useTranslation()
  const me = useMeGet()
  const clock = useClockGet({ query: { refetchInterval: 15_000 } })
  const { now } = useServerClock(5_000)
  const [picked, setPicked] = useState<Depot | null>(null)

  const home = me.data?.data.depotId
  const options = useMemo<readonly Depot[]>(() => (isDepot(home) ? [home] : DEPOTS), [home])
  const depot = picked ?? options[0] ?? DEPOTS[0]

  const nav = useMemo<ShellNavItem[]>(
    () => [
      { to: '/dispatch', label: t('nav.dashboard'), icon: 'dashboard' },
      { to: '/dispatch/orders', label: t('nav.orderQueue'), icon: 'orders' },
      { to: '/dispatch/plan', label: t('nav.plan'), icon: 'plan', deep: true },
      { to: '/dispatch/tracking', label: t('nav.tracking'), icon: 'tracking' },
      { to: '/dispatch/forecast', label: t('nav.forecast'), icon: 'forecast' },
      { to: '/dispatch/deferrals', label: t('nav.deferrals'), icon: 'deferrals' },
    ],
    [t],
  )

  const demo = clock.data?.data
  // A frozen clock shows its own time; a shifted one keeps running from the last serverTime.
  const shown = demo?.mode === 'frozen' && demo.at ? demo.at : now.toISOString()

  return (
    <DepotContext.Provider value={{ depot, setDepot: setPicked }}>
      <DesktopShell
        navLabel={t('nav.dispatch', { depot: DEPOT_NAMES[depot].toUpperCase() })}
        nav={nav}
        eyebrow={`Dispatch · ${DEPOT_NAMES[depot]}`}
        title={t('nav.dashboard')}
        headerLead={
          <Select value={depot} onValueChange={(value) => isDepot(value) && setPicked(value)}>
            <SelectTrigger size="sm" aria-label={t('shell.depot')} className="w-[148px]" disabled={options.length < 2}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((id) => (
                <SelectItem key={id} value={id}>
                  {DEPOT_NAMES[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        headerStatus={demo?.shifted ? <DemoTimeBadge serverTime={shown} shifted /> : null}
      />
    </DepotContext.Provider>
  )
}

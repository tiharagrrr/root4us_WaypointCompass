import { useClockGet, useUsersList } from '@compass/api-client'
import { useServerClock } from '@/lib/server-clock'
import { DemoTimeBadge } from '@/ui/demo-time-badge'
import { AdminLayout } from './admin-layout'

/**
 * AdminLayout with live header data: the "Demo time Thu 15:55" badge whenever the demo clock is
 * not real time (AC-IDN-53 to 55), and the users count beside Users. Outlets, depots and vehicles
 * get counts when master data and fleet publish their lists.
 */
export function AdminShell() {
  const clock = useClockGet({ query: { refetchInterval: 15_000 } })
  const users = useUsersList({ limit: 1 })
  const { now } = useServerClock(5_000)
  const demo = clock.data?.data
  // A frozen clock shows its own time; a shifted one keeps running from the last serverTime.
  const shown = demo?.mode === 'frozen' && demo.at ? demo.at : now.toISOString()
  return (
    <AdminLayout
      headerStatus={demo?.shifted ? <DemoTimeBadge serverTime={shown} shifted /> : null}
      navCounts={users.data ? { users: users.data.meta.page.total } : {}}
    />
  )
}

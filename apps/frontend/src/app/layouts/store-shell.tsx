import { useClockGet, useItemsList, useOrdersList } from '@compass/api-client'
import { useServerClock } from '@/lib/server-clock'
import { DemoTimeBadge } from '@/ui/demo-time-badge'
import { STORE_OPEN_ORDERS } from '@/features/ordering/open-orders-query'
import { StoreLayout } from './store-layout'

/**
 * StoreLayout with live header and nav data: the outlet this terminal stands in, the open orders
 * count beside Orders, the catalog size, and the "Demo time Thu 15:55" badge while the demo clock
 * is not real time. The orders query is the one M1 uses, so the shell costs no extra request.
 */
export function StoreShell() {
  const clock = useClockGet({ query: { refetchInterval: 15_000 } })
  const orders = useOrdersList(STORE_OPEN_ORDERS)
  const items = useItemsList({ 'filter[active]': 'true', limit: 1 })
  const { now } = useServerClock(5_000)
  const demo = clock.data?.data
  // A frozen clock shows its own time; a shifted one keeps running from the last serverTime.
  const shown = demo?.mode === 'frozen' && demo.at ? demo.at : now.toISOString()
  return (
    <StoreLayout
      outletName={orders.data?.data[0]?.outlet.name}
      navCounts={{
        ...(orders.data ? { orders: orders.data.meta.page.total } : {}),
        ...(items.data ? { catalog: items.data.meta.page.total } : {}),
      }}
      headerStatus={demo?.shifted ? <DemoTimeBadge serverTime={shown} shifted /> : null}
    />
  )
}

// Figma: M1 New order · 185:10376 (M1b chilled order · 228:970, M2 Cutoff passed · 185:10649)
import {
  getOrderLinesListQueryKey,
  getOrdersListQueryKey,
  getOrderTemplatesListQueryKey,
  useOrderLinesAdd,
  useOrderLinesList,
  useOrderLinesReplace,
  useOrderLinesUpdate,
  useMeGet,
  useOrdersCreate,
  useOrdersList,
  useOutletsGet,
  useOrdersSubmit,
  useOrderTemplatesList,
  type ItemDto,
  type OrderDto,
  type OrderLineDto,
  type OrderTemplateDto,
  type TempClass,
  isApiProblem,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { addDays, WEEKDAYS } from '@waypoint/shared'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { HeaderActions } from '@/app/layouts/header-actions'
import { toColomboDate } from '@/lib/format-colombo'
import { getLink } from '@/lib/links'
import { useServerClock } from '@/lib/server-clock'
import { Action } from '@/ui/action'
import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { toast } from '@/ui/toast-store'
import { AddItemsDialog } from './add-items-dialog'
import { OrderLinesTable } from './order-lines-table'
import { sendLabel } from './order-copy'
import { OrderSummaryCard } from './order-summary-card'
import { OrderSwitcher } from './order-switcher'
import { classLabel, classLabelInline, dayLabel, openDayOf } from './order-format'
import { STORE_OPEN_ORDERS } from './open-orders-query'
import { PresetField } from './preset-field'
import { SavePresetDialog } from './save-preset-dialog'

/** How far ahead a store may place an order, in days from today. */
const ORDER_AHEAD_DAYS = 14

const isDate = (value: string | null): value is string => value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * M1 New order. A day holds one order per class, so the same screen is M1b once the dry order
 * is sent, and M2 once the server has rolled an order to the following run. Everything that
 * changes between those frames comes from the order the API returns.
 *
 * The store picks the delivery day (tomorrow to two weeks ahead, `?date=`) and starts the day's
 * dry or chilled order itself; a day with no order yet offers only that.
 */
export function NewOrderPage() {
  const queryClient = useQueryClient()
  const { now } = useServerClock(1000)
  const [params, setParams] = useSearchParams()
  const [picking, setPicking] = useState(false)
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)

  const orders = useOrdersList(STORE_OPEN_ORDERS)

  const today = toColomboDate(now)
  const picked = params.get('date')
  const day = isDate(picked) ? picked : openDayOf(orders.data?.data ?? [], now)
  const dayOrders = (orders.data?.data ?? []).filter((o) => o.requestedDate === day)

  // Chilled is a Fresh range (AC-ORD-11), and a Style outlet has one delivery weekday (AC-ORD-08).
  const outletId = useMeGet().data?.data.outletId ?? ''
  const outlet = useOutletsGet(outletId, { query: { enabled: outletId !== '' } }).data?.data
  const classes: TempClass[] = outlet?.brand === 'FRESH' ? ['AMBIENT', 'CHILLED'] : ['AMBIENT']
  const startable = getLink(orders.data?._links, 'create')
    ? classes.filter((tempClass) => !dayOrders.some((order) => order.tempClass === tempClass))
    : []
  // M1b is M1 with ?class=chilled; without it the day's first order (the dry one) is open.
  const wanted = params.get('class')
  const wantedClass = wanted === 'chilled' ? 'CHILLED' : wanted === 'dry' ? 'AMBIENT' : null
  const selected =
    (wantedClass ? dayOrders.find((order) => order.tempClass === wantedClass) : undefined) ?? dayOrders[0] ?? null

  const lines = useOrderLinesList(selected?.id ?? '', { query: { enabled: Boolean(selected) } })
  const templates = useOrderTemplatesList(
    { 'filter[tempClass]': selected?.tempClass ?? 'AMBIENT', limit: 50 },
    { query: { enabled: Boolean(selected) } },
  )

  const addLine = useOrderLinesAdd()
  const updateLine = useOrderLinesUpdate()
  const replaceLines = useOrderLinesReplace()
  const submit = useOrdersSubmit()
  const create = useOrdersCreate()
  const busy = addLine.isPending || updateLine.isPending || replaceLines.isPending

  /** A failed write says so where the store manager is looking, with the problem's own words. */
  const report = (error: unknown): void => {
    const problem = isApiProblem(error) ? error : undefined
    toast({
      title: problem?.title ?? 'That did not go through',
      description: problem?.detail ?? 'Check your connection and try again.',
      tone: 'danger',
    })
  }

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getOrdersListQueryKey() }),
      selected
        ? queryClient.invalidateQueries({ queryKey: getOrderLinesListQueryKey(selected.id) })
        : Promise.resolve(),
    ])

  /** The address keeps the picked day and class, so a reload opens the same order. */
  const show = (date: string | null, tempClass: TempClass | null) => {
    setParams({ ...(date ? { date } : {}), ...(tempClass === 'CHILLED' ? { class: 'chilled' } : {}) }, { replace: true })
  }

  const select = (order: OrderDto) => show(isDate(picked) ? picked : null, order.tempClass)

  /** Opens the day's order for a class: an empty draft the store then fills and sends. */
  const start = async (tempClass: TempClass) => {
    try {
      await create.mutateAsync({
        data: { tempClass, requestedDate: day },
        headers: { 'Idempotency-Key': globalThis.crypto.randomUUID() },
      })
    } catch (error) {
      report(error)
      return
    }
    await refresh()
    show(day, tempClass)
  }

  /**
   * Adds the picked items one line at a time. Each response carries the order's new version, so
   * the next add sends a current If-Match instead of a stale one (AC-ORD-14).
   */
  const addItems = async (picks: readonly { item: ItemDto; qty: number }[]) => {
    if (!selected) return
    let version = selected.version
    try {
      for (const pick of picks) {
        const res = await addLine.mutateAsync({
          orderId: selected.id,
          data: { itemId: pick.item.id, qty: pick.qty },
          headers: { 'If-Match': `W/"${version}"` },
        })
        version = res.data.version
      }
    } catch (error) {
      report(error)
      await refresh()
      throw error
    }
    await refresh()
    toast({
      title: picks.length === 1 ? '1 item added' : `${picks.length} items added`,
      description: `On the ${classLabelInline(selected.tempClass)} for ${dayLabel(selected.deliveryDate)}.`,
      tone: 'success',
    })
  }

  const changeQty = async (line: OrderLineDto, qty: number) => {
    if (!selected) return
    try {
      await updateLine.mutateAsync({
        orderId: selected.id,
        lineId: line.id,
        data: { qty },
        headers: { 'If-Match': `W/"${selected.version}"` },
      })
      await refresh()
    } catch (error) {
      report(error)
      await refresh()
    }
  }

  const applyPreset = async (template: OrderTemplateDto) => {
    if (!selected) return
    setPresetOpen(false)
    try {
      await replaceLines.mutateAsync({
        orderId: selected.id,
        data: { lines: template.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })) },
        headers: { 'If-Match': `W/"${selected.version}"` },
      })
      await refresh()
      toast({ title: `Preset “${template.name}” loaded`, description: `${template.lines.length} items on the order.`, tone: 'success' })
    } catch (error) {
      report(error)
    }
  }

  const send = async (headers: Record<string, string>) => {
    if (!selected) return
    let res
    try {
      res = await submit.mutateAsync({
        id: selected.id,
        headers: { 'If-Match': headers['If-Match'], 'Idempotency-Key': headers['Idempotency-Key'] },
      })
    } catch (error) {
      report(error)
      await refresh()
      throw error
    }
    await refresh()
    const rolled = res.meta.notices?.find((notice) => notice.code === 'ORDER_ROLLED_TO_NEXT_RUN')
    toast({
      title: `${classLabel(res.data.tempClass)} sent · #${res.data.orderNo}`,
      description: rolled ? rolled.message : `On the run for ${dayLabel(res.data.deliveryDate)}.`,
      tone: rolled ? 'neutral' : 'success',
    })
    // M1b: the day's other order is where the store goes next.
    const next = dayOrders.find((o) => o.id !== selected.id && o.status === 'DRAFT')
    if (next) select(next)
  }

  if (orders.error) {
    return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
  }

  return (
    <>
      <HeaderActions>
        <Button variant="outline" onClick={() => setPresetOpen(true)} disabled={!selected}>
          Load a saved preset
        </Button>
        <Action
          variant="ghost"
          className="text-slate-700"
          link={selected ? getLink(selected._links, 'saveAsTemplate') : undefined}
          onAction={() => setSavingPreset(true)}
        >
          Save as preset
        </Action>
      </HeaderActions>

      {/* Side by side at the frame's 1440; below it the summary, then the lines, wrap under. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-full shrink-0 flex-col gap-2 md:w-[240px]">
          <label className="flex flex-col gap-1.5">
            <span className="type-label uppercase text-muted-foreground">Delivery day</span>
            <Input
              type="date"
              value={day}
              min={addDays(today, 1)}
              max={addDays(today, ORDER_AHEAD_DAYS)}
              aria-label="Delivery day"
              onChange={(event) => event.target.value && show(event.target.value, null)}
            />
          </label>
          {outlet?.styleDeliveryDow != null ? (
            <p className="type-caption m-0 text-muted-foreground">
              This outlet takes deliveries on {WEEKDAYS[outlet.styleDeliveryDow]}s.
            </p>
          ) : null}
          <OrderSwitcher
            day={day}
            orders={dayOrders}
            selectedId={selected?.id ?? null}
            onSelect={select}
            loading={orders.isPending}
            startable={startable}
            onStart={(tempClass) => void start(tempClass)}
            starting={create.isPending}
          />
          {selected ? (
            <PresetField
              templates={templates.data?.data ?? []}
              value={selected.templateId}
              onApply={(template) => void applyPreset(template)}
              open={presetOpen}
              onOpenChange={setPresetOpen}
              loading={templates.isPending}
              canApply={Boolean(getLink(selected._links, 'setLines'))}
            />
          ) : null}
        </div>

        {orders.isPending ? (
          <>
            <Skeleton className="h-[347px] min-w-0 flex-1 basis-[420px] rounded-lg" />
            <Skeleton className="h-[528px] w-full rounded-lg sm:w-[320px]" />
          </>
        ) : !selected ? (
          <EmptyState
            className="min-w-0 flex-1 basis-[420px]"
            title={`No order for ${dayLabel(day)} yet`}
            description={
              startable.length > 0
                ? 'Start the day’s order, add items, then send it before the cutoff.'
                : 'Pick another delivery day to see its orders.'
            }
          />
        ) : (
          <>
            <OrderLinesTable
              order={selected}
              orders={dayOrders}
              lines={lines.data?.data.lines ?? []}
              loading={lines.isPending}
              busy={busy}
              onChangeQty={(line, qty) => void changeQty(line, qty)}
              action={
                <Action link={getLink(selected._links, 'addLine')} onAction={() => setPicking(true)}>
                  <Icon name="plus" size={18} />
                  Add item
                </Action>
              }
            />
            <OrderSummaryCard
              order={selected}
              orders={dayOrders}
              now={now}
              action={
                <Action
                  variant="primary"
                  size="lg"
                  className="w-full"
                  link={getLink(selected._links, 'submit')}
                  version={selected.version}
                  onAction={({ headers }) => send(headers)}
                >
                  {sendLabel(selected)}
                </Action>
              }
            />
          </>
        )}
      </div>

      {lines.error ? <ErrorState error={lines.error} onRetry={() => void lines.refetch()} /> : null}

      {selected ? (
        <>
          <AddItemsDialog
            open={picking}
            onOpenChange={setPicking}
            order={selected}
            lines={lines.data?.data.lines ?? []}
            onAdd={addItems}
          />
          <SavePresetDialog
            open={savingPreset}
            onOpenChange={setSavingPreset}
            order={selected}
            onSaved={() => queryClient.invalidateQueries({ queryKey: getOrderTemplatesListQueryKey() })}
          />
        </>
      ) : null}
    </>
  )
}

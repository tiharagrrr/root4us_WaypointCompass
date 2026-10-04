// Figma: M9 Item catalog · 238:825
import {
  getOrderLinesListQueryKey,
  getOrdersListQueryKey,
  isApiProblem,
  useItemsList,
  useMeGet,
  useOrderLinesAdd,
  useOrdersList,
  useOutletsGet,
  type ItemDto,
  type OrderDto,
  type TempClass,
} from '@compass/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useState } from 'react'
import { usePageHeader } from '@/app/layouts/header-slot'
import { getLink } from '@/lib/links'
import { Action } from '@/ui/action'
import { Input } from '@/ui/input'
import { Pagination } from '@/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { StatusChip } from '@/ui/status-chip'
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from '@/ui/table'
import { toast } from '@/ui/toast-store'
import { brandWord } from './order-copy'
import { classLabelInline, dayLabel, kg, m3 } from './order-format'
import { STORE_OPEN_ORDERS } from './open-orders-query'

const ALL = 'ALL'
type ClassFilter = typeof ALL | TempClass

const matches = (item: ItemDto, q: string) => {
  const needle = q.trim().toLowerCase()
  return needle === '' || item.name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle)
}

/**
 * M9: the range this outlet orders from. One request holds a brand's whole range (50 Fresh items),
 * so the search, the two filters, the counts in the banner and the paging all work on the page in
 * hand. Add puts one pack on the outlet's open order of the item's class, the earliest day first,
 * and shows only while such an order carries its `addLine` link.
 */
export function ItemCatalogPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const q = useDeferredValue(search)
  const [category, setCategory] = useState(ALL)
  const [tempClass, setTempClass] = useState<ClassFilter>(ALL)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(10)
  usePageHeader({ eyebrow: 'Item catalog', title: 'Item catalog' })

  // The outlet's brand decides the range, so the items wait for it rather than load twice.
  const me = useMeGet()
  const outletId = me.data?.data.outletId ?? ''
  const outletRead = useOutletsGet(outletId, { query: { enabled: outletId !== '' } })
  const outlet = outletRead.data?.data
  const settled = outletId === '' ? !me.isPending : !outletRead.isPending
  const items = useItemsList(
    {
      ...(outlet ? { 'filter[brand]': outlet.brand } : {}),
      'filter[active]': 'true',
      sort: 'name',
      limit: 200,
    },
    { query: { enabled: settled } },
  )
  const open = useOrdersList(STORE_OPEN_ORDERS)
  const addLine = useOrderLinesAdd()

  const all = items.data?.data ?? []
  const categories = [...new Set(all.map((item) => item.category))].sort()
  const shown = all.filter(
    (item) => matches(item, q) && (category === ALL || item.category === category) && (tempClass === ALL || item.tempClass === tempClass),
  )
  const rows = shown.slice(offset, offset + limit)
  const dry = all.filter((item) => item.tempClass === 'AMBIENT').length
  const chilled = all.length - dry

  /** The open order an item would go on: the earliest day's order of its class that still takes lines. */
  const targetOf = (item: ItemDto): OrderDto | undefined =>
    (open.data?.data ?? []).find((order) => order.tempClass === item.tempClass && getLink(order._links, 'addLine'))

  /** Another search or filter starts at the first page again. */
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value)
      setOffset(0)
    }

  const add = async (item: ItemDto, order: OrderDto) => {
    try {
      await addLine.mutateAsync({
        orderId: order.id,
        data: { itemId: item.id, qty: 1 },
        headers: { 'If-Match': `W/"${order.version}"` },
      })
      toast({
        title: `${item.name} added`,
        description: `1 pack on the ${classLabelInline(order.tempClass)} for ${dayLabel(order.deliveryDate)}.`,
        tone: 'success',
      })
    } catch (error) {
      const problem = isApiProblem(error) ? error : undefined
      toast({
        title: problem?.title ?? 'That did not go through',
        description: problem?.detail ?? 'Check your connection and try again.',
        tone: 'danger',
      })
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getOrdersListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getOrderLinesListQueryKey(order.id) }),
    ])
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          aria-label="Search items or SKU"
          placeholder="Search items or SKU"
          className="w-full sm:w-[280px]"
          onChange={(event) => reset(setSearch)(event.target.value)}
        />
        <Select value={category} onValueChange={reset(setCategory)}>
          <SelectTrigger aria-label="Category" size="sm" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tempClass} onValueChange={(v) => reset(setTempClass)(v as ClassFilter)}>
          <SelectTrigger aria-label="Storage" size="sm" className="w-auto gap-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Dry and chilled</SelectItem>
            <SelectItem value="AMBIENT">Dry</SelectItem>
            <SelectItem value="CHILLED">Chilled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {outlet && all.length > 0 ? (
        <p className="type-body m-0 rounded-lg border border-status-info-border bg-accent px-3.5 py-2.5 text-foreground">
          {outlet.name} orders from the Waypoint {brandWord(outlet.brand)} range: {all.length} items
          {chilled > 0 ? `, ${dry} dry and ${chilled} chilled` : ''}. Outlets of the other brands only see their own range.
        </p>
      ) : null}

      {items.isError ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : items.isPending ? (
        <Skeleton className="h-[480px] w-full" />
      ) : shown.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? 'No items in the range yet' : 'No item matches'}
          description={all.length === 0 ? 'Items show here once the catalog is loaded.' : 'Try another name, SKU, category or storage.'}
        />
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Pack</TableHead>
                <TableHead>Weight · volume</TableHead>
                <TableHead>Order</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const target = targetOf(item)
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex flex-col gap-px">
                        <span className="type-body-medium text-foreground">{item.name}</span>
                        <span className="type-metadata text-muted-foreground">{item.sku}</span>
                      </div>
                    </TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{item.packLabel}</TableCell>
                    <TableCell className="type-metadata text-slate-700">
                      {kg(item.unitWeightKg)} kg · {m3(item.unitVolumeM3)} m³
                    </TableCell>
                    <TableCell>
                      <StatusChip tone="neutral">{item.tempClass === 'CHILLED' ? 'CHILLED' : 'DRY'}</StatusChip>
                    </TableCell>
                    <TableCell className="text-right">
                      <Action
                        link={target ? getLink(target._links, 'addLine') : undefined}
                        variant="ghost"
                        size="sm"
                        aria-label={`Add ${item.name}`}
                        onAction={() => (target ? add(item, target) : undefined)}
                      >
                        Add
                      </Action>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            page={{ limit, offset, total: shown.length }}
            onOffsetChange={setOffset}
            onLimitChange={(next) => {
              setLimit(next)
              setOffset(0)
            }}
          />
        </TableContainer>
      )}

      <p className="type-caption m-0 text-muted-foreground">
        Add puts one pack of the item in the open dry or chilled order. With no order open, start one on New order first.
      </p>
    </div>
  )
}

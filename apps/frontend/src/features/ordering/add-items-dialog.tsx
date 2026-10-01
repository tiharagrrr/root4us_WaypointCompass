// Figma: M1a Add item · 232:813
import type { ItemDto, OrderDto, OrderLineDto } from '@compass/api-client'
import { useItemsList } from '@compass/api-client'
import { useDeferredValue, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/ui/button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/ui/dialog'
import { Icon } from '@/ui/icon'
import { Input } from '@/ui/input'
import { QuantityStepper } from '@/ui/quantity-stepper'
import { SegmentedControl } from '@/ui/segmented-control'
import { Skeleton } from '@/ui/skeleton'
import { EmptyState, ErrorState } from '@/ui/states'
import { brandWord, otherClassSentence, pickedLine } from './order-copy'
import { classLabelInline, kg } from './order-format'

/** One pack of each item is what Add starts with; the stepper takes it from there. */
const FIRST_QTY = 1

export interface AddItemsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: OrderDto
  /** Lines already on the order: those items show their quantity instead of a control. */
  lines: readonly OrderLineDto[]
  /** Adds the chosen packs, one line each, and closes when they are all on the order. */
  onAdd: (picks: readonly { item: ItemDto; qty: number }[]) => Promise<void>
}

/**
 * The item picker. It lists the brand's range for this order's class only: chilled items belong
 * to the chilled order, which is why the footer says so.
 */
export function AddItemsDialog({ open, onOpenChange, order, lines, onAdd }: AddItemsDialogProps) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [picks, setPicks] = useState<Record<string, number>>({})
  const [adding, setAdding] = useState(false)
  const q = useDeferredValue(search.trim().toLowerCase())

  // One page holds a brand's whole range (50 Fresh items), so the search and the category counts
  // are instant and M1a needs no request per keystroke.
  const items = useItemsList(
    {
      'filter[tempClass]': order.tempClass,
      'filter[brand]': order.brand,
      'filter[active]': 'true',
      sort: 'name',
      limit: 100,
    },
    { query: { enabled: open } },
  )

  const all = items.data?.data
  const onOrder = new Map(lines.map((line) => [line.itemId, line.qty]))
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of all ?? []) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [all])

  const shown = (all ?? []).filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      (q === '' || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)),
  )

  const chosen = (all ?? []).filter((item) => picks[item.id] !== undefined)
  const close = () => {
    setPicks({})
    setSearch('')
    setCategory('all')
    onOpenChange(false)
  }

  const submit = async () => {
    setAdding(true)
    try {
      await onAdd(chosen.map((item) => ({ item, qty: picks[item.id] ?? FIRST_QTY })))
      close()
    } catch {
      // The screen has shown the problem; the pick stays so it can be tried again.
    } finally {
      setAdding(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="w-[462px]">
        <DialogHeader
          title={`Add items to ${classLabelInline(order.tempClass)}`}
          description={`Waypoint ${brandWord(order.brand)} range · ${order.tempClass.toLowerCase()} items only`}
        />
        <DialogBody>
          <Input
            size="sm"
            type="search"
            aria-label="Search by name or SKU"
            placeholder="Search by name or SKU"
            leading={<Icon name="search" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {categories.length > 0 ? (
            <SegmentedControl
              aria-label="Category"
              className="self-start"
              value={category}
              onValueChange={setCategory}
              options={[
                { value: 'all', label: 'All', count: all?.length ?? 0 },
                ...categories.map(([name, count]) => ({ value: name, label: name, count })),
              ]}
            />
          ) : null}

          {items.error ? (
            <ErrorState error={items.error} onRetry={() => void items.refetch()} />
          ) : items.isPending ? (
            <ItemsSkeleton />
          ) : shown.length === 0 ? (
            <EmptyState
              title={q ? `No items match “${search.trim()}”` : 'No items in this category'}
              description="Try another name, SKU or category."
            />
          ) : (
            <div className="flex max-h-[320px] flex-col overflow-y-auto rounded-lg border border-border bg-background">
              {shown.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  inOrder={onOrder.get(item.id)}
                  qty={picks[item.id]}
                  onAdd={() => setPicks((p) => ({ ...p, [item.id]: FIRST_QTY }))}
                  onQty={(next) =>
                    setPicks((p) =>
                      next < 1
                        ? Object.fromEntries(Object.entries(p).filter(([id]) => id !== item.id))
                        : { ...p, [item.id]: next },
                    )
                  }
                />
              ))}
            </div>
          )}

          <p className="type-caption m-0 text-muted-foreground">
            {pickedLine(chosen, picks)} {otherClassSentence(order.tempClass)}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={adding}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={chosen.length === 0} loading={adding}>
            {chosen.length === 1 ? 'Add 1 item' : `Add ${chosen.length} items`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ItemRowProps {
  item: ItemDto
  /** Packs of this item already on the order, if any. */
  inOrder?: number
  /** Packs chosen in this dialog, if any. */
  qty?: number
  onAdd: () => void
  onQty: (next: number) => void
}

function ItemRow({ item, inOrder, qty, onAdd, onQty }: ItemRowProps) {
  const chosen = qty !== undefined
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-border px-[14px] py-2.5 last:border-b-0',
        chosen && 'bg-accent',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-body-medium truncate text-foreground">{item.name}</span>
        <span className="type-metadata truncate text-muted-foreground">
          {item.sku} · {item.packLabel} · {kg(item.unitWeightKg)} kg
        </span>
      </div>
      {inOrder !== undefined ? (
        <span className="type-metadata shrink-0 text-muted-foreground">In order · {inOrder}</span>
      ) : chosen ? (
        <QuantityStepper label={item.name} value={qty} min={0} onValueChange={onQty} />
      ) : (
        <Button variant="outline" size="sm" onClick={onAdd}>
          Add
        </Button>
      )}
    </div>
  )
}

function ItemsSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border px-[14px] py-2.5 last:border-b-0">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-44" />
          </div>
          <Skeleton className="h-8 w-14" />
        </div>
      ))}
    </div>
  )
}

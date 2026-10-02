import type { OrderDto, OrderLineDto, OrderTemplateDto } from '@compass/api-client'
import { HttpResponse, http, type HttpHandler } from 'msw'
import { formatColombo } from '@/lib/format-colombo'
import { mockNow, setMockNow } from './demo-clock'
import { DELIVERY_WINDOW, ITEMS, OUTLET, type DemoItem } from './ordering-demo-data'

/**
 * A working Ordering API for development, until the real endpoints land (then their paths go in
 * live.ts and these handlers stop being reached). It keeps the day's two orders in memory so M1,
 * M1a, M1b and M2 behave: adding an item changes the totals, sending one marks it SENT, and a
 * send after 16:00 rolls the order to the following run with the ORDER_ROLLED_TO_NEXT_RUN notice.
 *
 * Only the screens' own slice is served. Everything else under /api/v1 still comes from the
 * generated OpenAPI-example mocks.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100
const colomboDate = (at: Date): string => formatColombo(at, 'yyyy-MM-dd')
const colomboIso = (at: Date): string => `${formatColombo(at, "yyyy-MM-dd'T'HH:mm:ss")}+05:30`
const startOfDay = (date: string): Date => new Date(`${date}T00:00:00+05:30`)
const addDays = (date: string, days: number): string =>
  colomboDate(new Date(startOfDay(date).getTime() + days * 86_400_000))

/** The cutoff the demo runs to: 16:00 Colombo on the day the order is for (ordering.cutoffMin). */
const cutoffOf = (date: string): string => `${date}T16:00:00+05:30`

interface DemoLine {
  id: string
  itemId: string
  qty: number
}

interface DemoOrder {
  id: string
  orderNo: string
  tempClass: 'AMBIENT' | 'CHILLED'
  status: 'DRAFT' | 'SUBMITTED'
  requestedDate: string
  submittedAt: string | null
  templateId: string | null
  version: number
  lines: DemoLine[]
}

interface World {
  day: string
  orders: DemoOrder[]
  templates: OrderTemplateDto[]
  nextLineId: number
  nextOrderNo: number
}

const itemOf = (itemId: string): DemoItem | undefined => ITEMS.find((i) => i.id === itemId)

const templateLines = (lines: readonly DemoLine[]) =>
  lines.flatMap((line) => {
    const item = itemOf(line.itemId)
    return item ? [{ itemId: item.id, sku: item.sku, name: item.name, packLabel: item.packLabel, qty: line.qty }] : []
  })

/** The day's two orders, as the store manager left them: both drafts, dry first. */
function build(day: string): World {
  const linesFor = (tempClass: 'AMBIENT' | 'CHILLED'): DemoLine[] =>
    ITEMS.filter((item) => item.tempClass === tempClass && item.startQty !== undefined).map((item, index) => ({
      id: `0192c000-0000-7000-8000-${tempClass === 'AMBIENT' ? '1' : '2'}00000000${index}`,
      itemId: item.id,
      qty: item.startQty as number,
    }))

  const dry = linesFor('AMBIENT')
  return {
    day,
    nextLineId: 1,
    nextOrderNo: 232,
    orders: [
      {
        id: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e',
        orderNo: 'WF-0231',
        tempClass: 'AMBIENT',
        status: 'DRAFT',
        requestedDate: day,
        submittedAt: null,
        templateId: null,
        version: 1,
        lines: dry,
      },
      {
        id: '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0f',
        orderNo: 'WF-0232',
        tempClass: 'CHILLED',
        status: 'DRAFT',
        requestedDate: day,
        submittedAt: null,
        templateId: null,
        version: 1,
        lines: linesFor('CHILLED'),
      },
    ],
    templates: [
      {
        id: '0192a3f4-0000-7000-8000-00000000c001',
        name: 'Weekday top-up',
        tempClass: 'AMBIENT',
        lines: templateLines(dry.slice(0, 3)),
        createdAt: colomboIso(new Date('2026-09-28T09:12:00+05:30')),
        _links: { self: { href: '/api/v1/order-templates/0192a3f4-0000-7000-8000-00000000c001' } },
      },
    ],
  }
}

let world = build(colomboDate(mockNow()))

/** Rebuilds the day when the demo clock moves to another date, so the screen is never stale. */
function current(): World {
  const day = colomboDate(mockNow())
  if (day !== world.day) world = build(day)
  return world
}

const lineDto = (order: DemoOrder, line: DemoLine, editable: boolean): OrderLineDto | null => {
  const item = itemOf(line.itemId)
  if (!item) return null
  const self = `/api/v1/orders/${order.id}/lines/${line.id}`
  return {
    id: line.id,
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    packLabel: item.packLabel,
    qty: line.qty,
    unitWeightKg: item.unitWeightKg,
    unitVolumeM3: item.unitVolumeM3,
    weightKg: round2(line.qty * item.unitWeightKg),
    volumeM3: round2(line.qty * item.unitVolumeM3),
    available: true,
    _links: editable
      ? {
          edit: { href: self, method: 'PATCH', title: 'Change the quantity', requires: ['If-Match'] },
          remove: { href: self, method: 'DELETE', title: 'Remove the item', requires: ['If-Match'] },
        }
      : {},
  }
}

const linesOf = (order: DemoOrder, now: Date): OrderLineDto[] =>
  order.lines.flatMap((line) => {
    const dto = lineDto(order, line, isEditable(order, now))
    return dto ? [dto] : []
  })

/** A draft stays editable past the cutoff; a sent order locks at it (AC-ORD-03, AC-ORD-15). */
const isEditable = (order: DemoOrder, now: Date): boolean =>
  order.status === 'DRAFT' || now < new Date(cutoffOf(order.requestedDate))

function orderDto(order: DemoOrder, now: Date): OrderDto {
  const lines = linesOf(order, now)
  const editableUntil = cutoffOf(order.requestedDate)
  const afterCutoff = now >= new Date(editableUntil)
  const self = `/api/v1/orders/${order.id}`
  const editable = isEditable(order, now)
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    tempClass: order.tempClass,
    brand: 'FRESH',
    requestedDate: order.requestedDate,
    deliveryDate: afterCutoff ? addDays(order.requestedDate, 1) : order.requestedDate,
    afterCutoff,
    urgent: false,
    totals: {
      lines: lines.length,
      units: lines.reduce((sum, line) => sum + line.qty, 0),
      weightKg: round2(lines.reduce((sum, line) => sum + line.weightKg, 0)),
      volumeM3: round2(lines.reduce((sum, line) => sum + line.volumeM3, 0)),
      valueLkr: null,
    },
    outlet: OUTLET,
    deliveryWindow: DELIVERY_WINDOW,
    note: null,
    templateId: order.templateId,
    submittedAt: order.submittedAt,
    cancelledAt: null,
    cancelReason: null,
    editableUntil,
    version: order.version,
    _links: {
      self: { href: self },
      lines: { href: `${self}/lines` },
      timeline: { href: `/api/v1/timelines/order/${order.id}` },
      ...(order.status === 'DRAFT'
        ? { submit: { href: `${self}/submit`, method: 'POST', title: 'Send order', requires: ['If-Match'] } }
        : {}),
      ...(editable
        ? {
            addLine: { href: `${self}/lines`, method: 'POST', title: 'Add item', requires: ['If-Match'] },
            setLines: { href: `${self}/lines`, method: 'PUT', title: 'Replace the lines', requires: ['If-Match'] },
          }
        : {}),
      ...(lines.length > 0
        ? { saveAsTemplate: { href: `${self}/save-as-template`, method: 'POST', title: 'Save as preset' } }
        : {}),
    },
  }
}

const meta = (now: Date, extra: Record<string, unknown> = {}) => ({
  requestId: globalThis.crypto.randomUUID(),
  serverTime: colomboIso(now),
  apiVersion: '1.0.0',
  ...extra,
})

const envelope = (data: unknown, now: Date, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ data, meta: meta(now, extra) })

const page = (items: unknown[], now: Date) =>
  HttpResponse.json({
    data: items,
    meta: { ...meta(now), page: { limit: 10, offset: 0, total: items.length } },
    _links: { self: { href: '/api/v1' } },
  })

const problem = (status: number, code: string, title: string, detail?: string) =>
  HttpResponse.json(
    { type: `https://compass.waypoint.lk/problems/${code.toLowerCase().replaceAll('_', '-')}`, title, status, code, detail, instance: '/api/v1', requestId: globalThis.crypto.randomUUID() },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )

const find = (id: string): DemoOrder | undefined => current().orders.find((order) => order.id === id)

/** The If-Match rule, so the screens are exercised against it before the API enforces it. */
function checkVersion(request: Request, order: DemoOrder): Response | null {
  const header = request.headers.get('if-match')
  if (!header) return problem(428, 'PRECONDITION_REQUIRED', 'This change needs the version you loaded')
  const version = Number(/^W\/"(\d+)"$/.exec(header)?.[1])
  if (version !== order.version) {
    return problem(412, 'VERSION_MISMATCH', 'Someone changed this order', 'Reload the order and try again.')
  }
  return null
}

const touched = (order: DemoOrder): void => {
  order.version += 1
}

export const orderingDemoHandlers = (): HttpHandler[] => [
  http.get('*/api/v1/items', () => {
    const now = mockNow()
    const items = ITEMS.map((item) => ({ ...item, startQty: undefined, _links: { self: { href: `/api/v1/items/${item.id}` } } }))
    return page(items, now)
  }),

  http.get('*/api/v1/order-templates', ({ request }) => {
    const now = mockNow()
    const tempClass = new URL(request.url).searchParams.get('filter[tempClass]')
    const templates = current().templates.filter((t) => !tempClass || t.tempClass === tempClass)
    return page(templates, now)
  }),

  http.get('*/api/v1/orders', ({ request }) => {
    const now = mockNow()
    const status = new URL(request.url).searchParams.get('filter[status]')?.split(',')
    const orders = current()
      .orders.filter((order) => !status || status.includes(order.status))
      .map((order) => orderDto(order, now))
      .sort((a, b) => a.requestedDate.localeCompare(b.requestedDate) || a.tempClass.localeCompare(b.tempClass))
    return page(orders, now)
  }),

  http.get('*/api/v1/orders/:id', ({ params }) => {
    const order = find(String(params.id))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    return envelope(orderDto(order, mockNow()), mockNow())
  }),

  http.get('*/api/v1/orders/:orderId/lines', ({ params }) => {
    const now = mockNow()
    const order = find(String(params.orderId))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    return envelope(
      { orderId: order.id, version: order.version, lines: linesOf(order, now), _links: { self: { href: `/api/v1/orders/${order.id}/lines` } } },
      now,
    )
  }),

  http.post('*/api/v1/orders/:orderId/lines', async ({ params, request }) => {
    const now = mockNow()
    const order = find(String(params.orderId))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    const stale = checkVersion(request, order)
    if (stale) return stale
    const body = (await request.json()) as { itemId: string; qty: number }
    const item = itemOf(body.itemId)
    if (!item) return problem(400, 'VALIDATION_FAILED', 'Some fields need attention', 'That item is not in the catalog.')
    if (item.tempClass !== order.tempClass) {
      return problem(400, 'VALIDATION_FAILED', 'Some fields need attention', 'Add chilled items to a chilled order')
    }
    if (order.lines.some((line) => line.itemId === item.id)) {
      return problem(409, 'CONFLICT_STATE', 'That item is already on the order')
    }
    order.lines.push({ id: `0192c000-0000-7000-8000-9000000000${current().nextLineId++}`, itemId: item.id, qty: body.qty })
    touched(order)
    return envelope(orderDto(order, now), now)
  }),

  http.put('*/api/v1/orders/:orderId/lines', async ({ params, request }) => {
    const now = mockNow()
    const order = find(String(params.orderId))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    const stale = checkVersion(request, order)
    if (stale) return stale
    const body = (await request.json()) as { lines: { itemId: string; qty: number }[] }
    order.lines = body.lines.map((line, index) => ({
      id: `0192c000-0000-7000-8000-800000000${index}`,
      itemId: line.itemId,
      qty: line.qty,
    }))
    touched(order)
    return envelope(orderDto(order, now), now)
  }),

  http.patch('*/api/v1/orders/:orderId/lines/:lineId', async ({ params, request }) => {
    const now = mockNow()
    const order = find(String(params.orderId))
    const line = order?.lines.find((l) => l.id === String(params.lineId))
    if (!order || !line) return problem(404, 'NOT_FOUND', 'No such line')
    const stale = checkVersion(request, order)
    if (stale) return stale
    const body = (await request.json()) as { qty: number }
    line.qty = body.qty
    touched(order)
    return envelope(orderDto(order, now), now)
  }),

  http.delete('*/api/v1/orders/:orderId/lines/:lineId', ({ params, request }) => {
    const now = mockNow()
    const order = find(String(params.orderId))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    const stale = checkVersion(request, order)
    if (stale) return stale
    order.lines = order.lines.filter((line) => line.id !== String(params.lineId))
    touched(order)
    return envelope(orderDto(order, now), now)
  }),

  http.post('*/api/v1/orders/:id/submit', ({ params, request }) => {
    const now = mockNow()
    const order = find(String(params.id))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    if (order.status !== 'DRAFT') return problem(409, 'CONFLICT_STATE', 'This order has already been sent')
    if (order.lines.length === 0) {
      return problem(400, 'VALIDATION_FAILED', 'Some fields need attention', 'Add at least one item')
    }
    const stale = checkVersion(request, order)
    if (stale) return stale
    const rolled = now >= new Date(cutoffOf(order.requestedDate))
    order.status = 'SUBMITTED'
    order.submittedAt = colomboIso(now)
    touched(order)
    const dto = orderDto(order, now)
    return envelope(
      dto,
      now,
      rolled
        ? {
            notices: [
              {
                code: 'ORDER_ROLLED_TO_NEXT_RUN',
                message: `Sent after 16:00, so it goes on ${formatColombo(startOfDay(dto.deliveryDate), 'EEE d MMM')}'s run.`,
              },
            ],
          }
        : {},
    )
  }),

  http.post('*/api/v1/orders/:id/save-as-template', async ({ params, request }) => {
    const now = mockNow()
    const order = find(String(params.id))
    if (!order) return problem(404, 'NOT_FOUND', 'No such order')
    const body = (await request.json()) as { name: string }
    const name = body.name.trim()
    if (current().templates.some((t) => t.name === name)) {
      return problem(409, 'CONFLICT_STATE', 'A preset already has that name')
    }
    const template: OrderTemplateDto = {
      id: globalThis.crypto.randomUUID(),
      name,
      tempClass: order.tempClass,
      lines: templateLines(order.lines),
      createdAt: colomboIso(now),
      _links: { self: { href: '/api/v1/order-templates' } },
    }
    current().templates.push(template)
    order.templateId = template.id
    return HttpResponse.json({ data: template, meta: meta(now) }, { status: 201 })
  }),
]

declare global {
  var compassMock: { setNow: (iso: string | null) => void; reset: () => void } | undefined
}

/** Console helpers for demos and /fidelity runs: pin the clock, or start the day again. */
export function exposeDemoControls(): void {
  globalThis.compassMock = {
    setNow: (iso) => {
      setMockNow(iso)
      world = build(colomboDate(mockNow()))
    },
    reset: () => {
      world = build(colomboDate(mockNow()))
    },
  }
}

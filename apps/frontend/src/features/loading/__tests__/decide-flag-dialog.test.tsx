import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { AlertDetailCard } from '@/features/alerts/alert-detail-card'
import { anAlert } from '@/features/alerts/__tests__/fixtures'
import { DecideFlagDialog } from '../decide-flag-dialog'
import { aFlag, aLoadList, TRIP_ID } from './fixtures'

/** The dispatcher's side of L3b: AC-LOD-10 (replace) and AC-LOD-12 (remove). */

const dispatcherFlag = (over: Parameters<typeof aFlag>[0] = {}) =>
  aFlag({
    _links: {
      self: { href: '/api/v1/load-flags/flag-1' },
      decide: { href: '/api/v1/load-flags/flag-1/decision', method: 'POST', title: 'Decide' },
    },
    ...over,
  })

const reason = (code: string, label: string, active = true) => ({
  code,
  label,
  description: null,
  fromEngine: true,
  active,
  sortOrder: 1,
  _links: { self: { href: `/api/v1/deferral-reasons/${code}` } },
})

function api(flag = dispatcherFlag(), extra: Record<string, (url: URL, init?: RequestInit) => unknown> = {}) {
  return stubApi({
    [`GET /api/v1/load-flags/${flag.id}`]: () => envelope(flag),
    [`GET /api/v1/trips/${TRIP_ID}/load-list`]: () => envelope(aLoadList()),
    'GET /api/v1/deferral-reasons': () =>
      page([reason('NO_STOCK', 'Out of stock'), reason('OVER_CAPACITY', 'No room on the truck'), reason('OLD', 'Retired reason', false)]),
    ...extra,
  })
}

const open = () => renderScreen(<DecideFlagDialog flagId="flag-1" open onOpenChange={() => undefined} />)

describe('Decide the flag (L3b, the dispatcher’s side)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows what was flagged, by whom and why, before asking for a decision', async () => {
    api()
    open()

    const dialog = await screen.findByRole('dialog', { name: 'Decide the flag' })
    const summary = await within(dialog).findByRole('region', { name: 'The flag' })
    expect(await within(summary).findByText('Fresh milk 1 L')).toBeInTheDocument()
    expect(within(summary).getByText('Missing')).toBeInTheDocument()
    expect(within(summary).getByText(/2 of 14 affected/)).toBeInTheDocument()
    expect(within(summary).getByText('“2 cases missing”')).toBeInTheDocument()
    expect(within(summary).getByText('Flagged by Harini De Mel at 03:05')).toBeInTheDocument()
    expect(within(dialog).getByText('REF-07 · Stop 8 · Seeduwa')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Send decision' })).toBeDisabled()
  })

  it('AC-LOD-10 the dispatcher asks for a replacement', async () => {
    const user = userEvent.setup()
    const { calls } = api(dispatcherFlag(), {
      'POST /api/v1/load-flags/flag-1/decision': () => envelope(dispatcherFlag({ status: 'AWAITING_RECHECK', decision: 'REPLACE' })),
    })
    open()

    const dialog = await screen.findByRole('dialog', { name: 'Decide the flag' })
    await user.click(await within(dialog).findByRole('radio', { name: 'Replace' }))
    // A replacement needs no reason code, only the words the loader will read.
    expect(within(dialog).queryByRole('combobox', { name: 'Reason' })).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: 'Message for the loader' }), 'Replace from stock')
    await user.click(within(dialog).getByRole('button', { name: 'Send decision' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'REPLACE', note: 'Replace from stock' })
  })

  it('AC-LOD-08 and 12 removing needs a reason, and sends it with the note', async () => {
    const user = userEvent.setup()
    const { calls } = api(dispatcherFlag(), {
      'POST /api/v1/load-flags/flag-1/decision': () => envelope(dispatcherFlag({ status: 'RESOLVED', decision: 'REMOVE' })),
    })
    open()

    const dialog = await screen.findByRole('dialog', { name: 'Decide the flag' })
    await user.click(await within(dialog).findByRole('radio', { name: 'Remove' }))
    const send = within(dialog).getByRole('button', { name: 'Send decision' })
    expect(send).toBeDisabled()

    await user.click(within(dialog).getByRole('combobox', { name: 'Reason' }))
    // Only reasons that are switched on are offered.
    expect(screen.queryByRole('option', { name: 'Retired reason' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('option', { name: 'No room on the truck' }))
    await user.type(within(dialog).getByRole('textbox', { name: 'Note for the store' }), 'Two cases short')
    expect(send).toBeEnabled()
    await user.click(send)

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      decision: 'REMOVE',
      reasonCode: 'OVER_CAPACITY',
      note: 'Two cases short',
    })
  })

  it('a flag that already has its answer shows the outcome and nothing to press', async () => {
    api(
      aFlag({
        status: 'AWAITING_RECHECK',
        decision: 'REPLACE',
        decisionNote: 'Replace from stock',
        decidedAt: '2026-10-02T03:10:00+05:30',
        _links: { self: { href: '/api/v1/load-flags/flag-1' } },
      }),
    )
    open()

    const dialog = await screen.findByRole('dialog', { name: 'Decide the flag' })
    const outcome = await within(dialog).findByRole('region', { name: 'The decision' })
    expect(within(outcome).getByText('Replace requested · 03:10')).toBeInTheDocument()
    expect(within(outcome).getByText('“Replace from stock”')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Send decision' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('radio', { name: 'Replace' })).not.toBeInTheDocument()
  })

  it('the alert card’s Decide the flag button opens it', async () => {
    const user = userEvent.setup()
    const alert = anAlert()
    const flagId = '0192a3f4-2222-7000-8000-000000000002'
    api(dispatcherFlag({ id: flagId }))
    renderScreen(<AlertDetailCard alert={alert} now={new Date('2026-10-02T05:00:00+05:30')} />)

    await user.click(screen.getByRole('button', { name: 'Decide the flag' }))

    const dialog = await screen.findByRole('dialog', { name: 'Decide the flag' })
    expect(await within(dialog).findByRole('radio', { name: 'Replace' })).toBeInTheDocument()
  })
})

import 'fake-indexeddb/auto'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/offline'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { LoadListPage } from '../load-list-page'
import { aFlag, aLine, aLoadList, aMe, aStop, aTripSummary, DEPOT_ID, TRIP_ID } from './fixtures'

const routes = (list: unknown, trips: unknown[] = [aTripSummary()]) => ({
  'GET /api/v1/me': () => envelope(aMe()),
  [`GET /api/v1/trips/${TRIP_ID}/load-list`]: () => envelope(list),
  [`GET /api/v1/depots/${DEPOT_ID}/loading/trips`]: () => ({ data: trips }),
})

const renderList = (list = aLoadList(), trips: unknown[] = [aTripSummary()]) => {
  const stub = stubApi(routes(list, trips))
  renderScreen(
    <Routes>
      <Route path="/dock/trips/:id" element={<LoadListPage />} />
    </Routes>,
    `/dock/trips/${TRIP_ID}`,
  )
  return stub
}

/** The one tap a loader makes: the tick button on a line. */
const tick = (item: string) => screen.findByRole('button', { name: `Tick ${item}` })

const nameTheChecker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('Your name'), 'Harini De Mel')
  await user.click(screen.getByRole('button', { name: 'Save' }))
}

describe('L2 Loading list', () => {
  beforeEach(async () => {
    await db.open()
    await Promise.all([db.loadLines.clear(), db.loadFlags.clear(), db.outbox.clear(), db.meta.clear()])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('AC-LOD-01 the load list is in reverse stop order, last stop first', async () => {
    renderList()

    const headings = await screen.findAllByText(/^Stop \d$/)
    expect(headings.map((node) => node.textContent)).toEqual(['Stop 8', 'Stop 7'])
    // The stop whose goods go in first is the one that comes out last.
    expect(screen.getByText('LOAD FIRST')).toBeInTheDocument()
    expect(screen.getByText('Reefer · Departs 05:45 · 2 stops · Reverse stop order, last stop first')).toBeInTheDocument()
  })

  it('AC-LOD-02 the rail lists the dock’s own trips for the day', async () => {
    const { calls } = renderList()

    await screen.findByText('Runs · Peliyagoda dock')
    const rail = screen.getByRole('navigation', { name: 'Runs · Peliyagoda dock' })
    expect(await within(rail).findByText('REF-07')).toBeInTheDocument()
    expect(within(rail).getByText(/Departs 05:45 · 8 stops/)).toBeInTheDocument()
    expect(calls.map((call) => call.path)).toContain(`/api/v1/depots/${DEPOT_ID}/loading/trips`)
  })

  it('AC-LOD-04 a tick queues a check that carries the name typed on the tablet', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(await tick('Fresh milk 1 L'))
    // Four loaders share the tablet, so the first tick asks who is checking.
    await nameTheChecker(user)

    await waitFor(async () => {
      const queued = await db.outbox.toArray()
      expect(queued).toHaveLength(1)
      expect(queued[0]?.event).toMatchObject({
        kind: 'loader',
        type: 'LOAD_LINE_CHECKED',
        tripId: TRIP_ID,
        loadLineId: 'line-milk',
        qtyLoaded: 14,
        checkedByName: 'Harini De Mel',
      })
    })
    // Nothing was posted: the tick is in the outbox, not on the wire (architecture rule 10).
    expect(await screen.findByRole('button', { name: 'Undo the check on Fresh milk 1 L' })).toBeInTheDocument()
  })

  it('AC-LOD-06 a checked line offers undo, and queues the undo', async () => {
    const user = userEvent.setup()
    renderList()

    await user.click(await screen.findByRole('button', { name: 'Undo the check on Basmati rice 5 kg' }))
    await nameTheChecker(user)

    await waitFor(async () => {
      const queued = await db.outbox.toArray()
      expect(queued[0]?.event).toMatchObject({ type: 'LOAD_CHECK_UNDONE', loadLineId: 'line-rice' })
    })
  })

  it('AC-LOD-06 a released trip offers no tick at all', async () => {
    const released = aLoadList()
    released.stops = released.stops.map((stop) => ({
      ...stop,
      lines: stop.lines.map((line) => ({ ...line, status: 'OK' as const, _links: { self: line._links.self } })),
    }))
    released._links = { self: released._links.self }
    renderList(released)

    await screen.findByText('Stop 8')
    expect(screen.getByRole('button', { name: 'Undo the check on Fresh milk 1 L' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Release trip' })).not.toBeInTheDocument()
  })

  it('AC-LOD-13 a revised plan freezes the list until she acknowledges it', async () => {
    const user = userEvent.setup()
    renderList(aLoadList({ upToDate: false, listRevision: 1 }))

    expect(await screen.findByText(/^Plan updated at \d\d:\d\d\. The old loading list has been replaced\.$/)).toBeInTheDocument()
    expect(await tick('Fresh milk 1 L')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(screen.queryByText(/^Plan updated at/)).not.toBeInTheDocument()
    expect(await tick('Fresh milk 1 L')).toBeEnabled()
  })

  it('AC-LOD-09 a flagged line says so, blocks release and offers Undo until the dispatcher decides', async () => {
    const user = userEvent.setup()
    const flagged = aLoadList({
      releaseChecks: [{ id: 'NO_OPEN_FLAG', label: 'Flagged items resolved', pass: false, detail: '1 waiting on the dispatcher' }],
    })
    flagged.stops = [
      aStop({
        stopSeq: 7,
        outletName: 'Ja-Ela',
        lines: [
          aLine({
            id: 'line-eggs',
            itemName: 'Eggs tray 30',
            sku: 'EGG-30',
            stopSeq: 7,
            qtyExpected: 8,
            status: 'FLAGGED',
            flags: [aFlag({ loadLineId: 'line-eggs', reason: 'DAMAGED', qtyAffected: 8 })],
            _links: { self: { href: '/api/v1/load-lines/line-eggs' } },
          }),
        ],
      }),
    ]
    renderList(flagged)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(
      'Eggs tray 30 ×8 at stop 7 flagged as damaged at 03:05. The dispatcher has been alerted and release is blocked until they decide.',
    )
    expect(screen.getByText('FLAGGED · DAMAGED')).toBeInTheDocument()
    expect(screen.getByText('Release blocked · 1 flagged item is waiting on the dispatcher.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release trip' })).toBeDisabled()

    await user.click(within(notice).getByRole('button', { name: 'Undo flag' }))
    await waitFor(async () => {
      const [queued] = await db.outbox.toArray()
      expect(queued?.event).toMatchObject({ type: 'LOAD_FLAG_UNDONE', loadFlagId: 'flag-1', tripId: TRIP_ID })
    })
  })

  it('AC-LOD-09 a flag the dispatcher has already answered offers no Undo', async () => {
    const decided = aLoadList()
    decided.stops = [
      aStop({
        lines: [
          aLine({
            status: 'FLAGGED',
            flags: [aFlag({ status: 'AWAITING_RECHECK', decision: 'REPLACE', _links: { self: { href: '/api/v1/load-flags/flag-1' } } })],
            _links: { self: { href: '/api/v1/load-lines/line-milk' } },
          }),
        ],
      }),
    ]
    renderList(decided)

    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Undo flag' })).not.toBeInTheDocument()
  })

  it('AC-LOD-10 the dispatcher’s reply shows on the tablet, with the re-check that clears it', async () => {
    const user = userEvent.setup()
    const replied = aLoadList({
      releaseChecks: [{ id: 'NO_OPEN_FLAG', label: 'Flagged items resolved', pass: false, detail: '1 waiting on a re-check' }],
    })
    replied.stops = [
      aStop({
        stopSeq: 7,
        lines: [
          aLine({
            id: 'line-eggs',
            itemName: 'Eggs tray 30',
            stopSeq: 7,
            qtyExpected: 8,
            status: 'FLAGGED',
            flags: [
              aFlag({
                loadLineId: 'line-eggs',
                status: 'AWAITING_RECHECK',
                decision: 'REPLACE',
                decisionNote: 'Load 1 new Eggs tray 30 from bay 4, then re-check it.',
                decidedAt: '2026-10-02T05:01:00+05:30',
                _links: { self: { href: '/api/v1/load-flags/flag-1' }, recheck: { href: '/api/v1/load-flags/flag-1/recheck', method: 'POST' } },
              }),
            ],
            _links: { self: { href: '/api/v1/load-lines/line-eggs' } },
          }),
        ],
      }),
    ]
    renderList(replied)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('Dispatcher replied at 05:01: replace it. Load 1 new Eggs tray 30 from bay 4, then re-check it.')
    expect(notice.dataset.state).toBe('AWAITING_RECHECK')
    expect(screen.getByText('REPLACE · RE-CHECK')).toBeInTheDocument()
    expect(screen.getByText('Release blocked · re-check the replacement to clear the flag.')).toBeInTheDocument()
    // The reply takes the undo away: only the dispatcher's decision is undone now, not the flag.
    expect(within(notice).queryByRole('button', { name: 'Undo flag' })).not.toBeInTheDocument()

    await user.click(within(notice).getByRole('button', { name: 'Re-check item' }))
    await nameTheChecker(user)
    await waitFor(async () => {
      const [queued] = await db.outbox.toArray()
      expect(queued?.event).toMatchObject({
        type: 'LOAD_RECHECKED',
        loadFlagId: 'flag-1',
        loadLineId: 'line-eggs',
        qtyLoaded: 8,
        checkedByName: 'Harini De Mel',
      })
    })
  })

  it('AC-LOD-11 a re-checked replacement clears the flag and says so until she acknowledges it', async () => {
    const user = userEvent.setup()
    const done = aLoadList()
    done.stops = [
      aStop({
        stopSeq: 7,
        lines: [
          aLine({
            id: 'line-eggs',
            itemName: 'Eggs tray 30',
            stopSeq: 7,
            qtyExpected: 8,
            qtyLoaded: 8,
            status: 'REPLACED',
            checkedByName: 'Harini De Mel',
            flags: [
              aFlag({
                loadLineId: 'line-eggs',
                status: 'RESOLVED',
                decision: 'REPLACE',
                resolvedAt: '2026-10-02T05:04:00+05:30',
                _links: { self: { href: '/api/v1/load-flags/flag-1' } },
              }),
            ],
            _links: { self: { href: '/api/v1/load-lines/line-eggs' }, undo: { href: '/api/v1/load-lines/line-eggs/undo', method: 'POST' } },
          }),
        ],
      }),
    ]
    renderList(done)

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('Replacement checked at 05:04. The flag is cleared and the dispatcher has been updated.')
    expect(screen.getByText('REPLACED')).toBeInTheDocument()
    expect(screen.getByText('Tick or scan every item to release.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release trip' })).toBeEnabled()

    await user.click(within(notice).getByRole('button', { name: 'Got it' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('gives the phone a way back to the runs board', async () => {
    renderList()
    expect(await screen.findByRole('link', { name: 'Back to runs' })).toHaveAttribute('href', '/dock')
  })

  it('shows the problem and a retry when the list will not load', async () => {
    stubApi({
      'GET /api/v1/me': () => envelope(aMe()),
      [`GET /api/v1/trips/${TRIP_ID}/load-list`]: () =>
        new Response(JSON.stringify({ code: 'NOT_FOUND', status: 404, title: 'Not found', detail: 'No such trip on this dock.' }), {
          status: 404,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(
      <Routes>
        <Route path="/dock/trips/:id" element={<LoadListPage />} />
      </Routes>,
      `/dock/trips/${TRIP_ID}`,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('No such trip on this dock.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

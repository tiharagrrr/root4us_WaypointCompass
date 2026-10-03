import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/offline'
import { renderScreen, stubApi } from '@/test/api-stub'
import { FlagItemDialog } from '../flag-item-dialog'
import type { LoadLineView } from '../use-load-list'
import { aLine, TRIP_ID } from './fixtures'

const view = (over: Parameters<typeof aLine>[0] = {}): LoadLineView => ({ ...aLine(over), queued: false })

const open = (line = view()) =>
  renderScreen(<FlagItemDialog tripId={TRIP_ID} tripRef="REF-07 · Fresh" lines={[line]} line={line} onClose={() => undefined} />)

describe('L3 Flag an item', () => {
  beforeEach(async () => {
    await db.open()
    await Promise.all([db.outbox.clear(), db.loadLines.clear(), db.loadFlags.clear(), db.meta.clear(), db.attachments.clear()])
    stubApi({})
  })

  it('AC-LOD-07 a flag queues the line, the reason, the quantity and the note', async () => {
    const user = userEvent.setup()
    open()

    await user.click(await screen.findByRole('radio', { name: 'Missing' }))
    await user.click(screen.getByRole('button', { name: 'One less Fresh milk 1 L' }))
    await user.click(screen.getByRole('button', { name: 'One less Fresh milk 1 L' }))
    await user.type(screen.getByLabelText('Note'), '2 cases missing')
    await user.type(screen.getByLabelText('Raised by'), 'Harini De Mel')
    await user.click(screen.getByRole('button', { name: 'Flag & alert dispatcher' }))

    await waitFor(async () => {
      const [queued] = await db.outbox.toArray()
      expect(queued?.event).toMatchObject({
        kind: 'loader',
        type: 'LOAD_FLAG_RAISED',
        tripId: TRIP_ID,
        loadLineId: 'line-milk',
        reason: 'MISSING',
        qtyAffected: 12,
        note: '2 cases missing',
        checkedByName: 'Harini De Mel',
      })
    })
  })

  it('AC-LOD-08 a flag with no reason cannot be raised', async () => {
    const user = userEvent.setup()
    open()

    await user.type(screen.getByLabelText('Raised by'), 'Harini De Mel')
    expect(screen.getByRole('button', { name: 'Flag & alert dispatcher' })).toBeDisabled()

    await user.click(screen.getByRole('radio', { name: 'Damaged' }))
    expect(screen.getByRole('button', { name: 'Flag & alert dispatcher' })).toBeEnabled()
  })

  it('says plainly that the trip stays blocked until the dispatcher decides', async () => {
    open()
    expect(await screen.findByText('Release stays blocked')).toBeInTheDocument()
    expect(screen.getByText('Until the dispatcher replaces the item or removes it as a partial deferral.')).toBeInTheDocument()
  })

  it('offers nothing to press on a line the server will not take a flag for', async () => {
    const settled = view({ status: 'OK', _links: { self: { href: '/api/v1/load-lines/line-milk' } } })
    open(settled)
    expect(screen.queryByRole('button', { name: 'Flag & alert dispatcher' })).not.toBeInTheDocument()
  })

  afterEach(() => vi.unstubAllGlobals())
})

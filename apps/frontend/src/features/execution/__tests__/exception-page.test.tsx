import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSyncPoke } from '@/offline'
import { renderScreen, stubApi } from '@/test/api-stub'
import { ExceptionPage } from '../exception-page'
import { saveBundle } from '../trip-bundle'
import { aBundle, STOP_IDS, TRIP_ID } from './fixtures'

const STOP = STOP_IDS[0]

const renderException = () =>
  renderScreen(
    <Routes>
      <Route path="/driver/stops/:id/exception" element={<ExceptionPage />} />
      <Route path="/driver/stops/:id" element={<p>Next stop</p>} />
      <Route path="/driver/stops/:id/record" element={<p>Record stop</p>} />
      <Route path="/driver" element={<p>Today’s trip</p>} />
    </Routes>,
    `/driver/stops/${STOP}/exception`,
  )

const arrived = async () => {
  await saveBundle(aBundle(), db)
  await db.trips.update(TRIP_ID, { status: 'IN_PROGRESS' })
  await db.stops.update(STOP, { status: 'ARRIVED' })
}

const addPhoto = async () => {
  const file = new File(['shutter'], 'shutter.jpg', { type: 'image/jpeg' })
  await userEvent.upload(screen.getByLabelText('Add photo'), file)
}

const lastEvent = async () => (await db.outbox.toArray()).at(-1)?.event as Record<string, unknown> | undefined

beforeEach(async () => {
  setSyncPoke(() => {})
  await db.open()
  await Promise.all([
    db.trips.clear(),
    db.stops.clear(),
    db.stopLines.clear(),
    db.outbox.clear(),
    db.attachments.clear(),
    db.meta.clear(),
  ])
})

afterEach(() => vi.unstubAllGlobals())

describe('D5 Exception', () => {
  it('AC-EXE-12 records a failed stop with its outcome, note and photo', async () => {
    await arrived()
    const { calls } = stubApi({})
    renderException()

    expect(await screen.findByRole('heading', { name: 'Exception · stop 1' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Outlet closed' }))
    await addPhoto()
    await userEvent.type(screen.getByLabelText('Note'), 'Shutter down')
    await userEvent.click(screen.getByRole('button', { name: 'Save exception' }))

    await waitFor(async () => {
      expect(await lastEvent()).toMatchObject({
        kind: 'driver',
        type: 'FAILED',
        outcome: 'OUTLET_CLOSED',
        stopId: STOP,
        note: 'Shutter down',
      })
    })
    await expect(db.stops.get(STOP)).resolves.toMatchObject({ status: 'FAILED' })
    await expect(db.attachments.count()).resolves.toBe(1)
    expect(calls.filter((call) => call.path.includes('/stops/'))).toEqual([])
  })

  it('AC-EXE-10 asks for the outcome, the photo and the note before it will save', async () => {
    await arrived()
    stubApi({})
    renderException()

    await screen.findByText('Coconut oil 1 L', { exact: false }).catch(() => undefined)
    await userEvent.click(screen.getByRole('button', { name: 'Save exception' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Why did it fail?')

    await userEvent.click(screen.getByRole('radio', { name: 'Refused' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save exception' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a photo')

    await addPhoto()
    await userEvent.click(screen.getByRole('button', { name: 'Save exception' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a note for the dispatcher')
    await expect(db.outbox.count()).resolves.toBe(0)
  })

  it('AC-EXE-11 a partial delivery also needs the name of whoever took it', async () => {
    await arrived()
    stubApi({})
    renderException()

    await userEvent.click(await screen.findByRole('radio', { name: 'Partial' }))
    await addPhoto()
    await userEvent.type(screen.getByLabelText('Note'), '2 trays crushed')
    await userEvent.click(screen.getByRole('button', { name: 'Save exception' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Who took the delivery?')

    await userEvent.type(screen.getByLabelText('Receiver name'), 'Chathura')
    const plus = screen.getAllByRole('button', { name: /One more/ })[0]
    await userEvent.click(plus)
    await userEvent.click(screen.getByRole('button', { name: 'Save exception' }))

    await waitFor(async () => {
      expect(await lastEvent()).toMatchObject({ type: 'PARTIAL', outcome: 'PARTIAL', receiverName: 'Chathura' })
    })
    await expect(db.stops.get(STOP)).resolves.toMatchObject({ status: 'PARTIAL' })
  })

  it('AC-EXE-13 offers nothing once the stop already has an outcome', async () => {
    await arrived()
    await db.stops.update(STOP, { status: 'FAILED' })
    stubApi({})
    renderException()

    expect(await screen.findByRole('heading', { name: 'Exception · stop 1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save exception' })).not.toBeInTheDocument()
  })
})

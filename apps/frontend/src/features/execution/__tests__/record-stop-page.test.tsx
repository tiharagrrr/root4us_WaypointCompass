import 'fake-indexeddb/auto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSyncPoke, type QueuedLine } from '@/offline'
import { renderScreen, stubApi } from '@/test/api-stub'
import { RecordStopPage } from '../record-stop-page'
import { saveBundle } from '../trip-bundle'
import { aBundle, STOP_IDS, TRIP_ID } from './fixtures'

const STOP = STOP_IDS[0]

/** jsdom has no canvas, so the pad reports what the driver drew through its handle. */
const signatureDrawn = () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
    callback(new Blob(['signature'], { type: 'image/png' }))
  }
}

const sign = async () => {
  const pad = screen.getByRole('img', { name: 'Signature' })
  await userEvent.pointer([
    { target: pad, keys: '[MouseLeft>]', coords: { clientX: 10, clientY: 10 } },
    { target: pad, coords: { clientX: 40, clientY: 30 } },
    { keys: '[/MouseLeft]', target: pad },
  ])
}

const renderRecord = () =>
  renderScreen(
    <Routes>
      <Route path="/driver/stops/:id/record" element={<RecordStopPage />} />
      <Route path="/driver/stops/:id" element={<p>Next stop</p>} />
      <Route path="/driver/stops/:id/exception" element={<p>Exception</p>} />
      <Route path="/driver" element={<p>Today’s trip</p>} />
    </Routes>,
    `/driver/stops/${STOP}/record`,
  )

const arrived = async () => {
  await saveBundle(aBundle(), db)
  await db.trips.update(TRIP_ID, { status: 'IN_PROGRESS' })
  await db.stops.update(STOP, { status: 'ARRIVED' })
}

const queuedEvent = async () => {
  const rows = await db.outbox.toArray()
  return rows.at(-1)?.event as { type: string; lines?: QueuedLine[]; [k: string]: unknown } | undefined
}

beforeEach(async () => {
  setSyncPoke(() => {})
  signatureDrawn()
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

describe('D4 Record stop', () => {
  it('AC-EXE-09 delivers in full with the receiver and a signature, through the outbox', async () => {
    await arrived()
    const { calls } = stubApi({})
    renderRecord()

    expect(await screen.findByRole('heading', { name: 'Record stop 1' })).toBeInTheDocument()
    expect(screen.getByText('Fresh milk 1 L')).toBeInTheDocument()
    expect(screen.getByText('×10')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Receiver name'), 'Chathura')
    await sign()
    await userEvent.click(screen.getByRole('button', { name: 'Save stop' }))

    await waitFor(async () => {
      expect(await queuedEvent()).toMatchObject({
        kind: 'driver',
        type: 'DELIVERED',
        outcome: 'DELIVERED',
        stopId: STOP,
        receiverName: 'Chathura',
      })
    })
    const event = await queuedEvent()
    expect(event?.lines).toHaveLength(3)
    expect(event?.lines?.every((line) => line.condition === 'ok')).toBe(true)
    expect(event?.attachmentUuids).toHaveLength(1)
    await expect(db.stops.get(STOP)).resolves.toMatchObject({ status: 'DELIVERED' })
    // The signature is bytes on the phone, waiting for its own upload.
    await expect(db.attachments.count()).resolves.toBe(1)
    // Nothing was posted to the stop endpoints: the write is the queued event.
    expect(calls.filter((call) => call.path.includes('/stops/'))).toEqual([])
  })

  it('AC-EXE-10 refuses to save without a receiver name, then without proof', async () => {
    await arrived()
    stubApi({})
    renderRecord()

    await screen.findByText('Fresh milk 1 L')
    await userEvent.click(screen.getByRole('button', { name: 'Save stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Who took the delivery?')
    await expect(db.outbox.count()).resolves.toBe(0)

    await userEvent.type(screen.getByLabelText('Receiver name'), 'Chathura')
    await userEvent.click(screen.getByRole('button', { name: 'Save stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a signature or a photo')
    await expect(db.outbox.count()).resolves.toBe(0)
  })

  it('AC-EXE-11 a short line records PARTIAL with the quantity and the note', async () => {
    await arrived()
    stubApi({})
    renderRecord()

    await screen.findByText('Fresh milk 1 L')
    // Unticking the line opens its stepper; 10 ordered, 8 handed over.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fresh milk 1 L' }))
    const plus = screen.getByRole('button', { name: 'One more Fresh milk 1 L' })
    for (let i = 0; i < 8; i += 1) await userEvent.click(plus)

    await userEvent.type(screen.getByLabelText('Receiver name'), 'Chathura')
    await sign()
    await userEvent.click(screen.getByRole('button', { name: 'Save stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Say what was short and why')

    await userEvent.type(screen.getByLabelText('What was short, and why?'), '2 trays crushed')
    await userEvent.click(screen.getByRole('button', { name: 'Save stop' }))

    await waitFor(async () => {
      expect(await queuedEvent()).toMatchObject({ type: 'PARTIAL', outcome: 'PARTIAL', note: '2 trays crushed' })
    })
    const event = await queuedEvent()
    expect(event?.lines?.[0]).toMatchObject({ qtyDelivered: 8, condition: 'ok' })
    await expect(db.stops.get(STOP)).resolves.toMatchObject({ status: 'PARTIAL' })
  })

  it('AC-EXE-13 offers nothing to record on a stop that already has an outcome', async () => {
    await arrived()
    await db.stops.update(STOP, { status: 'DELIVERED' })
    stubApi({})
    renderRecord()

    await screen.findByText('Fresh milk 1 L')
    expect(screen.queryByRole('button', { name: 'Save stop' })).not.toBeInTheDocument()
  })
})

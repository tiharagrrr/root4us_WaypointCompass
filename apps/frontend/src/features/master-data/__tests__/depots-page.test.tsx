import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { DepotsPage } from '../depots-page'

const depot = (links: Record<string, unknown> = {}) => ({
  id: 'PLG',
  name: 'Peliyagoda',
  kind: 'CENTRAL',
  address: null,
  lat: null,
  lng: null,
  dockCount: 6,
  chilledDocks: 2,
  cutoffMin: null,
  effectiveCutoffMin: 960,
  effectiveCutoff: '16:00',
  _links: { self: { href: '/api/v1/depots/PLG' }, ...links },
})

const editable = { edit: { href: '/api/v1/depots/PLG', method: 'PATCH' } }

const wave = (id: string, label: string, links: Record<string, unknown> = {}) => ({
  id,
  depotId: 'PLG',
  label,
  departFromMin: 315,
  departFrom: '05:15',
  departToMin: 390,
  departTo: '06:30',
  brands: ['FRESH'],
  _links: { self: { href: `/api/v1/depots/PLG/waves/${id}` }, ...links },
})

describe('A4 Depots', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-MD-06 saves the docks and the cutoff override as minutes', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': () => page([depot(editable)]),
      'GET /api/v1/depots/PLG/waves': () => page([wave('w1', 'Run 1')]),
      'PATCH /api/v1/depots/PLG': () => envelope(depot(editable)),
    })
    renderScreen(<DepotsPage />)

    expect(await screen.findByText(/Peliyagoda/)).toBeInTheDocument()
    expect(screen.getByText('16:00')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Chilled docks'))
    await userEvent.type(screen.getByLabelText('Chilled docks'), '3')
    await userEvent.type(screen.getByLabelText('Cutoff override'), '15:00')
    await userEvent.click(screen.getByRole('button', { name: 'Save depot' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      dockCount: 6,
      chilledDocks: 3,
      cutoffMin: 900,
    })
  })

  it('keeps a bad cutoff on its own field and sends nothing', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': () => page([depot(editable)]),
      'GET /api/v1/depots/PLG/waves': () => page([]),
    })
    renderScreen(<DepotsPage />)

    await userEvent.type(await screen.findByLabelText('Cutoff override'), 'half four')
    await userEvent.click(screen.getByRole('button', { name: 'Save depot' }))

    expect(await screen.findByText(/HH:MM/)).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  it('AC-MD-07 refuses a second wave with the same name, from the server', async () => {
    stubApi({
      'GET /api/v1/depots': () => page([depot(editable)]),
      'GET /api/v1/depots/PLG/waves': () => page([wave('w1', 'Run 1')]),
      'POST /api/v1/depots/PLG/waves': () =>
        new Response(
          JSON.stringify({ code: 'CONFLICT_STATE', status: 409, title: 'This conflicts with the current state', detail: 'PLG already has a wave called Run 1.', errors: [] }),
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    })
    renderScreen(<DepotsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Add a wave' }))
    await userEvent.type(screen.getByLabelText('Wave'), 'Run 1')
    await userEvent.type(screen.getByLabelText('From'), '05:15')
    await userEvent.type(screen.getByLabelText('To'), '06:30')
    await userEvent.click(screen.getByRole('button', { name: 'Add wave' }))

    expect(await screen.findByText('PLG already has a wave called Run 1.')).toBeInTheDocument()
  })

  it('AC-MD-07 shows Edit and Remove only when the wave carries the links', async () => {
    stubApi({
      'GET /api/v1/depots': () => page([depot(editable)]),
      'GET /api/v1/depots/PLG/waves': () =>
        page([
          wave('w1', 'Run 1', { edit: { href: '/api/v1/depots/PLG/waves/w1', method: 'PATCH' }, remove: { href: '/api/v1/depots/PLG/waves/w1', method: 'DELETE' } }),
          wave('w2', 'Run 2'),
        ]),
    })
    renderScreen(<DepotsPage />)

    expect(await screen.findByText('Run 2')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
  })

  it('hides the waves panel and Save for a caller with no edit link', async () => {
    stubApi({ 'GET /api/v1/depots': () => page([depot()]) })
    renderScreen(<DepotsPage />)

    expect(await screen.findByText(/Peliyagoda/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save depot' })).not.toBeInTheDocument()
    expect(screen.queryByText('Run waves')).not.toBeInTheDocument()
  })

  it('shows the error state with a retry', async () => {
    stubApi({
      'GET /api/v1/depots': () =>
        new Response(JSON.stringify({ code: 'SERVER_ERROR', status: 500, title: 'Something went wrong' }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<DepotsPage />)

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

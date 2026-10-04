import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { VehiclesPage } from '../vehicles-page'

const depots = () =>
  page([
    {
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
      _links: { self: { href: '/api/v1/depots/PLG' } },
    },
  ])

const vehicle = (
  id: string,
  code: string,
  overrides: Partial<Record<string, unknown>> = {},
  links: Record<string, unknown> = {},
) => ({
  id,
  code,
  registrationNo: `WP-${code}`,
  type: 'TRUCK',
  temp: 'REEFER',
  weightCapKg: 3000,
  volumeCapM3: 20,
  fuelType: 'diesel',
  kmPerL: 6,
  weeklyFuelQuotaL: 400,
  depotId: 'PLG',
  status: 'ACTIVE',
  statusReason: null,
  statusChangedAt: null,
  driver: null,
  version: 4,
  ...overrides,
  _links: { self: { href: `/api/v1/vehicles/${id}` }, ...links },
})

const fuelWeek = () =>
  envelope({
    vehicleId: 'VEH007',
    isoYear: 2026,
    isoWeek: 40,
    quotaL: 400,
    plannedL: 120,
    actualL: 0,
    adjustmentL: 0,
    usedL: 120,
    leftL: 280,
    _links: { self: { href: '/api/v1/vehicles/VEH007/fuel' } },
  })

const actions = {
  edit: { href: '/api/v1/vehicles/VEH007', method: 'PATCH', requires: ['If-Match'] },
  status: { href: '/api/v1/vehicles/VEH007/status', method: 'PUT', requires: ['If-Match'] },
  fuel: { href: '/api/v1/vehicles/VEH007/fuel{?week}', templated: true },
}

describe('A5 Vehicles', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-FLT-06 shows the status and edit actions only when the links are there', async () => {
    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () => page([vehicle('VEH007', 'REF-07', {}, actions), vehicle('VEH031', 'DRY-31')]),
      'GET /api/v1/vehicles/VEH007/fuel': fuelWeek,
    })
    renderScreen(<VehiclesPage />)

    expect(await screen.findByText('REF-07')).toBeInTheDocument()
    expect(screen.getByText('DRY-31')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Status' })).toHaveLength(1)
  })

  it("shows this week's fuel against the quota, and the linked driver", async () => {
    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () =>
        page([vehicle('VEH007', 'REF-07', { driver: { id: 'u9', name: 'Aniqa Razick' } }, actions)]),
      'GET /api/v1/vehicles/VEH007/fuel': fuelWeek,
    })
    renderScreen(<VehiclesPage />)

    expect(await screen.findByText('Aniqa Razick')).toBeInTheDocument()
    expect(await screen.findByText(/120 \/ 400 L · 30%/)).toBeInTheDocument()
  })

  it('shows a vehicle that is out with its reason', async () => {
    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () =>
        page([vehicle('VEH007', 'REF-07', { status: 'BREAKDOWN', statusReason: 'Compressor fault' }, actions)]),
      'GET /api/v1/vehicles/VEH007/fuel': fuelWeek,
    })
    renderScreen(<VehiclesPage />)

    expect(await screen.findByText('Broken down')).toBeInTheDocument()
    expect(screen.getByText('Compressor fault')).toBeInTheDocument()
  })

  it('AC-FLT-05 a status change carries the reason and If-Match', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () => page([vehicle('VEH007', 'REF-07', {}, actions)]),
      'GET /api/v1/vehicles/VEH007/fuel': fuelWeek,
      'PUT /api/v1/vehicles/VEH007/status': () =>
        envelope({ id: 'VEH007', code: 'REF-07', depotId: 'PLG', status: 'BREAKDOWN', statusReason: 'Compressor fault', statusChangedAt: null, version: 5, _links: {} }),
    })
    renderScreen(<VehiclesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Broken down' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Compressor fault')
    await userEvent.click(screen.getByRole('button', { name: 'Save status' }))

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    const sent = calls.find((c) => c.method === 'PUT')
    expect(sent?.body).toMatchObject({ status: 'BREAKDOWN', reason: 'Compressor fault' })
    expect(sent?.headers['if-match']).toBe('W/"4"')
  })

  it('AC-FLT-05 a status change with no reason never leaves the dialog', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () => page([vehicle('VEH007', 'REF-07', {}, actions)]),
      'GET /api/v1/vehicles/VEH007/fuel': fuelWeek,
    })
    renderScreen(<VehiclesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Status' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save status' }))

    expect(await screen.findByText(/Say why/)).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)
  })

  it('AC-FLT-07 the edit carries If-Match and says so when the version is stale', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () => page([vehicle('VEH007', 'REF-07', {}, actions)]),
      'GET /api/v1/vehicles/VEH007/fuel': fuelWeek,
      'PATCH /api/v1/vehicles/VEH007': () =>
        new Response(JSON.stringify({ code: 'VERSION_MISMATCH', status: 412, title: 'Someone changed this first', errors: [] }), {
          status: 412,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<VehiclesPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const quota = screen.getByLabelText('Weekly quota')
    await userEvent.clear(quota)
    await userEvent.type(quota, '450')
    await userEvent.click(screen.getByRole('button', { name: 'Save vehicle' }))

    expect(await screen.findByText(/Someone else changed this vehicle/)).toBeInTheDocument()
    const sent = calls.find((c) => c.method === 'PATCH')
    expect(sent?.headers['if-match']).toBe('W/"4"')
    expect(sent?.body).toMatchObject({ weeklyFuelQuotaL: 450, kmPerL: 6 })
  })

  it('leaves the fuel column empty when the row carries no fuel link', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () => page([vehicle('VEH007', 'REF-07')]),
    })
    renderScreen(<VehiclesPage />)

    expect(await screen.findByText('REF-07')).toBeInTheDocument()
    expect(calls.filter((c) => c.path.endsWith('/fuel'))).toHaveLength(0)
  })

  it('shows the empty and error states', async () => {
    stubApi({ 'GET /api/v1/depots': depots, 'GET /api/v1/vehicles': () => page([]) })
    const { unmount } = renderScreen(<VehiclesPage />)
    expect(await screen.findByText('No vehicles yet')).toBeInTheDocument()
    unmount()

    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/vehicles': () =>
        new Response(JSON.stringify({ code: 'SERVER_ERROR', status: 500, title: 'Something went wrong' }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<VehiclesPage />)
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

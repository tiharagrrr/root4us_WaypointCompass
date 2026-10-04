import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, renderScreen, stubApi } from '@/test/api-stub'
import { OutletsPage } from '../outlets-page'

const depots = () => page([{ id: 'PLG', name: 'Peliyagoda', kind: 'CENTRAL', address: null, lat: null, lng: null, dockCount: 6, chilledDocks: 2, cutoffMin: null, effectiveCutoffMin: 960, effectiveCutoff: '16:00', _links: { self: { href: '/api/v1/depots/PLG' } } }])

const outlet = (
  id: string,
  name: string,
  manager: { id: string; name: string } | null,
  links: Record<string, unknown> = {},
) => ({
  id,
  name,
  brand: 'FRESH',
  districtId: 'gampaha',
  depotId: 'PLG',
  dockType: 'REAR_DOCK',
  parkingConstraint: 'NORMAL',
  windowOpenMin: 360,
  windowOpen: '06:00',
  windowCloseMin: 600,
  windowClose: '10:00',
  mallWindowOpenMin: null,
  mallWindowOpen: null,
  mallWindowCloseMin: null,
  mallWindowClose: null,
  styleDeliveryDow: null,
  address: 'Kadawatha',
  lat: null,
  lng: null,
  receivingContactName: 'Mr Perera',
  receivingContactPhone: '+94711234567',
  accessNotes: null,
  accessNotesUpdatedAt: null,
  accessNotesUpdatedById: null,
  manager,
  _links: { self: { href: `/api/v1/outlets/${id}` }, ...links },
})

describe('A3 Outlets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-MD-05 flags an outlet with no manager', async () => {
    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/outlets': () =>
        page([
          outlet('OUT001', 'Fresh Kadawatha', { id: 'u1', name: 'Nimesha Periyapperuma' }, { edit: { href: '/api/v1/outlets/OUT001', method: 'PATCH' } }),
          outlet('OUT002', 'Fresh Ragama', null),
        ]),
    })
    renderScreen(<OutletsPage />)

    expect(await screen.findByText('Fresh Kadawatha')).toBeInTheDocument()
    expect(screen.getByText('Nimesha Periyapperuma')).toBeInTheDocument()
    expect(screen.getByText('No manager')).toBeInTheDocument()
    expect(screen.getAllByText('06:00–10:00')).toHaveLength(2)
    // Only the row that carries the link offers Edit.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
  })

  it('AC-MD-05 the Needs a manager tab asks the server for hasManager=false', async () => {
    const asked: (string | null)[] = []
    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/outlets': (url) => {
        asked.push(url.searchParams.get('filter[hasManager]'))
        return page([outlet('OUT002', 'Fresh Ragama', null)])
      },
    })
    renderScreen(<OutletsPage />)
    expect(await screen.findByText('Fresh Ragama')).toBeInTheDocument()
    expect(asked).toEqual([null])

    await userEvent.click(screen.getByRole('radio', { name: 'Needs a manager' }))

    await waitFor(() => expect(asked).toContain('false'))
  })

  it('saves the window as minutes and shows a refusal on its field', async () => {
    const edit = { edit: { href: '/api/v1/outlets/OUT001', method: 'PATCH' } }
    const { calls } = stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/outlets': () => page([outlet('OUT001', 'Fresh Kadawatha', null, edit)]),
      'PATCH /api/v1/outlets/OUT001': () =>
        new Response(
          JSON.stringify({
            code: 'VALIDATION_FAILED',
            status: 400,
            title: 'That did not validate',
            errors: [{ field: 'windowCloseMin', code: 'after_open', message: 'The window must close after it opens.' }],
          }),
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
    })
    renderScreen(<OutletsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    const closes = screen.getByLabelText('Window closes')
    await userEvent.clear(closes)
    await userEvent.type(closes, '05:00')
    await userEvent.click(screen.getByRole('button', { name: 'Save outlet' }))

    expect(await screen.findByText('The window must close after it opens.')).toBeInTheDocument()
    const sent = calls.find((c) => c.method === 'PATCH')
    expect(sent?.body).toMatchObject({ windowOpenMin: 360, windowCloseMin: 300 })
  })

  it('shows the empty state when nothing needs a manager', async () => {
    stubApi({ 'GET /api/v1/depots': depots, 'GET /api/v1/outlets': () => page([]) })
    renderScreen(<OutletsPage />)

    expect(await screen.findByText('No outlets yet')).toBeInTheDocument()
  })

  it('shows the error state with a retry', async () => {
    stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/outlets': () =>
        new Response(JSON.stringify({ code: 'SERVER_ERROR', status: 500, title: 'Something went wrong' }), {
          status: 500,
          headers: { 'content-type': 'application/problem+json' },
        }),
    })
    renderScreen(<OutletsPage />)

    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('reads the manager from the list, not from a second request', async () => {
    const { calls } = stubApi({
      'GET /api/v1/depots': depots,
      'GET /api/v1/outlets': () => page([outlet('OUT001', 'Fresh Kadawatha', { id: 'u1', name: 'Nimesha Periyapperuma' })]),
    })
    renderScreen(<OutletsPage />)
    await screen.findByText('Nimesha Periyapperuma')

    expect(calls.filter((c) => c.path.startsWith('/api/v1/users'))).toHaveLength(0)
  })

  it('renders the loading skeleton before the first page arrives', () => {
    stubApi({ 'GET /api/v1/depots': depots, 'GET /api/v1/outlets': () => page([]) })
    const { container } = renderScreen(<OutletsPage />)

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })
})

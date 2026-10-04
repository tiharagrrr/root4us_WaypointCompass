import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { DockLoadersSection } from '../dock-loaders-section'

const KEY = 'loading.dockLoaders'
const options = { depots: [{ id: 'PLG', name: 'Peliyagoda' }], outlets: [], vehicles: [] }
const setting = (value: string[], links: Record<string, unknown> = { edit: { href: `/api/v1/settings/${KEY}?depotId=PLG`, method: 'PUT' } }) => ({
  key: KEY,
  value,
  default: [],
  source: 'depot',
  depotId: 'PLG',
  perDepot: true,
  editable: true,
  description: '',
  updatedAt: null,
  _links: { self: { href: `/api/v1/settings/${KEY}?depotId=PLG` }, ...links },
})

describe('A6 Dock loaders', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-LOD-20 lists each loader with the depot and adds one from a dialog with the depot and name', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      'GET /api/v1/users/scope-options': () => envelope(options),
      [`GET /api/v1/settings/${KEY}`]: () => envelope(setting(['Harini De Mel'])),
      [`PUT /api/v1/settings/${KEY}`]: () => envelope(setting(['Harini De Mel', 'Kasun Perera'])),
    })
    renderScreen(<DockLoadersSection />)

    expect(await screen.findByText('Harini De Mel · Peliyagoda')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(await screen.findByRole('combobox', { name: 'Depot' }))
    await user.click(await screen.findByRole('option', { name: 'Peliyagoda' }))
    await user.type(screen.getByLabelText('Name'), 'Kasun Perera')
    await user.click(screen.getByRole('button', { name: 'Add loader' }))

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT')
      expect(put?.body).toEqual({ value: ['Harini De Mel', 'Kasun Perera'] })
    })
  })

  it('AC-LOD-20 a name already on the depot’s list is refused in the form', async () => {
    const user = userEvent.setup()
    const { calls } = stubApi({
      'GET /api/v1/users/scope-options': () => envelope(options),
      [`GET /api/v1/settings/${KEY}`]: () => envelope(setting(['Harini De Mel'])),
    })
    renderScreen(<DockLoadersSection />)

    await user.click(await screen.findByRole('button', { name: 'Add' }))
    await user.click(await screen.findByRole('combobox', { name: 'Depot' }))
    await user.click(await screen.findByRole('option', { name: 'Peliyagoda' }))
    await user.type(screen.getByLabelText('Name'), 'harini de mel')
    await user.click(screen.getByRole('button', { name: 'Add loader' }))

    expect(await screen.findByText('harini de mel is already on Peliyagoda’s list')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('AC-LOD-20 without the edit link there is no Add and no ×', async () => {
    stubApi({
      'GET /api/v1/users/scope-options': () => envelope(options),
      [`GET /api/v1/settings/${KEY}`]: () => envelope(setting(['Harini De Mel'], {})),
    })
    renderScreen(<DockLoadersSection />)

    expect(await screen.findByText('Harini De Mel · Peliyagoda')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
  })
})

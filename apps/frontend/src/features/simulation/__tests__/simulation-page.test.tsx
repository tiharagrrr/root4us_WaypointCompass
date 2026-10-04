import { screen, waitFor } from '@testing-library/react'
import type { ClockDto } from '@compass/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { SimulationPage } from '../simulation-page'

const clock = (demoMode: boolean): ClockDto => ({
  mode: 'real',
  now: '2026-10-02T03:00:00+05:30',
  realNow: '2026-10-02T03:00:00+05:30',
  at: null,
  offsetMs: null,
  demoMode,
  shifted: false,
  _links: {},
})

const create = { href: '/api/v1/simulations', method: 'POST', title: 'New simulation' }

const routes = (demoMode = true) => ({
  'GET /api/v1/clock': () => envelope(clock(demoMode)),
  'GET /api/v1/simulations': () => page([], { create }),
  'GET /api/v1/depots': () => page([{ id: 'PLG', name: 'Peliyagoda' }]),
  'GET /api/v1/depots/PLG/plans/2026-10-02': () => envelope({ id: 'plan-1', status: 'PUBLISHED', _links: {} }),
})

afterEach(() => vi.unstubAllGlobals())

describe('SimulationPage', () => {
  it('gives the dispatcher the run controls', async () => {
    stubApi(routes())
    renderScreen(<SimulationPage />)

    expect(await screen.findByRole('button', { name: 'Start simulation' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI scenario director' })).toBeInTheDocument()
  })

  it('says why the screen is blank when the simulator is off, rather than showing nothing', async () => {
    // Only the clock answers: /simulations is 404 unless SIMULATION_ENABLED.
    stubApi({ 'GET /api/v1/clock': () => envelope(clock(true)) })
    renderScreen(<SimulationPage />)

    expect(await screen.findByText('The simulator is off')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start simulation' })).not.toBeInTheDocument()
  })

  it('says demo mode is off without asking for a run', async () => {
    const { calls } = stubApi(routes(false))
    renderScreen(<SimulationPage />)

    expect(await screen.findByText('Demo mode is off')).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/clock')).toBe(true))
  })

  it('offers a retry when the clock fails', async () => {
    // Nothing is registered, so the stub answers 404 problem+json.
    stubApi({})
    renderScreen(<SimulationPage />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /retry|try again/i })).toBeInTheDocument()
  })
})

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClockDto } from '@compass/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, page, renderScreen, stubApi } from '@/test/api-stub'
import { SimulationSection } from '../simulation-section'

const clock: ClockDto = {
  mode: 'real',
  now: '2026-10-02T03:00:00+05:30',
  realNow: '2026-10-02T03:00:00+05:30',
  at: null,
  offsetMs: null,
  demoMode: true,
  shifted: false,
  _links: {},
}

const create = { href: '/api/v1/simulations', method: 'POST', title: 'New simulation' }
const director = { href: '/api/v1/simulations', method: 'POST', title: 'Let the AI director add trouble' }
const setting = { href: '/api/v1/settings/simulation.aiDirector', method: 'PUT' }

const routes = (links: Record<string, unknown>, runs: unknown[] = []) => ({
  'GET /api/v1/simulations': () => page(runs, { create, ...links }),
  'GET /api/v1/depots': () => page([{ id: 'PLG', name: 'Peliyagoda' }]),
  'GET /api/v1/depots/PLG/plans/2026-10-02': () => envelope({ id: 'plan-1', status: 'PUBLISHED', _links: {} }),
})

afterEach(() => vi.unstubAllGlobals())

describe('SimulationSection', () => {
  it('AC-SIM-10 shows no AI feature while the director link is absent', async () => {
    stubApi(routes({}))
    renderScreen(<SimulationSection clock={clock} />)

    expect(await screen.findByRole('button', { name: 'Start simulation' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI scenario director' })).toBeDisabled()
    expect(screen.queryByRole('checkbox', { name: director.title })).not.toBeInTheDocument()
  })

  it('AC-SIM-09 offers an agentic run once the director is on', async () => {
    const { calls } = stubApi({
      ...routes({ director, disableDirector: { ...setting, title: 'Turn off the AI scenario director' } }),
      'POST /api/v1/simulations': () => envelope({ id: 'run-1', status: 'DRAFT', injections: [], _links: {} }),
      'POST /api/v1/simulations/run-1/start': () => envelope({ id: 'run-1', status: 'RUNNING', injections: [], _links: {} }),
    })
    renderScreen(<SimulationSection clock={clock} />)

    expect(await screen.findByRole('switch', { name: 'AI scenario director' })).toBeChecked()
    await userEvent.click(await screen.findByRole('checkbox', { name: director.title }))
    await userEvent.click(await screen.findByRole('button', { name: 'Start simulation' }))

    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/simulations/run-1/start')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/v1/simulations')?.body).toMatchObject({ planId: 'plan-1', agentic: true })
  })

  it('the switch turns the director on through the setting', async () => {
    const { calls } = stubApi({
      ...routes({ enableDirector: { ...setting, title: 'Turn on the AI scenario director' } }),
      'PUT /api/v1/settings/simulation.aiDirector': () => envelope({ key: 'simulation.aiDirector', value: true, _links: {} }),
    })
    renderScreen(<SimulationSection clock={clock} />)

    await userEvent.click(await screen.findByRole('switch', { name: 'AI scenario director' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ value: true }))
  })

  it('renders nothing when the simulator is off', async () => {
    const { calls } = stubApi({})
    const { container } = renderScreen(<SimulationSection clock={clock} />)

    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/simulations')).toBe(true))
    expect(container).toBeEmptyDOMElement()
  })
})

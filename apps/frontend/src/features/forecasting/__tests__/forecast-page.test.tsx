import type { DepotForecastDto, ForecastWeekDto } from '@compass/api-client'
import { addDays } from '@waypoint/shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { envelope, renderScreen, stubApi } from '@/test/api-stub'
import { ForecastPage } from '../forecast-page'

const path = '/api/v1/depots/PLG/forecasts'

/** Week n of ten from Mon 5 Oct 2026; 104 m³ of capacity as in the frame. */
const aWeek = (n: number, over: Partial<ForecastWeekDto> = {}): ForecastWeekDto => ({
  isoYear: 2026,
  isoWeek: 40 + n,
  weekStart: addDays('2026-10-05', (n - 1) * 7),
  operatingDays: 6,
  totalVolumeM3: 90,
  chilledVolumeM3: 38,
  ambientVolumeM3: 52,
  capacityM3: 104,
  chilledCapacityM3: 48,
  overCapacity: false,
  gapVolumeM3: 0,
  chilledGapVolumeM3: 0,
  extraReefers: 0,
  extraVehicles: 0,
  payday: false,
  festivals: [],
  monsoon: false,
  brands: [{ brand: 'FRESH', totalVolumeM3: 90, chilledVolumeM3: 38, source: 'DATATHON' }],
  ...over,
})

const aForecast = (weeks: ForecastWeekDto[]): DepotForecastDto => ({
  depotId: 'PLG',
  brand: null,
  fleet: { vehicles: 17, reefers: 8, drivers: 16, volumeCapM3: 208, reeferVolumeCapM3: 96 },
  gapWeeks: weeks.filter((w) => w.overCapacity).length,
  weeks,
  _links: { self: { href: `${path}?weeks=10` } },
})

const tenWeeks = () =>
  Array.from({ length: 10 }, (_, i) =>
    i + 1 === 4
      ? aWeek(4, { totalVolumeM3: 111, chilledVolumeM3: 49, ambientVolumeM3: 62, overCapacity: true, gapVolumeM3: 7, chilledGapVolumeM3: 1, extraReefers: 1, payday: true, monsoon: true })
      : aWeek(i + 1),
  )

describe('22 Forecast', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('AC-FC-01 draws ten weeks against capacity and flags the week over it', async () => {
    const { calls } = stubApi({ [`GET ${path}`]: () => envelope(aForecast(tenWeeks())) })
    renderScreen(<ForecastPage />)

    const chart = await screen.findByRole('region', { name: 'Weekly volume' })
    const columns = within(chart).getAllByRole('group')
    expect(columns).toHaveLength(10)
    expect(columns[0]).toHaveAccessibleName('W1, week of 5 Oct: 90 m³ against 104 m³')
    expect(columns[3]).toHaveAccessibleName('W4, week of 26 Oct: 111 m³ against 104 m³, over capacity')
    expect(columns.filter((c) => c.getAttribute('aria-label')?.endsWith('over capacity'))).toHaveLength(1)
    expect(within(chart).getByText('1 gap week where demand exceeds the fleet.', { exact: false })).toBeInTheDocument()
    expect(within(chart).getByText('FLEET CAPACITY 104 m³')).toBeInTheDocument()

    const gaps = screen.getByRole('region', { name: 'Gap weeks' })
    const row = within(gaps).getByRole('row', { name: /W4/ })
    expect(within(row).getByText('+1 reefer')).toBeInTheDocument()
    expect(within(row).getByText('Payday · monsoon')).toBeInTheDocument()
    expect(within(gaps).getAllByRole('row')).toHaveLength(2)
    expect(calls[0]).toMatchObject({ method: 'GET', path })
  })

  it('hides an overlay when its box is unticked', async () => {
    const user = userEvent.setup()
    stubApi({ [`GET ${path}`]: () => envelope(aForecast(tenWeeks())) })
    renderScreen(<ForecastPage />)

    const chart = await screen.findByRole('region', { name: 'Weekly volume' })
    expect(within(chart).getByText('Payday')).toBeInTheDocument()
    expect(within(chart).getByText('MONSOON')).toBeInTheDocument()

    await user.click(within(chart).getByRole('checkbox', { name: 'Paydays' }))
    await user.click(within(chart).getByRole('checkbox', { name: 'Monsoon' }))
    expect(within(chart).queryByText('Payday')).not.toBeInTheDocument()
    expect(within(chart).queryByText('MONSOON')).not.toBeInTheDocument()
  })

  it('says so when no week has a forecast, and when every week fits', async () => {
    stubApi({ [`GET ${path}`]: () => envelope(aForecast(Array.from({ length: 10 }, (_, i) => aWeek(i + 1, { brands: [], totalVolumeM3: 0, chilledVolumeM3: 0, ambientVolumeM3: 0 })))) })
    const empty = renderScreen(<ForecastPage />)
    expect(await screen.findByText('No forecast yet')).toBeInTheDocument()
    empty.unmount()

    stubApi({ [`GET ${path}`]: () => envelope(aForecast(Array.from({ length: 10 }, (_, i) => aWeek(i + 1)))) })
    renderScreen(<ForecastPage />)
    expect(await screen.findByText('No gap weeks')).toBeInTheDocument()
  })

  it('shows the problem and retries when the forecast fails', async () => {
    stubApi({})
    renderScreen(<ForecastPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

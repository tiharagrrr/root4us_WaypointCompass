import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from '../button'
import { CapacityMeter } from '../capacity-meter'
import { DeliveryWindow } from '../delivery-window'
import { DriverStopCard } from '../driver-stop-card'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from '../sheet'
import { StopSequenceRow } from '../stop-sequence-row'

describe('CapacityMeter (09 268:2245, 11 269:2996)', () => {
  it('reads out the load, the limit and the percentage', () => {
    render(<CapacityMeter label="WEIGHT" value={3610} limit={4000} unit="kg" />)

    expect(screen.getByText('3,610 / 4,000 kg · 90%')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'WEIGHT' })).toHaveAttribute('aria-valuenow', '3610')
  })

  it('marks an over-capacity trip, and never draws past the end of the bar', () => {
    const { container } = render(<CapacityMeter label="VOLUME" value={19.2} limit={18} unit="m³" fractionDigits={1} />)

    expect(screen.getByText('19.2 / 18.0 m³ · 107%')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="capacity-meter"]')).toHaveAttribute('data-over', 'true')
    expect(container.querySelector('[role="meter"] > div')).toHaveStyle({ width: '100%' })
  })
})

describe('DeliveryWindow (D3 185:20107)', () => {
  it('writes the window the way the frames do', () => {
    render(<DeliveryWindow open="07:00" close="08:00" />)
    expect(screen.getByText('07:00–08:00')).toBeInTheDocument()
  })

  it('carries the tone when a stop is at risk', () => {
    render(<DeliveryWindow open="07:00" close="08:00" tone="at-risk" />)
    expect(screen.getByText('07:00–08:00')).toHaveAttribute('data-tone', 'at-risk')
  })
})

describe('StopSequenceRow (11 269:2996, 19b 464:2353)', () => {
  it('shows the stop, its planned arrival over the window, and the actions it was given', () => {
    render(
      <StopSequenceRow
        seq={1}
        name="Kadawatha"
        code="WF-0210"
        arrival="12:10"
        window={{ open: '12:00', close: '14:00' }}
        load="1,020 kg"
        actions={<Button size="icon-sm">Remove</Button>}
      />,
    )

    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('Kadawatha')).toBeInTheDocument()
    expect(screen.getByText('12:00–14:00')).toBeInTheDocument()
    expect(screen.getByText('1,020 kg')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('offers no drag handle unless the screen is re-sequencing', () => {
    const { container, rerender } = render(<StopSequenceRow seq={2} name="Kelaniya" />)
    expect(container.querySelector('[data-icon="drag"]')).toBeNull()

    rerender(<StopSequenceRow seq={2} name="Kelaniya" draggable />)
    expect(container.querySelector('[data-icon="drag"]')).not.toBeNull()
  })
})

describe('DriverStopCard (D3 185:20107)', () => {
  it('leads with the outlet, then the times that decide whether the driver is late', () => {
    render(
      <DriverStopCard
        eyebrow="NEXT STOP"
        name="Ja-Ela"
        address="No. 48, Negombo Rd, Ja-Ela"
        chilled
        rows={[
          { label: 'ETA', value: '07:18' },
          { label: 'Window', value: <DeliveryWindow open="07:00" close="08:00" strong /> },
        ]}
      />,
    )

    expect(screen.getByText('NEXT STOP')).toBeInTheDocument()
    expect(screen.getByText('Ja-Ela')).toBeInTheDocument()
    expect(screen.getByText('ETA')).toBeInTheDocument()
    expect(screen.getByText('07:18')).toBeInTheDocument()
    expect(screen.getByText('07:00–08:00')).toBeInTheDocument()
  })
})

describe('Sheet (L3m 254:1605, D9 185:20487)', () => {
  it('opens from the bottom edge and closes again', async () => {
    render(
      <Sheet>
        <SheetTrigger asChild>
          <Button>Flag an item</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader title="Flag an item" description="Tell the dispatcher what is wrong." />
          <SheetBody>Short by 2 cases</SheetBody>
        </SheetContent>
      </Sheet>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Flag an item' }))
    const sheet = await screen.findByRole('dialog')
    expect(sheet).toHaveAttribute('data-side', 'bottom')
    expect(screen.getByText('Short by 2 cases')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

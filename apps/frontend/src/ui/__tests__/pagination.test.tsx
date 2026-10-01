import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from '../pagination'
import { pageItems, pageState } from '../pagination-range'

describe('pageItems', () => {
  it('shows every page when they fit, as in A1 (5 pages)', () => {
    expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the first and last page and three around the current one', () => {
    expect(pageItems(5, 10)).toEqual([1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10])
    expect(pageItems(10, 10)).toEqual([1, 'ellipsis-start', 7, 8, 9, 10])
    expect(pageItems(1, 1)).toEqual([1])
  })
})

describe('<Pagination>', () => {
  it('shows the range from meta.page and asks for the next offset', async () => {
    const user = userEvent.setup()
    const onOffsetChange = vi.fn()
    render(<Pagination page={{ limit: 10, offset: 0, total: 42 }} onOffsetChange={onOffsetChange} />)

    expect(screen.getByText('1–10 of 42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(onOffsetChange).toHaveBeenCalledWith(10)
    expect(pageState({ limit: 10, offset: 40, total: 42 })).toMatchObject({ current: 5, last: 5, from: 41, to: 42 })
  })
})

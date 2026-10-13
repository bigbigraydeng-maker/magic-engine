import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { CatalogTourView } from '../types'
import { TourSummary } from '../TourSummary'

function makeTour(overrides: Partial<CatalogTourView> = {}): CatalogTourView {
  return {
    id: 't1',
    slug: 't1',
    destination: 'atlantis',
    tier: 'gold',
    name: 'Coral Loop',
    displayPriceText: 'From NZD $5,299 per person',
    isActive: true,
    managesDepartures: true,
    ...overrides,
  }
}

describe('TourSummary', () => {
  it('renders an https hero image directly', () => {
    const { container } = render(
      <TourSummary tour={makeTour({ heroImage: 'https://img.test/hero.jpg' })} domain={null} />,
    )
    const img = screen.getByAltText('Coral Loop 主图') as HTMLImageElement
    expect(img.src).toBe('https://img.test/hero.jpg')
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('resolves a site-relative hero image against the domain', () => {
    render(
      <TourSummary tour={makeTour({ heroImage: '/images/hero.jpg' })} domain="example.test" />,
    )
    const img = screen.getByAltText('Coral Loop 主图') as HTMLImageElement
    expect(img.src).toBe('https://example.test/images/hero.jpg')
  })

  it('shows a placeholder when there is no hero image', () => {
    const { container } = render(<TourSummary tour={makeTour()} domain={null} />)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByText('还没有主图')).toBeInTheDocument()
  })

  it('renders the facts line with duration and gallery count', () => {
    render(
      <TourSummary
        tour={makeTour({ durationText: '12 Days', gallery: ['a', 'b', 'c'] })}
        domain={null}
      />,
    )
    expect(screen.getByTestId('summary-facts')).toHaveTextContent(
      '12 Days · From NZD $5,299 per person · 图集 3 张',
    )
  })

  it('renders the facts line with fallbacks when nothing is set', () => {
    render(<TourSummary tour={makeTour()} domain={null} />)
    expect(screen.getByTestId('summary-facts')).toHaveTextContent(
      '天数未填 · From NZD $5,299 per person · 图集 0 张',
    )
  })

  it('shows the description when present', () => {
    render(
      <TourSummary tour={makeTour({ shortDescription: 'A lovely reef trip' })} domain={null} />,
    )
    expect(screen.getByText('A lovely reef trip')).toBeInTheDocument()
  })

  it('shows the empty description message when missing', () => {
    render(<TourSummary tour={makeTour()} domain={null} />)
    expect(screen.getByText('还没有简介')).toBeInTheDocument()
  })

  it('collapses and expands highlights beyond five', () => {
    const highlights = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7']
    render(<TourSummary tour={makeTour({ highlights })} domain={null} />)

    const list = screen.getByTestId('summary-highlights')
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)

    const button = screen.getByText('展开其余 2 条')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(button)
    expect(within(screen.getByTestId('summary-highlights')).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getByText('收起')).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByText('收起'))
    expect(within(screen.getByTestId('summary-highlights')).getAllByRole('listitem')).toHaveLength(5)
  })

  it('shows no expand button for five or fewer highlights', () => {
    render(
      <TourSummary
        tour={makeTour({ highlights: ['H1', 'H2', 'H3', 'H4', 'H5'] })}
        domain={null}
      />,
    )
    expect(screen.getByTestId('summary-highlights')).toBeInTheDocument()
    expect(screen.queryByText(/展开其余/)).not.toBeInTheDocument()
  })

  it('renders no highlights list when there are none', () => {
    render(<TourSummary tour={makeTour({ highlights: [] })} domain={null} />)
    expect(screen.queryByTestId('summary-highlights')).not.toBeInTheDocument()
  })
})

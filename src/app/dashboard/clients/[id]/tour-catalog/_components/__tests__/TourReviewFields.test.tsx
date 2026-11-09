import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TourReviewFields, REVIEWS_WARNING } from '../TourReviewFields'
import type { FieldErrors } from '../editor-parts'

function renderFields(overrides: {
  rating?: string
  reviewCount?: string
  reviewSummary?: string
  errors?: FieldErrors
  onRating?: (next: string) => void
  onReviewCount?: (next: string) => void
  onReviewSummary?: (next: string) => void
} = {}) {
  const {
    rating = '',
    reviewCount = '',
    reviewSummary = '',
    errors = {},
    onRating = vi.fn(),
    onReviewCount = vi.fn(),
    onReviewSummary = vi.fn(),
  } = overrides
  return render(
    <TourReviewFields
      rating={rating}
      reviewCount={reviewCount}
      reviewSummary={reviewSummary}
      errors={errors}
      onRating={onRating}
      onReviewCount={onReviewCount}
      onReviewSummary={onReviewSummary}
    />,
  )
}

describe('TourReviewFields', () => {
  it('shows the reviews warning', () => {
    renderFields()
    expect(screen.getByTestId('reviews-warning')).toHaveTextContent(REVIEWS_WARNING)
  })

  it('calls the matching callback when typing', () => {
    const onRating = vi.fn()
    const onReviewCount = vi.fn()
    const onReviewSummary = vi.fn()
    renderFields({ onRating, onReviewCount, onReviewSummary })

    fireEvent.change(screen.getByLabelText('评分'), { target: { value: '4.6' } })
    expect(onRating).toHaveBeenLastCalledWith('4.6')

    fireEvent.change(screen.getByLabelText('评价数'), { target: { value: '120' } })
    expect(onReviewCount).toHaveBeenLastCalledWith('120')

    fireEvent.change(screen.getByLabelText('评价摘要'), { target: { value: '很好' } })
    expect(onReviewSummary).toHaveBeenLastCalledWith('很好')
  })

  it('configures the rating input as a bounded number', () => {
    renderFields()
    const rating = screen.getByLabelText('评分')
    expect(rating).toHaveAttribute('type', 'number')
    expect(rating).toHaveAttribute('min', '0')
    expect(rating).toHaveAttribute('max', '5')
    expect(rating).toHaveAttribute('step', '0.1')
  })

  it('renders the rating error', () => {
    renderFields({ errors: { rating: '评分要填 0 到 5，最多一位小数' } })
    expect(screen.getByText('评分要填 0 到 5，最多一位小数')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CompletenessCard } from '../CompletenessCard'
import { incompleteNewTours } from '../incomplete-new-tours'
import type { CatalogTourView } from '../types'
import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'

const bare: CatalogTourView = {
  id: 't-new',
  slug: 'china-unveiled',
  destination: 'china',
  tier: 'discovery',
  name: 'China Discovery — China Unveiled',
  displayPriceText: 'From NZD $4,999 per person',
  isActive: true,
  managesDepartures: true,
}

describe('CompletenessCard', () => {
  it('tells how many items are missing and lists them when opened', () => {
    render(<CompletenessCard tour={bare} departureCount={4} />)
    expect(screen.getByTestId('completeness-card').textContent).toMatch(/还差 \d+ 项/)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/主图 — 没有主图/)).toBeTruthy()
    expect(screen.getByText(/官网有这个团的路线地图/)).toBeTruthy()
  })
})

describe('incompleteNewTours', () => {
  const preview = {
    changes: [
      { kind: 'tour_added', tourId: 't-new', tourName: bare.name, fieldLabel: '新增团', before: null, after: bare.name, risk: 'high' },
      { kind: 'tour_field', tourId: 'old', tourName: 'Old', fieldLabel: '展示价', before: 'a', after: 'b', risk: 'high' },
    ],
  } as unknown as PublishPreviewResponse

  it('only looks at tours being added in this publish', () => {
    const old: CatalogTourView = { ...bare, id: 'old', name: 'Old' }
    const result = incompleteNewTours(preview, [bare, old], [])
    expect(result.map(r => r.tourId)).toEqual(['t-new'])
    expect(result[0].missing).toContain('主图')
    expect(result[0].missing).toContain('出发日')
  })
})

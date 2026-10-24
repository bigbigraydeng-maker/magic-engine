import { describe, expect, it } from 'vitest'
import { matchesCompetitor, toAdReviewCard } from '../observations'
import { clipLandscapeFieldObservations } from '@/lib/web-intelligence/field-observations'

describe('ad review cards', () => {
  const row = {
    id: '33333333-3333-4333-8333-333333333333',
    source_url: 'https://www.facebook.com/ads/library/?id=99',
    competitor_domain: 'live.example',
    observed_at: '2026-10-24T00:00:00.000Z',
    payload: { competitor_name: 'Example Tours', ad_library_id: '99', primary_text: 'Hello', platforms: ['facebook'] },
    review_status: 'pending',
    review_notes: null,
    task_id: '22222222-2222-4222-8222-222222222222',
    screenshot_path: null,
  }

  it('shows the structured ad fields and ignores rows that are not in review', () => {
    expect(toAdReviewCard(row, 'https://signed.example/shot')?.primary_text).toBe('Hello')
    expect(toAdReviewCard({ ...row, review_status: 'not_required' }, null)).toBeNull()
    expect(matchesCompetitor({ competitor_name: 'Example Tours', competitor_domain: 'live.example' }, 'live.example')).toBe(true)
  })

  it('only forwards approved field observations into the landscape prompt input', () => {
    const clipped = clipLandscapeFieldObservations([
      { source_type: 'meta_ad_library', source_name: 'Meta Ad Library', source_url: 'https://example.com/ad', title: 'See China', excerpt: 'Hello', observed_at: '2026-10-24T00:00:00.000Z', competitor_domain: 'live.example', payload: { ad_library_id: '99' } },
      { source_type: 'jobs', source_name: 'SEEK', source_url: 'https://example.com/job', observed_at: '2026-10-24T00:00:00.000Z' },
    ])
    expect(clipped).toHaveLength(1)
    expect(clipped[0].source_type).toBe('meta_ad_library')
  })
})

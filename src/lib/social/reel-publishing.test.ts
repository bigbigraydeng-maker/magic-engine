import { describe, expect, it } from 'vitest'
import { buildReelFirstComment, buildReelPostCaption, buildReelPublishAutoChecks } from './reel-publishing'

describe('Reel publishing copy', () => {
  it('moves verified CTA and a tracked HTTPS destination into the first comment', () => {
    const comment = buildReelFirstComment({ cta: 'Book now', offer: ['October departures'], url: 'ctstours.co.nz/trips' }, 'wo-123')
    expect(comment?.text).toContain('Book now')
    expect(comment?.trackedUrl).toMatch(/^https:\/\//)
    const url = new URL(comment!.trackedUrl)
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.get('utm_medium')).toBe('organic_social')
    expect(url.searchParams.get('utm_campaign')).toBe('me_factory_reel')
    expect(url.searchParams.get('utm_content')).toBe('wo-123')
  })

  it('uses segment copy as the post body and fails closed when CTA appears in it', () => {
    const body = buildReelPostCaption({ segments: [{ title_sub: 'Explore with us' }, { caption: 'Small groups' }] })
    expect(body).toBe('Explore with us · Small groups')
    const checks = buildReelPublishAutoChecks({
      workOrderId: 'wo-123',
      body: `${body} Book now`,
      endcard: { cta: 'Book now', offer: [], url: 'https://example.test/trips' },
    })
    expect(checks.map(item => item.outcome)).toEqual(['FAIL', 'PASS'])
  })

  it('rejects non-HTTPS destinations instead of publishing an untracked comment', () => {
    expect(buildReelFirstComment({ cta: 'Book now', url: 'javascript:alert(1)' }, 'wo-123')).toBeNull()
  })
})

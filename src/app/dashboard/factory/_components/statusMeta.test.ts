import { describe, expect, it } from 'vitest'
import { publishedBadge, REASON_STATUSES } from './statusMeta'

const view = (o: Partial<{ video_state: 'DRAFT' | 'PUBLISHED' | null; permalink: string | null; provisional: boolean }>) => ({
  video_state: null, permalink: null, published_at: null, provisional: false, ...o,
})

describe('publishedBadge', () => {
  it('draft is labelled non-public and has no link', () => {
    const b = publishedBadge(view({ video_state: 'DRAFT', permalink: 'https://www.facebook.com/reel/1/' }))
    expect(b.label).toBe('Facebook 草稿，未公开')
    expect(b.href).toBeNull()
  })
  it('public carries the permalink', () => {
    const b = publishedBadge(view({ video_state: 'PUBLISHED', permalink: 'https://www.facebook.com/reel/1/' }))
    expect(b.label).toBe('已公开')
    expect(b.href).toBe('https://www.facebook.com/reel/1/')
  })
  it('interrupted upload and unverified receipts are not shown as public', () => {
    expect(publishedBadge(view({ provisional: true })).label).toContain('中断')
    expect(publishedBadge(view({})).label).toContain('未核实')
    expect(publishedBadge(null).label).toContain('未核实')
  })
  it('only failure-like statuses show reject_reason', () => {
    expect(REASON_STATUSES).toContain('publish_failed')
    expect(REASON_STATUSES).toContain('queued') // retryable worker failure goes back to queued WITH a reason; must stay visible
    expect(REASON_STATUSES).not.toContain('published')
  })
})

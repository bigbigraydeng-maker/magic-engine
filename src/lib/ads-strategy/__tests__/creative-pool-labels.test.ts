import { describe, it, expect } from 'vitest'
import { splitAngle, toLabel } from '../creative-pool-labels'

describe('creative-pool-labels', () => {
  it('splits title before colon and strips revision notes from subtitle', () => {
    expect(
      splitAngle('Best of China: 15-second price-suspense reel (spring 2027 push; v3: lifted)'),
    ).toEqual({ title: 'Best of China', subtitle: '15-second price-suspense reel' })
  })

  it('returns null when the angle is missing (never invents a name)', () => {
    expect(toLabel({ angle: null, published_ref: { video_id: '1' } })).toBeNull()
    expect(toLabel({ angle: '   ', published_ref: null })).toBeNull()
  })

  it('builds label with publish date and facebook link', () => {
    const l = toLabel({
      angle: 'Tale: reel',
      published_ref: { video_id: '123', published_at: '2026-10-11T21:05:59.546Z' },
    })
    expect(l).toEqual({
      title: 'Tale',
      subtitle: 'reel',
      publishedAt: '2026-10-11T21:05:59.546Z',
      url: 'https://www.facebook.com/reel/123',
    })
  })
})

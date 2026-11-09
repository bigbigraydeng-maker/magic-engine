import { describe, expect, it } from 'vitest'
import { toAuditReel } from '../load'

describe('toAuditReel', () => {
  it('reads template, music, scenes, brand colour, variant, tags', () => {
    const r = toAuditReel({
      id: 'f4bdd5f6-ef3e-4289-b95a-747bea57de9e', created_at: '2026-10-27T01:02:03Z',
      brief: {
        engine: 'remotion', variant_of: { base_work_order_id: '164a29c1-0000-4000-8000-000000000000' },
        remotion: { template: 'list', props: { musicFile: 'music/x.mp3', brandColor: '#B61E2E', scenes: [{}, {}, {}] } },
        social_agent: { format: 'explainer', pillar: 'practical' },
      },
    })
    expect(r).toEqual({
      id: 'f4bdd5f6', createdOn: '2026-10-27', template: 'list', engine: 'remotion', music: 'music/x.mp3', scenes: 3,
      brandColor: '#B61E2E', variantOf: '164a29c1', format: 'explainer', pillar: 'practical',
    })
  })

  it('uses items when there are no scenes; a plain-string variant_of also works', () => {
    const r = toAuditReel({ id: 'abcdef12-0', created_at: '2026-10-01T00:00:00Z', brief: { variant_of: 'deadbeef-1', remotion: { template: 'list', props: { items: [{}, {}] } } } })
    expect(r).toMatchObject({ scenes: 2, variantOf: 'deadbeef' })
  })

  it('unreadable fields stay null, never a default', () => {
    const r = toAuditReel({ id: 'abcdef12-0', created_at: '2026-10-01T00:00:00Z', brief: 'garbage' })
    expect(r).toMatchObject({ template: null, music: null, scenes: null, brandColor: null, variantOf: null, format: null, pillar: null })
  })

  it('rows without an id or a date are dropped', () => {
    expect(toAuditReel({ created_at: '2026-10-01' })).toBeNull()
    expect(toAuditReel({ id: 'x' })).toBeNull()
    expect(toAuditReel(null)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { buildBlogRegeneratePayload, type RegenerableBlogPost } from '../regenerate-payload'

const FULL_POST: RegenerableBlogPost = {
  topic:             'Tile sizes explained — best picks for 2026',
  mode:              'unified',
  source_query_id:   '11111111-1111-1111-1111-111111111111',
  source_query_text: 'best tile sizes brisbane',
  primary_keyword:   'tile sizes',
  keyword_volume:    2400,
  keyword_kd:        18,
  keyword_intent:    'commercial',
}

describe('buildBlogRegeneratePayload', () => {
  it('forwards every targeting field on a fully-populated post', () => {
    expect(buildBlogRegeneratePayload(FULL_POST)).toEqual({
      topic:             FULL_POST.topic,
      mode:              'unified',
      source_query_id:   FULL_POST.source_query_id,
      source_query_text: FULL_POST.source_query_text,
      primary_keyword:   'tile sizes',
      keyword_volume:    2400,
      keyword_kd:        18,
      keyword_intent:    'commercial',
      skip_audit:        true,
    })
  })

  it('converts null fields to undefined so JSON.stringify drops them on the wire', () => {
    const sparse: RegenerableBlogPost = {
      topic:             'x',
      mode:              'geo_only',
      source_query_id:   null,
      source_query_text: null,
      primary_keyword:   null,
      keyword_volume:    null,
      keyword_kd:        null,
      keyword_intent:    null,
    }
    const payload = buildBlogRegeneratePayload(sparse)
    expect(payload.source_query_id).toBeUndefined()
    expect(payload.primary_keyword).toBeUndefined()
    expect(payload.keyword_volume).toBeUndefined()

    // The whole point — JSON.stringify must omit the absent keys so they don't
    // arrive at the POST route as `null` (which the route's truthy checks would
    // treat differently from missing).
    const json = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>
    expect(json).not.toHaveProperty('source_query_id')
    expect(json).not.toHaveProperty('source_query_text')
    expect(json).not.toHaveProperty('primary_keyword')
    expect(json).not.toHaveProperty('keyword_volume')
    expect(json).not.toHaveProperty('keyword_kd')
    expect(json).not.toHaveProperty('keyword_intent')

    // Required fields stay.
    expect(json.topic).toBe('x')
    expect(json.mode).toBe('geo_only')
    expect(json.skip_audit).toBe(true)
  })

  it('always sets skip_audit=true (FDE explicit Regenerate must not re-route to upgrade)', () => {
    expect(buildBlogRegeneratePayload(FULL_POST).skip_audit).toBe(true)
    const sparse = { ...FULL_POST, source_query_id: null }
    expect(buildBlogRegeneratePayload(sparse).skip_audit).toBe(true)
  })

  it('preserves mode verbatim (no coercion)', () => {
    for (const mode of ['unified', 'geo_only', 'seo_only'] as const) {
      const out = buildBlogRegeneratePayload({ ...FULL_POST, mode })
      expect(out.mode).toBe(mode)
    }
  })

  it('keeps a 0 keyword_volume / keyword_kd value (does NOT coerce 0 to undefined)', () => {
    // Important: 0 is a legitimate value (a long-tail keyword with zero
    // recorded volume), and the `?? undefined` operator preserves it. A naive
    // `|| undefined` here would corrupt the regen payload.
    const zeroed = buildBlogRegeneratePayload({
      ...FULL_POST,
      keyword_volume: 0,
      keyword_kd:     0,
    })
    expect(zeroed.keyword_volume).toBe(0)
    expect(zeroed.keyword_kd).toBe(0)
  })
})

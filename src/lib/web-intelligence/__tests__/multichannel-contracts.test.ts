import { describe, expect, it } from 'vitest'
import { externalEventSchema, externalObservationSchema, sourceMayStandAlone } from '../contracts'

const clientId = '00000000-0000-0000-0000-000000000001'
const observationId = '11111111-1111-4111-8111-111111111111'
const observation = {
  client_id: clientId, source_type: 'industry_media', source_tier: 'B', source_name: 'Travel Today',
  source_url: 'https://example.com/story', canonical_url: 'https://example.com/story',
  title: 'A travel industry story', excerpt: 'A verifiable published observation.', competitor_domain: 'example.com',
  published_at: '2026-09-11T00:00:00Z', observed_at: '2026-09-11T01:00:00Z', valid_until: null,
  content_hash: 'a'.repeat(64), status: 'observed',
}

describe('multichannel intelligence contracts', () => {
  it('accepts an industry observation with source and observation timestamps', () => {
    expect(externalObservationSchema.parse(observation)).toMatchObject({ source_type: 'industry_media', source_name: 'Travel Today' })
  })

  it('keeps discovery-only tier C from standing alone as evidence', () => {
    expect(sourceMayStandAlone('A')).toBe(true)
    expect(sourceMayStandAlone('B')).toBe(true)
    expect(sourceMayStandAlone('C')).toBe(false)
  })

  it('requires an explicit fact status and at least one observation for an event', () => {
    expect(externalEventSchema.parse({
      client_id: clientId, event_type: 'market_expansion', subject: 'New market signal', competitor_domain: 'example.com',
      market: 'New Zealand', related_product: null, observation_ids: [observationId], fact_status: 'inference', confidence: 0.6,
    }).fact_status).toBe('inference')
    expect(() => externalEventSchema.parse({ ...observation, observation_ids: [] })).toThrow()
  })
})

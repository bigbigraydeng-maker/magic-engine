import { describe, expect, it } from 'vitest'
import { buildExternalObservation, canonicalExternalUrl, normalisePublishedAt, observationContentHash, sourceDefinition, sourceDefaultUrls, sourceDefaultValidUntil } from '../sources'

const clientId = '00000000-0000-0000-0000-000000000001'

describe('external source registry', () => {
  it('registers the initial NZ jobs and travel industry sources', () => {
    expect(sourceDefinition('seek-nz')).toMatchObject({ name: 'SEEK', type: 'jobs', market: 'NZ' })
    expect(sourceDefinition('indeed-nz')).toMatchObject({ name: 'Indeed', type: 'jobs', market: 'NZ' })
    expect(sourceDefinition('travel-today')).toMatchObject({ name: 'Travel Today', type: 'industry_media' })
    expect(sourceDefinition('travelinc-memo')).toMatchObject({ name: 'TRAVELinc Memo', type: 'industry_media' })
    expect(sourceDefinition('tourism-new-zealand-news')).toMatchObject({ name: 'Tourism New Zealand News', type: 'industry_news' })
    expect(sourceDefinition('facebook-group-authorized')).toMatchObject({ name: 'Facebook Group（授权）', type: 'facebook_group', tier: 'C', requires_authorization: true })
  })

  it('canonicalises tracking variants to the same URL', () => {
    expect(canonicalExternalUrl('https://example.com/story/?utm_source=newsletter&ref=homepage#top')).toBe('https://example.com/story?ref=homepage')
  })

  it('keeps verified default source URLs in the registry', () => {
    expect(sourceDefaultUrls('travel-today')).toEqual(['https://traveltoday.co.nz/news/'])
    expect(sourceDefaultUrls('travelinc-memo')).toEqual(['https://travelinc.co.nz/'])
    expect(sourceDefaultUrls('unknown')).toEqual([])
  })

  it('assigns a bounded default validity window while preserving explicit unknown', () => {
    expect(sourceDefaultValidUntil('travel-today', '2026-09-11T00:00:00Z')).toBe('2026-09-18T00:00:00.000Z')
    expect(sourceDefaultValidUntil('facebook-group-authorized', '2026-09-11T00:00:00Z')).toBe('2026-09-14T00:00:00.000Z')
    expect(sourceDefaultValidUntil('unknown', '2026-09-11T00:00:00Z')).toBeNull()
  })

  it('normalises invalid publication dates to unknown', () => {
    expect(normalisePublishedAt('2026-09-11T01:00:00+12:00')).toBe('2026-09-10T13:00:00.000Z')
    expect(normalisePublishedAt('not-a-date')).toBeNull()
  })

  it('builds a source-backed observation with a stable content hash', () => {
    const result = buildExternalObservation({
      client_id: clientId, source_id: 'travel-today', source_url: 'https://example.com/story?utm_medium=email',
      title: ' New route announced ', excerpt: ' The operator announced a new route. ', competitor_domain: 'example.com',
      published_at: '2026-09-11T00:00:00Z', observed_at: '2026-09-11T01:00:00Z',
    })
    expect(result).toMatchObject({ source_name: 'Travel Today', canonical_url: 'https://example.com/story', status: 'observed', valid_until: '2026-09-18T01:00:00.000Z' })
    expect(result.content_hash).toBe(observationContentHash('New route announced', 'The operator announced a new route.'))
  })

  it('fails closed for an unregistered source', () => {
    expect(() => buildExternalObservation({ client_id: clientId, source_id: 'unknown', source_url: 'https://example.com', excerpt: 'x', observed_at: '2026-09-11T00:00:00Z' })).toThrow('unknown_external_source')
  })

  it('fails closed when a controlled Facebook source has no authorization receipt', () => {
    expect(() => buildExternalObservation({
      client_id: clientId, source_id: 'facebook-group-authorized', source_url: 'https://facebook.com/groups/example/posts/1',
      excerpt: 'A discussion signal', observed_at: '2026-09-11T00:00:00Z',
    })).toThrow('source_authorization_required')
    expect(buildExternalObservation({
      client_id: clientId, source_id: 'facebook-group-authorized', source_url: 'https://facebook.com/groups/example/posts/1',
      excerpt: 'A discussion signal', observed_at: '2026-09-11T00:00:00Z', authorization_confirmed: true,
    })).toMatchObject({ source_type: 'facebook_group', source_tier: 'C' })
  })
})

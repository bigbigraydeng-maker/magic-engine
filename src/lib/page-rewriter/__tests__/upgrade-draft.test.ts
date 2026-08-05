import { describe, expect, it } from 'vitest'
import {
  PAGE_UPGRADE_DRAFT_TTL_MS,
  buildPageUpgradeDraftStorageKey,
  createPageUpgradeDraft,
  parsePageUpgradeDraft,
} from '../upgrade-draft'

describe('page upgrade draft handoff', () => {
  const NOW = 1_800_000_000_000
  const BASE = {
    clientId: 'client-1',
    pageId: 'page-1',
    sourceUrl: 'https://www.example.com/services/seo/',
    enhancedTitle: 'A stronger SEO title',
    enhancedMetaTitle: 'SEO Services | Example',
    enhancedMetaDescription: 'A useful description',
    enhancedHtmlBody: '<main><h1>A stronger SEO title</h1></main>',
    createdAt: NOW,
  }

  it('builds a client- and page-scoped storage key', () => {
    expect(buildPageUpgradeDraftStorageKey('client/a', 'page b', NOW))
      .toBe('me:page-upgrade:v1:client%2Fa:page%20b:1800000000000')
  })

  it('round-trips a valid same-page draft', () => {
    const draft = createPageUpgradeDraft(BASE)
    const parsed = parsePageUpgradeDraft(
      JSON.stringify(draft),
      BASE.clientId,
      'http://example.com/services/seo',
      NOW + 1_000,
    )
    expect(parsed).toEqual(draft)
  })

  it('rejects a draft from another client', () => {
    const draft = createPageUpgradeDraft(BASE)
    expect(parsePageUpgradeDraft(JSON.stringify(draft), 'client-2', BASE.sourceUrl, NOW)).toBeNull()
  })

  it('rejects a draft for a different page', () => {
    const draft = createPageUpgradeDraft(BASE)
    expect(parsePageUpgradeDraft(
      JSON.stringify(draft),
      BASE.clientId,
      'https://example.com/services/ads/',
      NOW,
    )).toBeNull()
  })

  it('rejects expired and far-future drafts', () => {
    const draft = createPageUpgradeDraft(BASE)
    expect(parsePageUpgradeDraft(
      JSON.stringify(draft),
      BASE.clientId,
      BASE.sourceUrl,
      NOW + PAGE_UPGRADE_DRAFT_TTL_MS + 1,
    )).toBeNull()
    expect(parsePageUpgradeDraft(
      JSON.stringify({ ...draft, createdAt: NOW + 6 * 60 * 1000 }),
      BASE.clientId,
      BASE.sourceUrl,
      NOW,
    )).toBeNull()
  })

  it.each([null, '', '{bad json}', '[]'])('rejects malformed input: %p', (raw) => {
    expect(parsePageUpgradeDraft(raw, BASE.clientId, BASE.sourceUrl, NOW)).toBeNull()
  })
})

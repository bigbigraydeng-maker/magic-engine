import { describe, expect, it } from 'vitest'
import { findGscPage, resolveGscAttributionScope } from '../gsc-page-scope'

describe('resolveGscAttributionScope', () => {
  it('blocks actions whose publication is not live', () => {
    expect(
      resolveGscAttributionScope({
        action_type: 'cms_update_existing',
        expected_metric: null,
        payload: { status: 'pr_open', page_url: 'https://example.com/travel/' },
      }),
    ).toEqual({ kind: 'skip' })
  })

  it('routes a merged page upgrade to page-level attribution', () => {
    expect(
      resolveGscAttributionScope({
        action_type: 'cms_update_existing',
        expected_metric: 'seo.gsc.page_clicks',
        payload: { status: 'live', page_url: 'https://example.com/travel/' },
      }),
    ).toEqual({ kind: 'page', pageUrl: 'https://example.com/travel/' })
  })

  it('preserves domain attribution for other eligible SEO actions', () => {
    expect(
      resolveGscAttributionScope({
        action_type: 'seo.publish_blog',
        expected_metric: 'seo.domain.organic_traffic',
        payload: null,
      }),
    ).toEqual({ kind: 'domain' })
  })
})

describe('findGscPage', () => {
  const rows = [
    {
      page: 'https://www.example.com/travel/?utm_source=test',
      clicks: 12,
      impressions: 140,
      position: 8.2,
    },
  ]

  it('matches the same canonical host and path across protocol, www and trailing slash', () => {
    expect(findGscPage(rows, 'http://example.com/travel/')).toEqual(rows[0])
  })

  it('does not confuse different paths', () => {
    expect(findGscPage(rows, 'https://example.com/real-estate/')).toBeNull()
  })
})

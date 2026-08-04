import { describe, expect, it } from 'vitest'
import { resolvePageUpgradeExecution } from '../page-upgrade-plan'
import type { PageUpgradeProviders } from '../page-upgrade-plan'

function providers(overrides: Partial<PageUpgradeProviders> = {}): PageUpgradeProviders {
  return { github: null, wordpress: null, shopify: null, ...overrides }
}

describe('resolvePageUpgradeExecution', () => {
  it('prefers a matching WordPress connection for a WordPress page', () => {
    const result = resolvePageUpgradeExecution('https://www.example.com/services/', providers({
      github: {
        connected: true, provider: 'github', repoOwner: 'o', repoName: 'r',
        branch: 'main', tokenHint: null, status: 'connected', lastError: null,
        lastTestedAt: null, contentTargets: [], contentPaths: [],
      },
      wordpress: {
        connected: true, provider: 'wordpress', siteUrl: 'https://example.com',
        username: 'me', tokenHint: null, status: 'connected', lastError: null,
        lastTestedAt: null, yoastPluginInstalled: true, wpDefaultCategoryId: null,
      },
    }))
    expect(result.mode).toBe('wordpress_rewriter')
  })

  it('uses GitHub for static or code-backed sites', () => {
    const result = resolvePageUpgradeExecution('https://magicengine.com.au/travel', providers({
      github: {
        connected: true, provider: 'github', repoOwner: 'o', repoName: 'r',
        branch: 'main', tokenHint: null, status: 'connected', lastError: null,
        lastTestedAt: null, contentTargets: [], contentPaths: ['website/travel.html'],
      },
    }))
    expect(result).toMatchObject({ provider: 'github', mode: 'github_pr' })
  })

  it('does not send a different domain to WordPress', () => {
    const result = resolvePageUpgradeExecution('https://other.example/page', providers({
      wordpress: {
        connected: true, provider: 'wordpress', siteUrl: 'https://example.com',
        username: 'me', tokenHint: null, status: 'connected', lastError: null,
        lastTestedAt: null, yoastPluginInstalled: true, wpDefaultCategoryId: null,
      },
    }))
    expect(result).toMatchObject({ provider: 'none', mode: 'draft_only' })
  })

  it('keeps Shopify and disconnected clients in draft-only mode', () => {
    const shopify = resolvePageUpgradeExecution('https://shop.example/page', providers({
      shopify: {
        connected: true, provider: 'shopify', shopUrl: 'https://shop.myshopify.com',
        tokenHint: null, status: 'connected', lastError: null, lastTestedAt: null,
      },
    }))
    expect(shopify).toMatchObject({ provider: 'shopify', mode: 'draft_only' })
    expect(resolvePageUpgradeExecution('https://example.com', providers()).mode).toBe('draft_only')
  })
})

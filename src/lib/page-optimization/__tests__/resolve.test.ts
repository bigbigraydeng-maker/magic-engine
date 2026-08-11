import { describe, it, expect } from 'vitest'
import { resolveCanonicalIdentity, resolvePage, resolveRouting } from '../resolve'
import type { PageUpgradeProviders } from '@/lib/cms/page-upgrade-plan'

const NO_PROVIDERS: PageUpgradeProviders = { github: null, wordpress: null, shopify: null }

describe('resolveRouting', () => {
  it('未连接任何 provider → 诚实回退到 draft_only，不猜一个能写的路径', () => {
    const plan = resolveRouting('https://romanhu.com/listings/123', NO_PROVIDERS)
    expect(plan.provider).toBe('none')
    expect(plan.mode).toBe('draft_only')
  })

  it('原样转发 resolvePageUpgradeExecution 的结果——不重新实现路由逻辑', () => {
    const providers: PageUpgradeProviders = {
      github: {
        connected: true,
        provider: 'github',
        repoOwner: 'owner',
        repoName: 'repo',
        branch: 'main',
        tokenHint: 'abcd',
        status: 'connected',
        lastError: null,
        lastTestedAt: null,
        contentPaths: ['index.html'],
        contentTargets: [],
      },
      wordpress: null,
      shopify: null,
    }
    const plan = resolveRouting('https://romanhu.com/listings/123', providers)
    expect(plan.provider).toBe('github')
    expect(plan.mode).toBe('github_pr')
  })
})

describe('resolveCanonicalIdentity', () => {
  it('域名不匹配 → 显式 unknown，不许猜', () => {
    const identity = resolveCanonicalIdentity('https://evil-lookalike.com/listings/123', 'romanhu.com')
    expect(identity.known).toBe(false)
    if (!identity.known) expect(identity.reason).toBe('source_ambiguous')
  })

  it('客户没填域名 → 显式 unknown（Roman 的现状：判断不了 ≠ 是）', () => {
    const identity = resolveCanonicalIdentity('https://romanhu.com/listings/123', null)
    expect(identity.known).toBe(false)
  })

  it('域名匹配 → 产出规范身份，路径去掉 query/fragment/trailing slash', () => {
    const identity = resolveCanonicalIdentity('https://romanhu.com/listings/123/?utm=x#top', 'romanhu.com')
    expect(identity.known).toBe(true)
    if (identity.known) {
      expect(identity.value.domain).toBe('romanhu.com')
      expect(identity.value.normalizedPath).toBe('/listings/123')
    }
  })
})

describe('resolvePage 是确定性的', () => {
  it('同一输入调用两次，产出逐字段相同的结果', () => {
    const input = {
      pageUrl: 'https://romanhu.com/listings/123',
      clientDomain: 'romanhu.com',
      providers: NO_PROVIDERS,
    }
    expect(resolvePage(input)).toEqual(resolvePage(input))
  })
})

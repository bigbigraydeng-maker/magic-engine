import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSitePageForClient: vi.fn(),
  getWordpressConnection: vi.fn(),
  getExistingWordpressPost: vi.fn(),
  probeWordpressAtomicPageApply: vi.fn(),
}))

vi.mock('@/lib/db/site-pages', () => ({
  getSitePageForClient: mocks.getSitePageForClient,
}))
vi.mock('@/lib/cms/connection-store', () => ({
  getWordpressConnection: mocks.getWordpressConnection,
}))
vi.mock('@/lib/cms/wordpress-client', () => ({
  getExistingWordpressPost: mocks.getExistingWordpressPost,
  probeWordpressAtomicPageApply: mocks.probeWordpressAtomicPageApply,
}))

import {
  isTenantBoundWordpressSource,
  loadTenantBoundWordpressSource,
} from '../source'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const PAGE_URL = 'https://customer-zero.example.nz/'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSitePageForClient.mockResolvedValue({
    id: 'page-42',
    client_id: CLIENT,
    url: PAGE_URL,
  })
  mocks.getWordpressConnection.mockResolvedValue({
    siteUrl: 'https://customer-zero.example.nz',
    username: 'fixture',
    plainAppPassword: 'not-real',
    status: 'connected',
    yoastPluginInstalled: true,
  })
  mocks.getExistingWordpressPost.mockResolvedValue({
    postId: 42,
    postType: 'page',
    title: 'Example Tours',
    content: '<main>Example Tours</main>',
    status: 'publish',
    link: PAGE_URL,
    modified: '2026-08-20T01:00:00.000Z',
    seoTitle: 'Escorted Tours from New Zealand | Example Tours',
    seoDescription: 'Escorted tours from New Zealand.',
  })
  mocks.probeWordpressAtomicPageApply.mockResolvedValue(true)
})

describe('loadTenantBoundWordpressSource', () => {
  it('loads all facts itself and mints one immutable source', async () => {
    const result = await loadTenantBoundWordpressSource({
      clientId: CLIENT,
      pageId: 'page-42',
      postId: 42,
      postType: 'page',
    })

    expect(result).toMatchObject({
      ok: true,
      source: {
        clientId: CLIENT,
        targetPageUrl: PAGE_URL,
        pageLedgerRef: 'client_site_pages:page-42',
        postId: 42,
        postType: 'page',
        snapshot: { provider: 'wordpress', versionToken: '2026-08-20T01:00:00.000Z' },
      },
    })
    if (!result.ok) return
    expect(isTenantBoundWordpressSource(result.source)).toBe(true)
    expect(isTenantBoundWordpressSource({ ...result.source })).toBe(false)
    expect(Object.isFrozen(result.source)).toBe(true)
    expect(mocks.getSitePageForClient).toHaveBeenCalledWith(CLIENT, 'page-42')
    expect(mocks.getWordpressConnection).toHaveBeenCalledWith(CLIENT)
    expect(mocks.getExistingWordpressPost).toHaveBeenCalledTimes(1)
  })

  it('does not reach credentials/provider when the tenant-filtered ledger row is absent', async () => {
    mocks.getSitePageForClient.mockResolvedValueOnce(null)
    await expect(loadTenantBoundWordpressSource({
      clientId: CLIENT,
      pageId: 'foreign-page',
      postId: 42,
      postType: 'page',
    })).resolves.toEqual({ ok: false, reason: 'ledger_page_not_found' })
    expect(mocks.getWordpressConnection).not.toHaveBeenCalled()
    expect(mocks.getExistingWordpressPost).not.toHaveBeenCalled()
  })

  it('rejects a connection for another domain before provider read', async () => {
    mocks.getWordpressConnection.mockResolvedValueOnce({
      siteUrl: 'https://example.com',
      username: 'fixture',
      plainAppPassword: 'not-real',
      status: 'connected',
      yoastPluginInstalled: true,
    })
    await expect(loadTenantBoundWordpressSource({
      clientId: CLIENT,
      pageId: 'page-42',
      postId: 42,
      postType: 'page',
    })).resolves.toEqual({ ok: false, reason: 'connection_domain_mismatch' })
    expect(mocks.getExistingWordpressPost).not.toHaveBeenCalled()
  })

  it('does not mint a source when provider-side CAS is unavailable', async () => {
    mocks.probeWordpressAtomicPageApply.mockResolvedValueOnce(false)
    await expect(loadTenantBoundWordpressSource({
      clientId: CLIENT,
      pageId: 'page-42',
      postId: 42,
      postType: 'page',
    })).resolves.toEqual({ ok: false, reason: 'atomic_apply_unavailable' })
    expect(mocks.getExistingWordpressPost).not.toHaveBeenCalled()
  })

  it('rejects a live post that does not exactly match the ledger page', async () => {
    mocks.getExistingWordpressPost.mockResolvedValueOnce({
      postId: 42,
      postType: 'page',
      title: 'Other',
      content: '<main>Other</main>',
      status: 'publish',
      link: 'https://customer-zero.example.nz/china-tours/',
      modified: '2026-08-20T01:00:00.000Z',
    })
    await expect(loadTenantBoundWordpressSource({
      clientId: CLIENT,
      pageId: 'page-42',
      postId: 42,
      postType: 'page',
    })).resolves.toEqual({ ok: false, reason: 'wordpress_post_mismatch' })
  })
})

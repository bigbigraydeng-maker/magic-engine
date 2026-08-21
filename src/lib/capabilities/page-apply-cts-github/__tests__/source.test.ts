import { beforeEach, describe, expect, it, vi } from 'vitest'

const sourceMocks = vi.hoisted(() => ({
  loadPage: vi.fn(),
  loadConnection: vi.fn(),
  githubConstructor: vi.fn(),
  listDirectory: vi.fn(),
  getFileContent: vi.fn(),
}))
vi.mock('@/lib/db/site-pages', () => ({ getSitePageForClient: sourceMocks.loadPage }))
vi.mock('@/lib/cms/connection-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/cms/connection-store')>(),
  getConnection: sourceMocks.loadConnection,
}))
vi.mock('@/lib/cms/github-client', () => ({
  GithubClient: class {
    constructor(token: string) { sourceMocks.githubConstructor(token) }
    listDirectory = sourceMocks.listDirectory
    getFileContent = sourceMocks.getFileContent
  },
}))
import {
  isTenantBoundCtsGithubSource,
  loadTenantBoundCtsGithubSource,
} from '../source'
import { CTS_CLIENT_ID } from '@/lib/seo-meta/cts-meta-source'

const PAGE_ID = 'c7500000-0000-4000-8000-000000000001'
const PAGE_URL = 'https://www.ctstours.co.nz/china-tours'
const PATH = 'src/lib/data/seo-pages.ts'
const VALID_SOURCE = `export const pages = [{
  slug: 'china-tours',
  title: 'China Tours | CTS',
  description: 'Escorted China tours.',
  h1: 'China Tours from New Zealand',
}]\n`

function configure(source = VALID_SOURCE): void {
  sourceMocks.loadPage.mockResolvedValue({ id: PAGE_ID, client_id: CTS_CLIENT_ID, url: PAGE_URL })
  sourceMocks.loadConnection.mockResolvedValue({
    connected: true,
    provider: 'github',
    repoOwner: 'owner',
    repoName: 'repo',
    branch: 'main',
    tokenHint: 'test',
    status: 'connected',
    lastError: null,
    lastTestedAt: null,
    contentPaths: [PATH],
    contentTargets: [],
    plainToken: 'not-a-real-token',
  })
  sourceMocks.listDirectory.mockResolvedValue([
    { name: 'seo-pages.ts', path: PATH, type: 'file' },
  ])
  sourceMocks.getFileContent.mockResolvedValue({ sha: 'blob-sha', decodedContent: source })
}

describe('CTS tenant-bound GitHub source loader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configure()
  })

  it('mints an immutable trusted source only through tenant ledger + connection + provider reads', async () => {
    const result = await loadTenantBoundCtsGithubSource({ clientId: CTS_CLIENT_ID, pageId: PAGE_ID })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(isTenantBoundCtsGithubSource(result.source)).toBe(true)
    expect(isTenantBoundCtsGithubSource({ ...result.source })).toBe(false)
    expect(result.source).toMatchObject({
      clientId: CTS_CLIENT_ID,
      pageLedgerRef: `client_site_pages:${PAGE_ID}`,
      targetPageUrl: PAGE_URL,
      entrySlug: 'china-tours',
      contentPath: PATH,
      versionToken: 'blob-sha',
      current: { h1: 'China Tours from New Zealand' },
    })
    expect(sourceMocks.loadPage).toHaveBeenCalledWith(CTS_CLIENT_ID, PAGE_ID)
    expect(sourceMocks.loadConnection).toHaveBeenCalledWith(CTS_CLIENT_ID)
    expect(sourceMocks.githubConstructor).toHaveBeenCalledWith('not-a-real-token')
  })

  it('rejects every non-CTS identity before tenant/provider access', async () => {
    await expect(loadTenantBoundCtsGithubSource(
      { clientId: 'c11e0000-0000-4000-8000-00000000000b', pageId: PAGE_ID },
    )).resolves.toEqual({ ok: false, reason: 'invalid_identity' })
    expect(sourceMocks.loadPage).not.toHaveBeenCalled()
    expect(sourceMocks.loadConnection).not.toHaveBeenCalled()
    expect(sourceMocks.githubConstructor).not.toHaveBeenCalled()
  })

  it('rejects a page row returned for another tenant', async () => {
    sourceMocks.loadPage.mockResolvedValue({
      id: PAGE_ID,
      client_id: 'c11e0000-0000-4000-8000-00000000000b',
      url: PAGE_URL,
    })
    await expect(loadTenantBoundCtsGithubSource(
      { clientId: CTS_CLIENT_ID, pageId: PAGE_ID },
    )).resolves.toEqual({ ok: false, reason: 'ledger_page_not_found' })
    expect(sourceMocks.loadConnection).not.toHaveBeenCalled()
  })

  it('fails closed when the target slug appears more than once', async () => {
    configure(`${VALID_SOURCE}\nexport const duplicate = {
      slug: 'china-tours',
      title: 'Duplicate',
      description: 'Must not win.',
      h1: 'Duplicate H1',
    }\n`)
    await expect(loadTenantBoundCtsGithubSource(
      { clientId: CTS_CLIENT_ID, pageId: PAGE_ID },
    )).resolves.toEqual({ ok: false, reason: 'target_source_not_found' })
  })
})

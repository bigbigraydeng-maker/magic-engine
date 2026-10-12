import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProtectedPageError } from '@/lib/seo/protected-pages'
import { gateFake, realGuard } from '@/lib/seo/__tests__/gate-test-kit'

const github = {
  getFileContent: vi.fn(),
  getBranchSha: vi.fn(),
  createBranch: vi.fn(),
  commitFile: vi.fn(),
  createPullRequest: vi.fn(),
}
const conn = { connected: true, repoOwner: 'o', repoName: 'r', branch: 'main', plainToken: 't', contentPaths: ['public/en/china-tours.html', 'public/about.html'] }

vi.mock('../connection-store', () => ({ getConnection: vi.fn(async () => conn) }))
vi.mock('../github-client', () => ({
  GithubClient: vi.fn(() => github),
  GitHubApiError: class GitHubApiError extends Error {},
}))
vi.mock('../../supabase', () => ({
  supabaseAdmin: {
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'fa-1' }, error: null }) }) }) }),
  },
}))

import { publishPageUpgradeToGithub } from '../github-page-upgrade-publisher'

const HTML = '<html><head><title>Old</title><meta name="description" content="Old"></head><body><main><p>x</p></main></body></html>'

function input(pageUrl: string, guard: ReturnType<typeof realGuard>) {
  return {
    clientId: 'client-1', pageId: 'p1', pageUrl,
    enhancedTitle: 'T', enhancedMetaTitle: 'T', enhancedMetaDescription: 'D', enhancedHtmlBody: '<p>b</p>', guard,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  github.getFileContent.mockResolvedValue({ decodedContent: HTML, sha: 's1' })
  github.getBranchSha.mockResolvedValue('b1')
  github.createBranch.mockResolvedValue(undefined)
  github.commitFile.mockResolvedValue(undefined)
  github.createPullRequest.mockResolvedValue({ html_url: 'https://github.com/o/r/pull/1', number: 1 })
})

const noWrites = () => {
  expect(github.createBranch).not.toHaveBeenCalled()
  expect(github.commitFile).not.toHaveBeenCalled()
  expect(github.createPullRequest).not.toHaveBeenCalled()
}

describe('publishPageUpgradeToGithub — protected-page gate', () => {
  it('🔴 protected page URL + non-PM: refused before any write', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(publishPageUpgradeToGithub(input('https://x.com/about', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
    noWrites()
  })

  it('🔴 the URL looks harmless but the file it resolves to is protected (path entry matched against the resolved file path)', async () => {
    // page_url /china-tours resolves to public/en/china-tours.html; the list protects "en/china-tours"
    const fake = gateFake({ meta_cycle_protected_slugs: ['en/china-tours'] })
    await expect(publishPageUpgradeToGithub(input('https://x.com/china-tours', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
    noWrites()
  })

  it('🔴 gate runs BEFORE the NO_TARGET answer: a protected URL with no source file is refused, not "no file found"', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['no-file-page'] })
    await expect(publishPageUpgradeToGithub(input('https://x.com/no-file-page', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
  })

  it('percent-encoded URL cannot dodge the list', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(publishPageUpgradeToGithub(input('https://x.com/%41bout', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
    noWrites()
  })

  it('PM may change a protected page (receipt first)', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    const result = await publishPageUpgradeToGithub(input('https://x.com/about', realGuard(fake, 'pm')))
    expect(result.ok).toBe(true)
    expect(fake.receipts[0]?.summary).toMatchObject({ decision: 'allowed_pm_override' })
  })

  it('unprotected page proceeds for everyone', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['something-else'] })
    const result = await publishPageUpgradeToGithub(input('https://x.com/about', realGuard(fake, 'fde')))
    expect(result.ok).toBe(true)
    expect(fake.receipts).toHaveLength(0)
  })

  it('🔴 a guard built for ANOTHER client is rejected (it would check the wrong client\'s list)', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(publishPageUpgradeToGithub(input('https://x.com/about', realGuard(fake, 'fde', 'client-OTHER')))).rejects.toThrow(/belongs to client/)
    noWrites()
  })
})

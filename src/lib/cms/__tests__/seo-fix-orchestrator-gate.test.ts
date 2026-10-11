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

vi.mock('../connection-store', () => ({
  getConnection: vi.fn(async () => ({ repoOwner: 'o', repoName: 'r', branch: 'main', plainToken: 't' })),
}))
vi.mock('../github-client', () => ({
  GithubClient: vi.fn(() => github),
  GitHubApiError: class GitHubApiError extends Error {},
}))
vi.mock('../../supabase', () => ({
  supabaseAdmin: {
    from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'fa-1' }, error: null }) }) }) }),
  },
}))

import { orchestrateSeoFix } from '../seo-fix-orchestrator'

const FILE = `export const pages = [\n  { slug: 'china-tours', metaTitle: 'Old' },\n  { slug: 'open-page', metaTitle: 'Old' },\n]\n`
// the FIRST `slug: 'open-page'` is a nested reference inside the protected entry: a text-window patch would edit THAT entry
const NESTED_FIRST = `export const pages = [\n  { slug: 'china-tours', metaTitle: 'Old', related: [{ slug: 'open-page' }] },\n  { slug: 'open-page', metaTitle: 'Old' },\n]\n`
// a later nested reference is harmless: the first anchor is the entry itself
const NESTED_LATER = `export const pages = [\n  { slug: 'open-page', metaTitle: 'Old' },\n  { slug: 'china-tours', metaTitle: 'Old', related: [{ slug: 'open-page' }] },\n]\n`

function input(slug: string, guard: ReturnType<typeof realGuard>) {
  return { clientId: 'client-1', fix: { filePath: 'src/lib/data/pages.ts', slug, field: 'metaTitle', oldValue: 'Old', newValue: 'New', reason: 'r' }, guard }
}

beforeEach(() => {
  vi.clearAllMocks()
  github.getFileContent.mockResolvedValue({ decodedContent: FILE, sha: 's1' })
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

describe('orchestrateSeoFix — protected-page gate', () => {
  it('🔴 protected slug + non-PM: refused, nothing written to the customer repo, denial receipt written', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['china-tours'] })
    await expect(orchestrateSeoFix(input('china-tours', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
    noWrites()
    expect(fake.receipts[0]?.summary).toMatchObject({ decision: 'denied_not_pm' })
  })

  it('protected slug + PM: allowed, but only after the override receipt is written', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['china-tours'] })
    const result = await orchestrateSeoFix(input('china-tours', realGuard(fake, 'pm')))
    expect(result.ok).toBe(true)
    expect(fake.receipts[0]?.summary).toMatchObject({ decision: 'allowed_pm_override' })
  })

  it('🔴 first anchor is a nested reference inside another entry => target page unknown => refused for non-PM', async () => {
    github.getFileContent.mockResolvedValue({ decodedContent: NESTED_FIRST, sha: 's1' })
    const fake = gateFake({ meta_cycle_protected_slugs: ['china-tours'] })
    await expect(orchestrateSeoFix(input('open-page', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
    noWrites()
    expect(fake.receipts[0]?.summary).toMatchObject({ decision: 'denied_unknown' })
  })

  it('a slug that is ALSO referenced later is fine: the patch anchors on the entry itself', async () => {
    github.getFileContent.mockResolvedValue({ decodedContent: NESTED_LATER, sha: 's1' })
    const fake = gateFake({ meta_cycle_protected_slugs: ['china-tours'] })
    const result = await orchestrateSeoFix(input('open-page', realGuard(fake, 'fde')))
    expect(result.ok).toBe(true)
  })

  it('🔴 refusal comes BEFORE the patch is attempted: a wrong old_value on a protected page does not reveal itself', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['china-tours'] })
    const bad = { ...input('china-tours', realGuard(fake, 'fde')), fix: { ...input('china-tours', realGuard(fake, 'fde')).fix, oldValue: 'NOT-THE-REAL-VALUE' } }
    await expect(orchestrateSeoFix(bad)).rejects.toBeInstanceOf(ProtectedPageError)
  })

  it('🔴 malformed list or failed lookup => refused (fail-closed), not "protect nothing"', async () => {
    for (const fake of [gateFake({ meta_cycle_protected_slugs: 'china-tours' }), gateFake({}, { lookupError: true })]) {
      await expect(orchestrateSeoFix(input('open-page', realGuard(fake, 'fde')))).rejects.toBeInstanceOf(ProtectedPageError)
    }
    noWrites()
  })

  it('unprotected slug + non-PM: proceeds to open the PR and writes no receipt', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['china-tours'] })
    const result = await orchestrateSeoFix(input('open-page', realGuard(fake, 'fde')))
    expect(result.ok).toBe(true)
    expect(github.createBranch).toHaveBeenCalledTimes(1)
    expect(fake.receipts).toHaveLength(0)
  })

  it('🔴 a guard built for ANOTHER client is rejected (it would check the wrong client\'s list)', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['about'] })
    await expect(orchestrateSeoFix(input('open-page', realGuard(fake, 'fde', 'client-OTHER')))).rejects.toThrow(/belongs to client/)
    noWrites()
  })
})

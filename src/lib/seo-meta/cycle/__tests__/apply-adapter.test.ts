import { describe, expect, it, vi } from 'vitest'
import { createCtsRepoApplyAdapter } from '../apply-adapter'
import type { MetaCycleCandidate } from '../types'

const DATA_FILE = 'src/lib/data/seo-pages.ts'
const SOURCE = `export const pages = [\n  { slug: 'foo', title: 'Old Title', description: 'Old desc' },\n]\n`

function candidate(overrides: Partial<MetaCycleCandidate> = {}): MetaCycleCandidate {
  return {
    pageUrl: 'https://example.com/foo',
    slug: 'foo',
    keyword: 'foo keyword',
    source: 'gsc',
    position: 8,
    impressions: 100,
    ctr: 0.05,
    searchVolume: 500,
    keywordDifficulty: 30,
    ...overrides,
  }
}

/** Minimal fake covering exactly the GithubClient surface apply-adapter.ts calls. */
function fakeGithub(opts: { mergeResult: boolean | Error; existingPr?: { number: number; html_url: string } }) {
  return {
    listDirectory: vi.fn().mockResolvedValue([{ name: 'seo-pages.ts', path: DATA_FILE, type: 'file' }]),
    getFileContent: vi.fn().mockResolvedValue({ decodedContent: SOURCE, sha: 'blob-sha-1', content: '', size: SOURCE.length }),
    listPullRequestsByHead: vi.fn().mockResolvedValue(
      opts.existingPr ? [{ number: opts.existingPr.number, html_url: opts.existingPr.html_url, title: 't' }] : [],
    ),
    getBranchSha: vi.fn().mockResolvedValue('base-sha-1'),
    createBranch: vi.fn().mockResolvedValue(undefined),
    commitFile: vi.fn().mockResolvedValue(undefined),
    createPullRequest: vi.fn().mockResolvedValue({ number: 99, html_url: 'https://github.com/x/y/pull/99', title: 't' }),
    mergePullRequest: vi.fn().mockImplementation(async () => {
      if (opts.mergeResult instanceof Error) throw opts.mergeResult
      return opts.mergeResult
    }),
    closePullRequest: vi.fn(),
    deleteBranch: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const CONN = { repoOwner: 'owner', repoName: 'repo', defaultBranch: 'main', dataDir: 'src/lib/data' }

describe('createCtsRepoApplyAdapter.apply — merge-state correctness (fixed bug: applied:true even when merge failed)', () => {
  it('returns applied:true when the PR actually merges', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN)
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false })
    expect(result.applied).toBe(true)
    expect(result.skipReason).toBeUndefined()
    expect(result.prUrl).toBe('https://github.com/x/y/pull/99')
  })

  it('returns applied:false with skipReason pr_opened_but_not_merged when mergePullRequest returns false (CI blocked, branch protection, etc.) — NOT applied:true', async () => {
    const github = fakeGithub({ mergeResult: false })
    const adapter = createCtsRepoApplyAdapter(github, CONN)
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('pr_opened_but_not_merged')
    // The PR link must still be surfaced so the caller can route a manual "go merge it" task.
    expect(result.prUrl).toBe('https://github.com/x/y/pull/99')
    expect(result.prNumber).toBe(99)
  })

  it('returns applied:false (not throwing, not applied:true) when mergePullRequest itself throws', async () => {
    const github = fakeGithub({ mergeResult: new Error('network blip') })
    const adapter = createCtsRepoApplyAdapter(github, CONN)
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('pr_opened_but_not_merged')
  })

  it('reuses an existing PR for the same (weekKey, slug) instead of opening a duplicate, and does not call mergePullRequest again', async () => {
    const github = fakeGithub({ mergeResult: true, existingPr: { number: 42, html_url: 'https://github.com/x/y/pull/42' } })
    const adapter = createCtsRepoApplyAdapter(github, CONN)
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toContain('pr_already_exists_for_this_cycle')
    expect(github.mergePullRequest).not.toHaveBeenCalled()
    expect(github.createPullRequest).not.toHaveBeenCalled()
  })

  it('is a no-op (no branch/commit/PR calls) in dry-run mode', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN)
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: true })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('dry_run')
    expect(github.createBranch).not.toHaveBeenCalled()
    expect(github.createPullRequest).not.toHaveBeenCalled()
  })
})

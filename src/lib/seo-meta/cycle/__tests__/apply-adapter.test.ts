import { describe, expect, it, vi } from 'vitest'
import { createCtsRepoApplyAdapter } from '../apply-adapter'
import { ProtectedPageError, type PageIdentity, type PageWriteGuard } from '@/lib/seo/protected-pages'
import type { MetaCycleCandidate, MetaCycleGateEvidence } from '../types'

const DATA_FILE = 'src/lib/data/seo-pages.ts'
const SOURCE = `export const pages = [\n  { slug: 'foo', title: 'Old Title', description: 'Old desc' },\n]\n`

const EVIDENCE: MetaCycleGateEvidence = {
  keyword: 'foo keyword',
  searchVolume: 500,
  keywordDifficulty: 30,
  snapshotDate: '2026-09-10',
  keywordDataSource: 'dataforseo_primary',
  keywordDataLocation: 2554,
  keywordDataNote: '搜索量/难度来自 NZ 市场的 DataForSEO 数据',
  competitorTitles: ['Competitor A', 'Competitor B'],
  ctsRankingUrl: 'https://example.com/foo',
  chosenReason: 'test evidence',
}

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

/** A guard double: `refuseOnCall` = 1-based call number on which assert throws (0 = never). */
function guardDouble(refuseOnCall = 0) {
  let calls = 0
  const assert = vi.fn(async (_identity: PageIdentity, _opts?: { targetType?: string }) => {
    calls += 1
    if (calls === refuseOnCall) throw new ProtectedPageError('protected', 'refused')
  })
  return { assert, guard: ({ clientId: 'c', assert }) as never as PageWriteGuard }
}
const openGuard = (): PageWriteGuard => guardDouble().guard

const CONN = { repoOwner: 'owner', repoName: 'repo', defaultBranch: 'main', dataDir: 'src/lib/data' }

describe('createCtsRepoApplyAdapter.apply — merge-state correctness (fixed bug: applied:true even when merge failed)', () => {
  it('returns applied:true when the PR actually merges', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence: EVIDENCE })
    expect(result.applied).toBe(true)
    expect(result.skipReason).toBeUndefined()
    expect(result.prUrl).toBe('https://github.com/x/y/pull/99')
  })

  it('returns applied:false with skipReason pr_opened_but_not_merged when mergePullRequest returns false (CI blocked, branch protection, etc.) — NOT applied:true', async () => {
    const github = fakeGithub({ mergeResult: false })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence: EVIDENCE })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('pr_opened_but_not_merged')
    // The PR link must still be surfaced so the caller can route a manual "go merge it" task.
    expect(result.prUrl).toBe('https://github.com/x/y/pull/99')
    expect(result.prNumber).toBe(99)
  })

  it('returns applied:false (not throwing, not applied:true) when mergePullRequest itself throws', async () => {
    const github = fakeGithub({ mergeResult: new Error('network blip') })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence: EVIDENCE })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('pr_opened_but_not_merged')
  })

  it('reuses an existing PR for the same (weekKey, slug) instead of opening a duplicate, and does not call mergePullRequest again', async () => {
    const github = fakeGithub({ mergeResult: true, existingPr: { number: 42, html_url: 'https://github.com/x/y/pull/42' } })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence: EVIDENCE })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toContain('pr_already_exists_for_this_cycle')
    expect(github.mergePullRequest).not.toHaveBeenCalled()
    expect(github.createPullRequest).not.toHaveBeenCalled()
  })

  it('is a no-op (no branch/commit/PR calls) in dry-run mode', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const result = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: true, evidence: EVIDENCE })
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('dry_run')
    expect(github.createBranch).not.toHaveBeenCalled()
    expect(github.createPullRequest).not.toHaveBeenCalled()
  })
})

describe('protected-page gate inside apply (the write-time hard stop)', () => {
  const input = { candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence: EVIDENCE }

  it('🔴 a refused page: no branch, no commit, no PR, no merge; reason is explicit', async () => {
    const github = fakeGithub({ mergeResult: true })
    const { guard, assert } = guardDouble(1)
    const result = await createCtsRepoApplyAdapter(github, CONN, guard).apply(input)
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('protected_page_blocked')
    expect(github.createBranch).not.toHaveBeenCalled()
    expect(github.commitFile).not.toHaveBeenCalled()
    expect(github.createPullRequest).not.toHaveBeenCalled()
    expect(github.mergePullRequest).not.toHaveBeenCalled()
    const identity = assert.mock.calls[0][0]
    expect(identity.slugs).toContain('foo')
    expect(identity.paths.map(p => p.value)).toContain('foo')
  })

  it('🔴 list changed after the PR was opened: the auto-merge is NOT performed, PR link is kept', async () => {
    const github = fakeGithub({ mergeResult: true })
    const { guard } = guardDouble(2)
    const result = await createCtsRepoApplyAdapter(github, CONN, guard).apply(input)
    expect(github.createPullRequest).toHaveBeenCalledTimes(1)
    expect(github.mergePullRequest).not.toHaveBeenCalled()
    expect(result.applied).toBe(false)
    expect(result.skipReason).toBe('protected_page_blocked_before_merge')
    expect(result.prNumber).toBe(99)
  })

  it('🔴 blocked before merge: the in-memory edit is ROLLED BACK, so the next candidate\'s commit does not carry it', async () => {
    const github = fakeGithub({ mergeResult: true })
    const { guard } = guardDouble(2) // 1st assert (before edit) passes, 2nd (before merge) refuses, later ones pass
    const adapter = createCtsRepoApplyAdapter(github, CONN, guard)
    const first = await adapter.apply(input)
    expect(first.skipReason).toBe('protected_page_blocked_before_merge')
    const firstCommit = github.commitFile.mock.calls[0][4] as string
    expect(firstCommit).toContain('New Title')

    // second candidate in the same run, same cached file: it must start from the ORIGINAL source again
    github.listPullRequestsByHead.mockResolvedValue([])
    await adapter.apply({ ...input, candidate: candidate({ slug: 'foo' }), newTitle: 'Other Title' })
    const secondCommit = github.commitFile.mock.calls[1][4] as string
    expect(secondCommit).not.toContain('New Title')
    expect(secondCommit).toContain('Other Title')
  })

  it('🔴 first `slug:` anchor is a nested reference in another entry => page unknown => gate sees an UNRESOLVED identity', async () => {
    const NESTED = `export const pages = [\n  { slug: 'china-tours', related: [{ slug: 'foo' }], title: 'T', description: 'D' },\n  { slug: 'foo', title: 'Old Title', description: 'Old desc' },\n]\n`
    const github = fakeGithub({ mergeResult: true })
    github.getFileContent.mockResolvedValue({ decodedContent: NESTED, sha: 'blob-sha-1', content: '', size: NESTED.length })
    const { guard, assert } = guardDouble(1)
    const result = await createCtsRepoApplyAdapter(github, CONN, guard).apply(input)
    expect(assert.mock.calls[0][0].unresolved).toBe('nested_slug_anchor')
    expect(result.skipReason).toBe('protected_page_blocked')
    expect(github.commitFile).not.toHaveBeenCalled()
  })

  it('dry-run never asks the gate (nothing is written)', async () => {
    const github = fakeGithub({ mergeResult: true })
    const { guard, assert } = guardDouble()
    await createCtsRepoApplyAdapter(github, CONN, guard).apply({ ...input, dryRun: true })
    expect(assert).not.toHaveBeenCalled()
  })

  it('a non-gate error is rethrown, not swallowed as "blocked"', async () => {
    const github = fakeGithub({ mergeResult: true })
    const guard = ({ clientId: 'c', assert: vi.fn(async () => { throw new Error('db down') }) }) as never as PageWriteGuard
    await expect(createCtsRepoApplyAdapter(github, CONN, guard).apply(input)).rejects.toThrow('db down')
  })
})

describe('PR 正文开在客户的公开仓库里：不许出现真实供应商名', () => {
  const bodyOf = (github: ReturnType<typeof fakeGithub>): string => github.createPullRequest.mock.calls[0][2].body

  it('市场数据那种来源说明换成封装名，标题原文不变', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence: EVIDENCE })
    const body = bodyOf(github)
    expect(body).not.toMatch(/dataforseo/i)
    expect(body).toContain('搜索量/难度来自 NZ 市场的 Keyword Intelligence 数据')
    expect(body).toContain('**New Title**')
    expect(body).toContain('- 标题: Old Title')
  })

  it('谷歌曝光估算那种来源说明也换', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const evidence: MetaCycleGateEvidence = {
      ...EVIDENCE,
      keywordDataSource: 'gsc_serp',
      keywordDataNote: '需求来自谷歌后台真实曝光 214 次；难度按谷歌前三名网站强度估算为 12（非 DataForSEO 难度分）',
    }
    await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W38', dryRun: false, evidence })
    const body = bodyOf(github)
    expect(body).not.toMatch(/dataforseo/i)
    expect(body).toContain('（非 Keyword Intelligence 难度分）')
  })
})

describe('destination guides (guides.ts) are editable, with the guide field style', () => {
  const GUIDES_FILE = 'src/lib/data/guides.ts'
  const GUIDES = [
    "export const chongqingGuide: DestinationGuide = {",
    "  id: 'guide-chongqing',",
    "  slug: 'chongqing-travel-guide',",
    "  metaTitle: 'Old Chongqing Title | CTS Tours NZ',",
    "  metaDescription: 'Old chongqing desc.',",
    "  sections: [",
    "    { title: 'Liziba Station', id: 'liziba-station', content: ['b'] },",
    "  ],",
    "};",
    "",
  ].join('\n')

  function guidesGithub() {
    const gh = fakeGithub({ mergeResult: true })
    gh.listDirectory.mockResolvedValue([
      { name: 'guides.ts', path: GUIDES_FILE, type: 'file' },
      { name: 'guides-extra.ts', path: 'src/lib/data/guides-extra.ts', type: 'file' },
      { name: 'unrelated.ts', path: 'src/lib/data/unrelated.ts', type: 'file' },
    ])
    gh.getFileContent.mockImplementation(async (_o: string, _r: string, path: string) =>
      path === GUIDES_FILE ? { decodedContent: GUIDES, sha: 'guides-sha', content: '', size: GUIDES.length } : { decodedContent: "export const x = [{ slug: 'chongqing-travel-guide', title: 'WRONG', description: 'WRONG' }]", sha: 'other', content: '', size: 10 })
    return gh
  }

  it('a guide slug is now editable, and only guides.ts (exact name) is read — look-alike names are not', async () => {
    const gh = guidesGithub()
    const adapter = createCtsRepoApplyAdapter(gh, CONN, openGuard())
    expect(await adapter.canEditSlug('chongqing-travel-guide')).toBe(true)
    const readPaths = gh.getFileContent.mock.calls.map((c: unknown[]) => c[2])
    expect(readPaths).toEqual([GUIDES_FILE])
  })

  it('the commit changes ONLY metaTitle and metaDescription — the section title is untouched', async () => {
    const gh = guidesGithub()
    const adapter = createCtsRepoApplyAdapter(gh, CONN, openGuard())
    const res = await adapter.apply({ candidate: candidate({ slug: 'chongqing-travel-guide', pageUrl: 'https://example.com/chongqing-travel-guide' }), newTitle: 'New Chongqing Title', newDesc: 'New chongqing desc.', weekKey: '2026-W41', dryRun: false, evidence: EVIDENCE })
    expect(res.applied).toBe(true)
    expect(res.oldTitle).toBe('Old Chongqing Title | CTS Tours NZ')
    const committed = gh.commitFile.mock.calls[0][4] as string
    expect(committed).toContain("metaTitle: 'New Chongqing Title'")
    expect(committed).toContain("metaDescription: 'New chongqing desc.'")
    expect(committed).toContain("{ title: 'Liziba Station', id: 'liziba-station'")
    expect(gh.commitFile.mock.calls[0][2]).toBe(GUIDES_FILE)
  })
})

describe('dry run with empty new text is a pure read (runner reads the current text this way, 2026-10-28)', () => {
  it('returns the current title/description and never touches GitHub', async () => {
    const github = fakeGithub({ mergeResult: true })
    const adapter = createCtsRepoApplyAdapter(github, CONN, openGuard())
    const res = await adapter.apply({ candidate: candidate(), newTitle: '', newDesc: '', weekKey: '2026-W44', dryRun: true, evidence: EVIDENCE })
    expect(res.skipReason).toBe('dry_run')
    expect(res.oldTitle).toBe('Old Title')
    expect(res.oldDesc).toBe('Old desc')
    expect(github.createBranch).not.toHaveBeenCalled()
    expect(github.commitFile).not.toHaveBeenCalled()
    expect(github.createPullRequest).not.toHaveBeenCalled()

    // and a real apply afterwards still writes the real new text (the empty read did not pollute the cache)
    const real = await adapter.apply({ candidate: candidate(), newTitle: 'New Title', newDesc: 'New desc', weekKey: '2026-W44', dryRun: false, evidence: EVIDENCE })
    expect(real.applied).toBe(true)
    const committed = (github.commitFile.mock.calls[0] ?? []).map(String).join(' ')
    expect(committed).toContain('New Title')
    expect(committed).not.toMatch(/title: ''/)
  })
})


import { describe, expect, it } from 'vitest'
import { metaCycleBranchName, parseMetaCycleBranch, resolvePrGuard } from '../pr-guard'

interface FakePr {
  number: number
  html_url: string
  title: string
  head: { ref: string }
}

function fakeGithub(prsByHead: Record<string, FakePr[]>, openUnderPrefix: FakePr[]) {
  return {
    listPullRequestsByHead: async (_owner: string, _repo: string, headBranch: string) =>
      (prsByHead[headBranch] ?? []).map(({ number, html_url, title }) => ({ number, html_url, title })),
    listPullRequestsByBranchPrefix: async () => openUnderPrefix,
  }
}

describe('metaCycleBranchName / parseMetaCycleBranch', () => {
  it('round-trips weekKey and slug', () => {
    const branch = metaCycleBranchName('2026-W38', 'rotorua-tours')
    expect(parseMetaCycleBranch(branch)).toEqual({ weekKey: '2026-W38', slug: 'rotorua-tours' })
  })

  it('sanitises unsafe slug characters out of the slug portion (the branch/ separator itself is expected)', () => {
    const branch = metaCycleBranchName('2026-W38', 'a/b?c')
    const slugPortion = branch.replace('feat/me-seo-meta-cycle-2026-W38-', '')
    expect(slugPortion).not.toMatch(/[/?]/)
  })
})

describe('resolvePrGuard — idempotency (子牙 finding #2)', () => {
  it('reuses an existing PR (open) for the exact same (weekKey, slug) instead of opening a duplicate', async () => {
    const branch = metaCycleBranchName('2026-W38', 'foo')
    const github = fakeGithub({ [branch]: [{ number: 42, html_url: 'https://github.com/x/y/pull/42', title: 't', head: { ref: branch } }] }, [])
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('reuse_existing')
    expect(decision.existingPr?.number).toBe(42)
  })

  it('reuses an existing PR even if it was already merged (event replay after a successful run)', async () => {
    // listPullRequestsByHead is called with state='all' inside resolvePrGuard,
    // so a merged-and-closed PR for this exact branch still counts.
    const branch = metaCycleBranchName('2026-W38', 'foo')
    const github = fakeGithub({ [branch]: [{ number: 42, html_url: 'https://github.com/x/y/pull/42', title: 't', head: { ref: branch } }] }, [])
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('reuse_existing')
  })
})

describe('resolvePrGuard — orphaned PRs (魏征 finding #8)', () => {
  it('flags an open PR from an earlier week touching the same slug as an orphan to close', async () => {
    const oldBranch = metaCycleBranchName('2026-W36', 'foo')
    const github = fakeGithub({}, [{ number: 10, html_url: 'https://github.com/x/y/pull/10', title: 't', head: { ref: oldBranch } }])
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('close_orphans_then_open')
    expect(decision.orphans).toHaveLength(1)
    expect(decision.orphans[0].weekKey).toBe('2026-W36')
  })

  it('does not flag an open PR for a DIFFERENT slug as an orphan', async () => {
    const otherSlugBranch = metaCycleBranchName('2026-W36', 'bar')
    const github = fakeGithub({}, [{ number: 10, html_url: 'https://github.com/x/y/pull/10', title: 't', head: { ref: otherSlugBranch } }])
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('open_new')
    expect(decision.orphans).toHaveLength(0)
  })

  it('proceeds as open_new when there is no exact match and no orphan', async () => {
    const github = fakeGithub({}, [])
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('open_new')
  })
})

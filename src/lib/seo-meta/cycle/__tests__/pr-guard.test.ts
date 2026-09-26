import { describe, expect, it } from 'vitest'
import { metaCycleBranchName, resolvePrGuard } from '../pr-guard'

interface FakePr {
  number: number
  html_url: string
  title: string
}

function fakeGithub(prsByHead: Record<string, FakePr[]>) {
  return {
    listPullRequestsByHead: async (_owner: string, _repo: string, headBranch: string) => prsByHead[headBranch] ?? [],
  }
}

describe('metaCycleBranchName', () => {
  it('is deterministic for the same (weekKey, slug)', () => {
    expect(metaCycleBranchName('2026-W38', 'rotorua-tours')).toBe(metaCycleBranchName('2026-W38', 'rotorua-tours'))
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
    const github = fakeGithub({ [branch]: [{ number: 42, html_url: 'https://github.com/x/y/pull/42', title: 't' }] })
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('reuse_existing')
    expect(decision.existingPr?.number).toBe(42)
  })

  it('reuses an existing PR even if it was already merged (event replay after a successful run — state="all" catches it)', async () => {
    const branch = metaCycleBranchName('2026-W38', 'foo')
    const github = fakeGithub({ [branch]: [{ number: 42, html_url: 'https://github.com/x/y/pull/42', title: 't' }] })
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('reuse_existing')
  })

  it('proceeds as open_new when there is no exact match', async () => {
    const github = fakeGithub({})
    const decision = await resolvePrGuard(github, 'owner', 'repo', '2026-W38', 'foo')
    expect(decision.action).toBe('open_new')
    expect(decision.existingPr).toBeNull()
  })
})

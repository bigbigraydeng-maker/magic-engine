/**
 * commit step 的三类分支：
 *   (a) commitFile 抛 + branch 上内容 = patched_content → 真幂等（重试成功过）
 *   (b) commitFile 抛 + branch 上内容 ≠ patched_content → 真 stale，fail-closed
 *   422 recovery：createBranchWithMarker 422 → 唯一合法路径是 tip commit
 *      message 含本 run marker（identity marker commit 或后续 content commit）。
 *      tip 是 base SHA 或第三方 commit 都 fail-closed —— **禁止**「tip === baseSha」
 *      单独当作 ownership proof（blocker 3）。
 */

import { vi, describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { createPageApplyOptimizationCapability } from '..'

const PATCHED = '<html>PATCHED</html>'
const OLD_BASE = '<html>OLD</html>'

function ctx(): AuthorizedExecutionContext {
  return {
    decisionId: 'd', runId: 'r', clientId: 'c',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'k', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}
function noopSb(): SupabaseClient {
  return { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient
}

const PREP = {
  repo_owner: 'o', repo_name: 'r', default_branch: 'main',
  page_url: 'https://x.com/page', content_path: 'website/x.html', page_version_token: 'sha_prepare',
  branch_name: 'me/page-apply/idem',
  patched_content: PATCHED,
  diff_changes: [],
}

async function runCommit(gh: any, createPageGuard?: () => never) {
  const cap = createPageApplyOptimizationCapability(noopSb(), {
    resolveGithubConnection: async () => ({
      repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
    createGithubClient: () => gh,
    createPageGuard: createPageGuard ?? (() => ({ clientId: 'c', assert: async () => undefined }) as never),
  })
  return cap.steps.commit({
    ctx: ctx(), stepKey: 'commit', attempt: 1, idempotencyKey: 'x',
    runInput: {},
    priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
  })
}

// Base fake with createBranchWithMarker success + no 422
function baseGh(overrides: Partial<any> = {}) {
  return {
    async getBranchSha() { return 'base' },
    async createBranchWithMarker() { return 'marker-sha' },
    async commitFile() { /* ok */ },
    async getFileContent() { return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    ...overrides,
  }
}

describe('commit step · stale-race defense', () => {
  it('(a) commitFile 抛 + branch 上是 patched_content → 幂等，commit_created:true', async () => {
    const gh = baseGh({
      async commitFile() { throw new Error('422 sha does not match') },
      async getFileContent(_o: string, _r: string, _p: string, branch: string) {
        return { sha: 'newsha', content: '', size: 0, decodedContent: branch === 'main' ? OLD_BASE : PATCHED }
      },
    })
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
  })

  it('(b) commitFile 抛 + branch 上不是 patched_content → INVALID_STATE stale_snapshot_at_commit', async () => {
    const gh = baseGh({
      async commitFile() { throw new Error('422 sha does not match') },
      async getFileContent() {
        return { sha: 'differentsha', content: '', size: 0, decodedContent: '<html>SOMETHING_ELSE</html>' }
      },
    })
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/stale_snapshot_at_commit/),
    })
  })

  it('狄仁杰 Attack 2：错误消息含 "sha" 但真实是 5xx —— 内容不匹配则 fail-closed', async () => {
    const gh = baseGh({
      async commitFile() { throw new Error('500 internal sha computation timeout') },
      async getFileContent() {
        return { sha: 'basesha', content: '', size: 0, decodedContent: OLD_BASE }
      },
    })
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/stale_snapshot_at_commit/),
    })
  })

  it('commitFile 成功 → 直接 commit_created:true，不查 branch', async () => {
    let getFileCalls = 0
    const gh = baseGh({
      async getFileContent() { getFileCalls++; return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    })
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
    expect(getFileCalls).toBe(0)
  })
})

// ── STOP WHEN scenario 3: foreign branch at base SHA → 不 adopt ──────────────
// blocker 3: 禁止 `tip === baseSha` 单独当作 ownership proof。
describe('commit step · scenario 3 · foreign branch at base SHA → 不 adopt', () => {
  it('createBranchWithMarker 422 + tip === baseSha（无 run marker）→ INVALID_STATE 零写入', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        // main tip = 'base'；owned branch tip 也是 'base'（有人从 main 拉了同名空 branch）
        return 'base'
      },
      async createBranchWithMarker() { throw new Error('422 Reference already exists') },
      async getCommit() { return { sha: 'base', message: 'unrelated commit not from our run' } },
      async commitFile() { commitFileCalled = true },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_not_owned_by_run/),
    })
    expect(commitFileCalled).toBe(false)
  })

  it('createBranchWithMarker 422 + tip 是第三方 commit → INVALID_STATE 零写入', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'foreign-sha'
      },
      async createBranchWithMarker() { throw new Error('422 Reference already exists') },
      async getCommit() { return { sha: 'foreign-sha', message: 'fix: someone else committed' } },
      async commitFile() { commitFileCalled = true },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_not_owned_by_run/),
    })
    expect(commitFileCalled).toBe(false)
  })
})

// ── STOP WHEN scenario 2 (same-run crash recovery) ──────────────────────────
// blocker 3: 必须依赖 provider 侧可读取的 exact run marker (identity marker commit)。
describe('commit step · scenario 2 · same-run marker crash recovery', () => {
  it('createBranchWithMarker 422 + tip 是本 run identity marker → adopt + commit', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'marker-tip-sha'
      },
      async createBranchWithMarker() { throw new Error('422 Reference already exists') },
      async getCommit() {
        return { sha: 'marker-tip-sha', message: 'chore(page): identity marker [kernel run r]' }
      },
      async commitFile() { commitFileCalled = true },
      async getFileContent() { return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    }
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
    expect(commitFileCalled).toBe(true)
  })

  it('createBranchWithMarker 422 + tip 是本 run 后续 content commit → adopt', async () => {
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'content-tip-sha'
      },
      async createBranchWithMarker() { throw new Error('422 Reference already exists') },
      async getCommit() {
        return { sha: 'content-tip-sha', message: 'chore(page): apply optimization x [kernel run r]' }
      },
      async commitFile() { /* ok on second attempt */ },
      async getFileContent() { return { sha: 's', content: '', size: 0, decodedContent: PATCHED } },
    }
    const result = await runCommit(gh)
    expect(result.output.commit_created).toBe(true)
  })

  it('createBranchWithMarker 422 + branch tip 回读失败 → INVALID_STATE 零写入', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        throw new Error('branch read failed')
      },
      async createBranchWithMarker() { throw new Error('422 Reference already exists') },
      async commitFile() { commitFileCalled = true },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_ownership_indeterminate/),
    })
    expect(commitFileCalled).toBe(false)
  })

  it('createBranchWithMarker 422 + getCommit 失败 → INVALID_STATE 零写入（blocker 3）', async () => {
    let commitFileCalled = false
    const gh = {
      async getBranchSha(_o: string, _r: string, branch: string) {
        if (branch === 'main') return 'base'
        return 'unknown-sha'
      },
      async createBranchWithMarker() { throw new Error('422 Reference already exists') },
      async getCommit() { throw new Error('cannot read commit') },
      async commitFile() { commitFileCalled = true },
    }
    await expect(runCommit(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/existing_branch_ownership_indeterminate/),
    })
    expect(commitFileCalled).toBe(false)
  })
})

describe('commit step · protected-page re-check right before the first write', () => {
  it('🔴 list changed after prepare: the branch is never created, nothing is committed', async () => {
    const { gateFake, realGuard } = await import('@/lib/seo/__tests__/gate-test-kit')
    const gh = {
      getBranchSha: vi.fn(async () => 'base'),
      createBranch: vi.fn(),
      createBranchWithMarker: vi.fn(),
      commitFile: vi.fn(),
    }
    const fake = gateFake({ meta_cycle_protected_slugs: ['page'] })
    await expect(runCommit(gh, () => realGuard(fake, 'system') as never)).rejects.toMatchObject({
      code: 'INVALID_INPUT', humanReason: expect.stringMatching(/protected_page/),
    })
    expect(gh.getBranchSha).not.toHaveBeenCalled()
    expect(gh.createBranch).not.toHaveBeenCalled()
    expect(gh.createBranchWithMarker).not.toHaveBeenCalled()
    expect(gh.commitFile).not.toHaveBeenCalled()
  })
})

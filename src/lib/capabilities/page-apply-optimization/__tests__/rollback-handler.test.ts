/**
 * Rollback handler — 直接证明 STOP WHEN 5/6/7 + 相关 fail-closed 语义。
 *
 * 只测行为矩阵；不重复 #1108 已经证明的 Kernel 层。
 *   - Scenario 5: merged PR → truthful failure, 零 provider write
 *   - Scenario 6: owned open Draft PR → close + delete owned branch
 *   - Scenario 7: 404 idempotent success
 *   - Truthful noop: live 检查确认没有 provider artefact
 *   - Ownership guards: foreign PR / branch tampered / branch === live default
 *   - close 失败 → 不进入 delete
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext, CapabilityStepContext } from '@/lib/kernel/types'
import { GitHubApiError } from '@/lib/cms/github-client'
import { createPageApplyOptimizationCapability } from '..'
import { branchNameForRun, canonicalDiffHash, idempotencyKeyFromInput } from '../hash'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const OWNER = 'client-org'
const REPO = 'client-site'
const PAGE_URL = 'https://example.com/x'
const BLOB_SHA = 'a'.repeat(40)
const APPROVED_DIFF = [
  { field: 'meta_description' as const, before: 'Old desc', after: 'New desc', changed: true },
]
const DIFF_HASH = canonicalDiffHash(APPROVED_DIFF)
const OWNED_BRANCH = branchNameForRun(idempotencyKeyFromInput(PAGE_URL, BLOB_SHA, DIFF_HASH))
const RUN_ID = 'run-1'
const DECISION_ID = 'dec-1'
const OUR_PR_BODY = `- kernel_run_id: ${RUN_ID}\n- authorization_decision_id: ${DECISION_ID}\n`
const OUR_COMMIT_MESSAGE = `chore(page): [kernel run ${RUN_ID}]`

const VALID_RUN_INPUT = {
  page_url: PAGE_URL,
  page_version_token: BLOB_SHA,
  validated_diff_hash: DIFF_HASH,
  intents: [{ field: 'meta_description', proposedValue: 'New desc' }],
  do_not_touch: [],
}

const PREP_OUTPUT = {
  repo_owner: OWNER, repo_name: REPO, default_branch: 'main',
  page_url: 'https://x.com/page',
  content_path: 'website/x.html',
  page_version_token: BLOB_SHA,
  branch_name: OWNED_BRANCH,
  patched_content: '<html>P</html>',
  diff_changes: APPROVED_DIFF,
}

const OPENED_OUTPUT = { pr_number: 42, pr_url: `https://github.com/${OWNER}/${REPO}/pull/42` }

function fakeCtx(): AuthorizedExecutionContext {
  return {
    decisionId: DECISION_ID, runId: RUN_ID, clientId: 'client-1',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'idem', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

function noopSb(): SupabaseClient {
  return { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient
}

interface FakeGhOverrides {
  liveDefaultBranch?: string
  branchTipSha?: string | null // null = 404
  commitMessage?: string
  prByNumber?: Record<number, { state: 'open' | 'closed'; merged: boolean; mergedAt: string | null; draft: boolean; headRef: string; baseRef: string; body: string } | 404>
  listHeadPrs?: Array<{ number: number; html_url: string }>
  closePr?: (n: number) => Promise<void>
  deleteBranch?: () => Promise<void>
}

function ghFake(over: FakeGhOverrides = {}) {
  const calls = { getRepo: 0, getBranchSha: [] as string[], getCommit: [] as string[], getPrDetail: [] as number[], listHead: 0, close: [] as number[], del: [] as string[] }
  const gh: any = {
    async getRepo() {
      calls.getRepo++
      return { full_name: `${OWNER}/${REPO}`, default_branch: over.liveDefaultBranch ?? 'main' }
    },
    async getBranchSha(_o: string, _r: string, branch: string) {
      calls.getBranchSha.push(branch)
      const tip = over.branchTipSha === undefined ? null : over.branchTipSha
      if (tip === null) throw new GitHubApiError(404, 'Not Found')
      return tip
    },
    async getCommit(_o: string, _r: string, sha: string) {
      calls.getCommit.push(sha)
      return { sha, message: over.commitMessage ?? OUR_COMMIT_MESSAGE }
    },
    async getPullRequestDetail(_o: string, _r: string, n: number) {
      calls.getPrDetail.push(n)
      const rec = over.prByNumber?.[n]
      if (rec === 404 || rec === undefined) throw new GitHubApiError(404, 'Not Found')
      return { number: n, ...rec, title: 't', htmlUrl: `https://github.com/${OWNER}/${REPO}/pull/${n}` }
    },
    async listPullRequestsByHead() {
      calls.listHead++
      return over.listHeadPrs ?? []
    },
    async closePullRequest(_o: string, _r: string, n: number) {
      calls.close.push(n)
      if (over.closePr) return over.closePr(n)
    },
    async deleteBranch(_o: string, _r: string, b: string) {
      calls.del.push(b)
      if (over.deleteBranch) return over.deleteBranch()
    },
  }
  return { gh, calls }
}

function makeCap(gh: unknown) {
  return createPageApplyOptimizationCapability(noopSb(), {
    resolveGithubConnection: async () => ({
      repoOwner: OWNER, repoName: REPO, defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
    createGithubClient: () => gh as never,
    createPageGuard: () => ({ clientId: 'c', assert: async () => undefined }) as never,
  })
}

function stepFor(priorOutputs: Record<string, Record<string, unknown>>, runInput = VALID_RUN_INPUT): CapabilityStepContext {
  return {
    ctx: fakeCtx(), stepKey: 'rollback', attempt: 1, idempotencyKey: 'idem:rollback',
    runInput, priorOutputs,
  }
}

// ── Architecture guard: no action_runs.input read in capability dir ─────────

describe('architecture-guard · capability 目录不读 action_runs.input', () => {
  it('no .from("action_runs") + .select("input") combo outside __tests__', () => {
    const dir = join(__dirname, '..')
    const files: string[] = []
    const walk = (p: string) => {
      for (const n of readdirSync(p)) {
        const full = join(p, n)
        const st = statSync(full)
        if (st.isDirectory()) { if (n === '__tests__') continue; walk(full) }
        else if (n.endsWith('.ts')) files.push(full)
      }
    }
    walk(dir)
    const bad: string[] = []
    for (const f of files) {
      const t = readFileSync(f, 'utf8')
      if (/\.from\(\s*['"]action_runs['"]\s*\)/.test(t) && /\.select\(\s*['"]input['"]/.test(t)) bad.push(f)
    }
    expect(bad).toEqual([])
  })
})

// ── Truthful noop ────────────────────────────────────────────────────────────

describe('rollback · truthful noop (live 检查确认零副作用)', () => {
  it('无 prep → noop', async () => {
    const { gh, calls } = ghFake()
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({}), {})
    expect(r.ok).toBe(true); expect(r.rollbackKind).toBe('noop')
    expect(calls.getRepo).toBe(0)
  })

  it('prep 存在 + live branch 不在 + head 无 PR → truthful noop', async () => {
    const { gh, calls } = ghFake({ branchTipSha: null, listHeadPrs: [] })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(true); expect(r.rollbackKind).toBe('noop')
    expect(calls.close).toEqual([]); expect(calls.del).toEqual([])
  })

  it('prepare-only 但 live branch 实际存在（网络模糊成功）→ 不虚报 noop，走 cleanup', async () => {
    const { gh, calls } = ghFake({ branchTipSha: BLOB_SHA })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(true); expect(r.rollbackKind).toBe('provider_native')
    expect(calls.del).toEqual([OWNED_BRANCH])
  })
})

// ── Scenario 5: merged PR → truthful failure, zero write ─────────────────────

describe('rollback · scenario 5 · merged PR fail, 零写入', () => {
  it('opened.pr_number 已 merged → ok:false, close/del 均零调用', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'closed', merged: true, mergedAt: '2026-01-01T00:00:00Z', draft: false, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/已 merge|merged/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('head 上有 merged PR（不在 opened priorOutput 里但 listHead 找到）→ 拒绝', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 200, html_url: `https://github.com/${OWNER}/${REPO}/pull/200` }],
      prByNumber: {
        200: { state: 'closed', merged: true, mergedAt: 'x', draft: false, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })
})

// ── Scenario 6: owned open Draft PR → close + delete owned branch ───────────

describe('rollback · scenario 6 · owned open Draft PR close + branch delete', () => {
  it('opened + branch owned + PR open draft with receipt → close + delete', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(true)
    expect(r.rollbackKind).toBe('provider_native')
    expect(calls.close).toEqual([42])
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('opened 缺失但 listHead 发现 owned PR（网络模糊成功）→ close + delete', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 77, html_url: `https://github.com/${OWNER}/${REPO}/pull/77` }],
      prByNumber: {
        77: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([77])
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('foreign open PR (无 receipt) → ok:false，不 close 别人 PR，不动 branch', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: 'no receipt' },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/receipt 不符本 run|不 close/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('branch tip 是第三方 commit（无本 run marker）→ 拒绝 delete', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: 'foreign-sha',
      commitMessage: 'someone else',
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/tampered|第三方|marker/)
    expect(calls.del).toEqual([])
  })

  it('branch === live default_branch → 硬拒（即便前面身份闸都过）', async () => {
    const { gh, calls } = ghFake({ liveDefaultBranch: OWNED_BRANCH })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/live default/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('close 失败 → ok:false，不进入 delete branch', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
      closePr: async () => { throw new Error('provider 500') },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/closePullRequest/)
    expect(calls.del).toEqual([])
  })
})

// ── Scenario 7: 404 retry idempotent success ────────────────────────────────

describe('rollback · scenario 7 · 404 idempotent success', () => {
  it('opened.pr_number 404 → 视为已撤，删 branch → ok', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: { 42: 404 },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(true)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([OWNED_BRANCH])
  })

  it('branch 已 404 → 不调 delete，直接 ok', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: null,
      prByNumber: { 42: 404 },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(true)
    expect(calls.del).toEqual([])
  })

  it('closePullRequest 404 → 视为已撤，继续删 branch', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
      closePr: async () => { throw new GitHubApiError(404, 'Not Found') },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(true)
    expect(calls.del).toEqual([OWNED_BRANCH])
  })
})

// ── STOP WHEN blockers: PR discovery / PR lifecycle / receipt suffix ────────

describe('rollback · blocker 1 · PR discovery fail-closed', () => {
  it('listPullRequestsByHead(state=all) 失败 → 立即 fail，close/del 零调用', async () => {
    const { gh, calls } = ghFake({ branchTipSha: BLOB_SHA })
    gh.listPullRequestsByHead = async () => { throw new Error('provider 500') }
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/list_head_prs_failed|listPullRequestsByHead/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('candidate PR detail 读取失败 → 立即 fail，close/del 零调用', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 500, html_url: 'x' }],
    })
    gh.getPullRequestDetail = async () => { throw new Error('provider 502') }
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/live_pr_read_failed|读 PR/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('候选 PR 无法证明属于本 run（head 上有 foreign PR）→ fail，不共享 branch 上删', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 500, html_url: 'x' }],
      prByNumber: {
        500: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: 'no receipt' },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/foreign_pr|不属于本 run/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('branch tip commit 读取失败 → 立即 fail（blocker 4：唯一 ownership 通路失败）', async () => {
    const { gh, calls } = ghFake({ branchTipSha: 'some-sha' })
    gh.getCommit = async () => { throw new Error('provider 500') }
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/tip_commit_read_failed|读 branch tip/)
    expect(calls.del).toEqual([])
  })
})

describe('rollback · blocker 2 · ready-for-review PR fail-closed', () => {
  it('owned open PR draft=false（被人 mark ready-for-review）→ fail，close/del 零调用', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: false, headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/ready-for-review|draft=false/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })
})

describe('rollback · blocker 4 · prep-only 只走真实 commit marker（不比对 blob SHA）', () => {
  it('branchTipSha === prep.page_version_token 但 commit 无 marker → fail-closed，不删 branch', async () => {
    // 关键：即便 tip SHA 数值上等于 page_version_token（不可能但强制模拟），
    // 也必须走 getCommit → marker 才能证明所有权。
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA, // == prep.page_version_token
      commitMessage: 'unrelated commit',
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/tampered|marker/)
    expect(calls.del).toEqual([])
  })
})

describe('rollback · blocker 5 · receipt suffix spoof 拒绝', () => {
  it('body 里 `- kernel_run_id: run-1extra` 不算 receipt → not_owned → fail', async () => {
    const spoofedBody =
      `- kernel_run_id: ${RUN_ID}extra\n- authorization_decision_id: ${DECISION_ID}extra\n`
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: spoofedBody },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/receipt|not_owned|不属于本 run/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })

  it('body 里 receipt 前缀带空格（"-  kernel_run_id: run-1"）不算 → fail', async () => {
    const spoofedBody =
      `-  kernel_run_id: ${RUN_ID}\n-  authorization_decision_id: ${DECISION_ID}\n`
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: { state: 'open', merged: false, mergedAt: null, draft: true, headRef: OWNED_BRANCH, baseRef: 'main', body: spoofedBody },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })
})

// ── STOP WHEN (final micro-patch): listed candidate detail 404 / unknown state ─

describe('rollback · listed candidate detail 404 → fail-closed 零写入', () => {
  it('listPullRequestsByHead 返回 candidate，但 getPullRequestDetail 抛 404 → return fail', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      listHeadPrs: [{ number: 999, html_url: 'x' }],
      prByNumber: { 999: 404 }, // list 里出现，但 detail 404
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown> }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/listed_candidate_detail_404|状态不可读/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })
})

describe('rollback · unknown PR state → fail-closed 零写入', () => {
  it('PR state 既非 open 也非 closed（provider 契约违约）+ matching receipt + draft=true → fail', async () => {
    const { gh, calls } = ghFake({
      branchTipSha: BLOB_SHA,
      prByNumber: {
        42: {
          state: 'weird_new_value' as unknown as 'open',
          merged: false, mergedAt: null, draft: true,
          headRef: OWNED_BRANCH, baseRef: 'main', body: OUR_PR_BODY,
        },
      },
    })
    const cap = makeCap(gh)
    const r = await cap.rollback!(stepFor({ prepare: PREP_OUTPUT as unknown as Record<string, unknown>, open_pr: OPENED_OUTPUT }), {})
    expect(r.ok).toBe(false)
    expect(r.failure_reason).toMatch(/state 既非|pr_state_unknown/)
    expect(calls.close).toEqual([])
    expect(calls.del).toEqual([])
  })
})

// ── Wiring ───────────────────────────────────────────────────────────────────

describe('rollback wiring', () => {
  it('createPageApplyOptimizationCapability().rollback 是 function', () => {
    const cap = createPageApplyOptimizationCapability(noopSb())
    expect(typeof cap.rollback).toBe('function')
  })
})

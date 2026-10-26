/**
 * record step 的 5 条 execution-integrity 断言 —— 每条要能独立 fail-closed。
 *
 * §8.1：
 *   ① PR 状态 = open
 *   ② base main blob = page_version_token（PR 基于批准时的版本）
 *   ③ PR head diff = approved validated diff
 *   ④ doNotTouch 字段 head=base 未变化
 *   ⑤ authorization_decisions 行可回读
 *
 * §16.4：page_apply_integrity 只判执行完整性，不判 Growth 结果。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { canonicalDiffHash } from '../hash'
import { createPageApplyOptimizationCapability } from '..'

const BLOB_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const HTML_BASE = `<!doctype html>
<html><head>
<title>Old T</title>
<meta name="description" content="Old desc">
</head><body></body></html>`
const HTML_HEAD_HAPPY = `<!doctype html>
<html><head>
<title>Old T</title>
<meta name="description" content="New desc">
</head><body></body></html>`

function ctx(): AuthorizedExecutionContext {
  return {
    decisionId: 'dec1', runId: 'run1', clientId: 'c',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'idem', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

function sbWith(actionRunInput: Record<string, unknown>, decisionExists: boolean): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() { return this },
        eq(_c: string, _v: string) { return this },
        limit(_n: number) {
          if (table === 'action_runs') return Promise.resolve({ data: [{ input: actionRunInput }], error: null })
          if (table === 'authorization_decisions') return Promise.resolve({ data: decisionExists ? [{ id: 'dec1' }] : [], error: null })
          return Promise.resolve({ data: [], error: null })
        },
      }
    },
  } as unknown as SupabaseClient
}

interface FakeGhOverrides {
  prState?: { state: 'open' | 'closed'; merged: boolean }
  baseFile?: string
  baseBlob?: string
  headFile?: string
}

function fakeGh(over: FakeGhOverrides = {}) {
  return {
    async getPullRequestState() {
      return { state: over.prState?.state ?? 'open', merged: over.prState?.merged ?? false, mergedAt: null }
    },
    async getFileContent(_o: string, _r: string, _p: string, branch: string) {
      if (branch === 'main') {
        return {
          sha: over.baseBlob ?? BLOB_SHA, content: '', size: 0,
          decodedContent: over.baseFile ?? HTML_BASE,
        }
      }
      return {
        sha: 'headsha', content: '', size: 0,
        decodedContent: over.headFile ?? HTML_HEAD_HAPPY,
      }
    },
  } as any
}

function deps(gh: any) {
  return {
    resolveGithubConnection: async () => ({
      repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
      contentPaths: ['website/geo.html'], plainToken: 't',
    }),
    createGithubClient: () => gh,
    createPageGuard: () => ({ clientId: 'c', assert: async () => undefined }) as never,
  }
}

const APPROVED_DIFF_CHANGES = [
  { field: 'meta_description' as const, before: 'Old desc', after: 'New desc', changed: true },
]

const PREPARE_OUTPUT = {
  repo_owner: 'o', repo_name: 'r', default_branch: 'main',
  page_url: 'https://x.com/geo',
  content_path: 'website/geo.html',
  page_version_token: BLOB_SHA,
  branch_name: 'me/page-apply/idem',
  patched_content: HTML_HEAD_HAPPY,
  diff_changes: APPROVED_DIFF_CHANGES,
}

const RUN_INPUT = {
  page_url: 'https://example.com/geo',
  page_version_token: BLOB_SHA,
  validated_diff_hash: canonicalDiffHash(APPROVED_DIFF_CHANGES),
  intents: [{ field: 'meta_description', proposedValue: 'New desc', semanticIntent: { known: false, reason: 'x' } }],
  do_not_touch: ['meta_title', 'content_html'],
}

async function runRecord(gh: any, decisionExists = true, runInput = RUN_INPUT) {
  const sb = sbWith(runInput, decisionExists)
  const cap = createPageApplyOptimizationCapability(sb, deps(gh))
  return cap.steps.record({
    ctx: ctx(), stepKey: 'record', attempt: 1, idempotencyKey: 'x',
    // 🔴 #1108 后：do_not_touch 从 ctx.runInput 读，sb 保留只测 loadDecisionExists
    runInput,
    priorOutputs: {
      prepare: PREPARE_OUTPUT as unknown as Record<string, unknown>,
      open_pr: { pr_number: 7, pr_url: 'https://github.com/o/r/pull/7' },
    },
  })
}

describe('record · integrity happy path', () => {
  it('五条全过 → verification.passed=true, method=page_apply_integrity', async () => {
    const r = await runRecord(fakeGh())
    expect(r.verification?.method).toBe('page_apply_integrity')
    expect(r.verification?.passed).toBe(true)
    expect(r.output.provider).toBe('github')
    expect(String(r.output.run_reference)).toMatch(/^pr:o\/r#7$/)
  })
})

describe('record · each of 5 assertions can fail-closed', () => {
  it('① PR 关闭状态 → fail', async () => {
    const r = await runRecord(fakeGh({ prState: { state: 'closed', merged: false } }))
    expect(r.verification?.passed).toBe(false)
    expect(r.verification?.failure_reason).toMatch(/PR 状态为 open/)
  })

  it('② main blob 已移动 → fail', async () => {
    const r = await runRecord(fakeGh({ baseBlob: 'differentSHA' }))
    expect(r.verification?.passed).toBe(false)
    expect(r.verification?.failure_reason).toMatch(/PR 基于 approved 版本/)
  })

  it('③ PR head diff 跟 approved 不等 → fail', async () => {
    // head 上是原文，没改 → changed diff 为空，hash 跟 approved 对不上
    const r = await runRecord(fakeGh({ headFile: HTML_BASE }))
    expect(r.verification?.passed).toBe(false)
    expect(r.verification?.failure_reason).toMatch(/PR diff/)
  })

  it('④ doNotTouch 被改 → fail', async () => {
    // head 里 meta_title 被改了（doNotTouch 里有 meta_title）
    const badHead = HTML_HEAD_HAPPY.replace('<title>Old T</title>', '<title>NEW T</title>')
    const r = await runRecord(fakeGh({ headFile: badHead }))
    expect(r.verification?.passed).toBe(false)
    expect(r.verification?.failure_reason).toMatch(/doNotTouch/)
  })

  it('⑤a output.run_reference 反查 PR 失败 → fail', async () => {
    const gh = fakeGh()
    // 让 getPullRequestState 在第二次调用（run_reference 反查）失败
    let calls = 0
    gh.getPullRequestState = async () => {
      calls++
      if (calls === 1) return { state: 'open' as const, merged: false, mergedAt: null }
      throw new Error('404 Not Found')
    }
    const r = await runRecord(gh)
    expect(r.verification?.passed).toBe(false)
    expect(r.verification?.failure_reason).toMatch(/run_reference/)
  })

  it('⑤b authorization_decisions 找不到行 → fail', async () => {
    const r = await runRecord(fakeGh(), /*decisionExists*/ false)
    expect(r.verification?.passed).toBe(false)
    expect(r.verification?.failure_reason).toMatch(/authorization_decisions/)
  })
})

describe('§16.4 — page_apply_integrity only judges execution, not growth', () => {
  it('全过后 verification.passed=true —— 未做也不该做 Growth 复测', async () => {
    const r = await runRecord(fakeGh())
    // method 是 execution-integrity，不含任何 growth metric
    expect(r.verification?.method).toBe('page_apply_integrity')
    // checks 里全部关乎 PR/blob/lineage，没有 GEO metric 名字
    const checkNames = (r.verification?.checks ?? []).map((c) => c.name).join('|')
    expect(checkNames).not.toMatch(/geo|qualified|remeasurement|growth/i)
  })
})

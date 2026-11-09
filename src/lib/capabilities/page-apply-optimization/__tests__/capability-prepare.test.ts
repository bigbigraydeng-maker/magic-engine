/**
 * `prepare` step 的四条 fail-closed 分支 + 一条 happy path。
 *
 * §4.1 强制流程：
 *   ① page_version_token 不等 → stale_snapshot
 *   ② draft/diff 失败 → INVALID_INPUT
 *   ③ capability 重算 hash 不等（含 caller 塞假 hash） → pipeline_regression
 *   ④ doNotTouch 与 diff 有交集 → do_not_touch_violation
 *   ⑤ 全部通过 → prepare.output 带 branch_name / patched_content / diff_changes
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext, CapabilityStepContext } from '@/lib/kernel/types'
import type { PageOptimizationIntent } from '@/lib/page-optimization'
import { KernelError } from '@/lib/kernel/errors'
import { canonicalDiffHash } from '../hash'
import { createPageApplyOptimizationCapability } from '..'
import type { PageApplyOptimizationDeps } from '../deps'
import { gateFake, realGuard } from '@/lib/seo/__tests__/gate-test-kit'

// ── Fake supabase：只支持 select('input').eq('id',...).limit(1) ────────────────
function makeFakeSb(actionRuns: Record<string, { input: Record<string, unknown> }>): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'action_runs' && table !== 'authorization_decisions') {
        throw new Error(`fake supabase 不建模: ${table}`)
      }
      return {
        select() { return this },
        eq(col: string, val: string) { (this as any)._col = col; (this as any)._val = val; return this },
        limit(_n: number) {
          if (table === 'action_runs') {
            const hit = actionRuns[(this as any)._val]
            return Promise.resolve({ data: hit ? [{ input: hit.input }] : [], error: null })
          }
          return Promise.resolve({ data: [{ id: (this as any)._val }], error: null })
        },
      }
    },
  } as unknown as SupabaseClient
}

const HTML_BEFORE = `<!doctype html>
<html><head>
<title>Old Title</title>
<meta name="description" content="Old desc">
</head><body>hello</body></html>`

const BLOB_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function fakeGh(overrides?: {
  getFileContent?: (owner: string, repo: string, path: string, branch: string) => Promise<any>
}) {
  return {
    async getFileContent(owner: string, repo: string, path: string, branch: string) {
      return overrides?.getFileContent
        ? overrides.getFileContent(owner, repo, path, branch)
        : { sha: BLOB_SHA, content: '', size: 0, decodedContent: HTML_BEFORE }
    },
    async getBranchSha() { return 'basesha' },
    async createBranch() { /* noop */ },
    async commitFile() { /* noop */ },
    async createPullRequest() { return { number: 1, html_url: 'u', title: 't' } },
    async getPullRequestState() { return { state: 'open' as const, merged: false, mergedAt: null } },
  } as any
}

function fakeDeps(gh: any, contentPaths: readonly string[] = ['website/geo.html']): PageApplyOptimizationDeps {
  return {
    resolveGithubConnection: async () => ({
      repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
      contentPaths, plainToken: 'tok',
    }),
    createGithubClient: () => gh,
    createPageGuard: () => ({ clientId: 'c', assert: async () => undefined }) as never,
  }
}

function fakeCtx(runId = 'run1'): AuthorizedExecutionContext {
  return {
    decisionId: 'dec1', runId, clientId: 'client1',
    actionKey: 'page.apply_optimization_request',
    actionVersion: 1, policyVersion: 1, costCapUsd: null,
    idempotencyKey: 'idem1', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

const INTENT_META_DESC: PageOptimizationIntent = {
  field: 'meta_description',
  proposedValue: 'New desc for AU/NZ',
  semanticIntent: { known: false, reason: 'not_recorded_by_source' },
}

function makeInput(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  // 计算 approved diff hash：先跑一次 shared runtime 得到 diff.changes
  const changes = [{ field: 'meta_description' as const, before: 'Old desc', after: 'New desc for AU/NZ', changed: true }]
  return {
    page_url: 'https://example.com/geo',
    page_version_token: BLOB_SHA,
    validated_diff_hash: canonicalDiffHash(changes),
    intents: [INTENT_META_DESC],
    do_not_touch: ['meta_title', 'content_html'],
    ...overrides,
  }
}

async function runPrepare(deps: PageApplyOptimizationDeps, input: Record<string, unknown>) {
  // 🔴 #1108 Kernel Outward Hardening 之后 capability 从 ctx.runInput 读输入，
  //    sb 不再承担 input 回读职责（保留只是为了继续测 loadDecisionExists）。
  const sb = makeFakeSb({ run1: { input } })
  const cap = createPageApplyOptimizationCapability(sb, deps)
  const step: CapabilityStepContext = {
    ctx: fakeCtx(), stepKey: 'prepare', attempt: 1, idempotencyKey: 'x', priorOutputs: {},
    runInput: input,
  }
  return cap.steps.prepare(step)
}

describe('prepare step · fail-closed branches', () => {
  it('① stale_snapshot：page_version_token 与 blob SHA 不等', async () => {
    const gh = fakeGh({
      getFileContent: async () => ({ sha: 'differentSHA', content: '', size: 0, decodedContent: HTML_BEFORE }),
    })
    await expect(runPrepare(fakeDeps(gh), makeInput())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      humanReason: expect.stringMatching(/stale_snapshot/),
    })
  })

  it('② draft/diff 失败：intents 里字段不在 v1 冻结集合', async () => {
    const gh = fakeGh()
    const bad = makeInput({
      intents: [{ ...INTENT_META_DESC, field: 'garbage' as any }],
    })
    await expect(runPrepare(fakeDeps(gh), bad)).rejects.toBeInstanceOf(KernelError)
  })

  it('③ pipeline_regression：caller 塞了假 hash', async () => {
    const gh = fakeGh()
    const bad = makeInput({ validated_diff_hash: '0000000000000000000000000000000000000000' })
    await expect(runPrepare(fakeDeps(gh), bad)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      humanReason: expect.stringMatching(/pipeline_regression/),
    })
  })

  it('④ do_not_touch_violation：doNotTouch 与 diff 有交集', async () => {
    const gh = fakeGh()
    // 意图改 meta_description，但 doNotTouch 也放了 meta_description
    const bad = makeInput({ do_not_touch: ['meta_description'] })
    await expect(runPrepare(fakeDeps(gh), bad)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      humanReason: expect.stringMatching(/do_not_touch_violation/),
    })
  })
})

describe('prepare step · happy path', () => {
  it('全部通过 → 输出 branch_name / patched_content / diff_changes', async () => {
    const gh = fakeGh()
    const result = await runPrepare(fakeDeps(gh), makeInput())
    const output = result.output as Record<string, unknown>
    expect(output.branch_name).toMatch(/^me\/page-apply\/[a-f0-9]{24}$/)
    expect(String(output.patched_content)).toContain('New desc for AU/NZ')
    expect(Array.isArray(output.diff_changes)).toBe(true)
    expect((output.diff_changes as any[]).length).toBeGreaterThan(0)
    expect(output.repo_owner).toBe('o')
    expect(output.page_version_token).toBe(BLOB_SHA)
  })
})

// forge AuthorizedExecutionContext 的实际防线在 architecture level：
//   * `src/lib/kernel/types.ts:377` unique symbol brand（编译期挡未 mint）
//   * `src/lib/kernel/boundaries.ts:110` AUTHORIZED_CONTEXT_MINTERS 只允许 authorize.ts
//   * `src/lib/kernel/__tests__/architecture.test.ts` "no forged contexts" 扫全仓
//   * `src/lib/kernel/gateway.ts` assertDecisionMatches 独立重读 decision，forge ctx 过不了
// 本 capability 的测试文件用 `as unknown as AuthorizedExecutionContext` 是显式规避
// （测试文件被架构扫描排除，见 architecture.test.ts filter isTest）。这不是攻击面。

describe('prepare step · protected-page gate (SYSTEM actor: no override, ever)', () => {
  it('🔴 protected page: refused with protected_page, and the repo file is never even read', async () => {
    let read = false
    const gh = fakeGh({ getFileContent: async () => { read = true; return { sha: BLOB_SHA, content: '', size: 0, decodedContent: HTML_BEFORE } } })
    const fake = gateFake({ meta_cycle_protected_slugs: ['geo'] })
    const deps = { ...fakeDeps(gh), createPageGuard: () => realGuard(fake, 'system') }
    await expect(runPrepare(deps, makeInput())).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      humanReason: expect.stringMatching(/protected_page/),
    })
    expect(read).toBe(false)
    expect(fake.receipts[0]?.summary).toMatchObject({ decision: 'denied_protected' })
  })

  it('🔴 protected via the resolved FILE path (path entry), even though the URL alone would not match', async () => {
    const gh = fakeGh()
    const fake = gateFake({ meta_cycle_protected_slugs: ['website/geo'] })
    const deps = { ...fakeDeps(gh), createPageGuard: () => realGuard(fake, 'system') }
    await expect(runPrepare(deps, makeInput())).rejects.toMatchObject({ humanReason: expect.stringMatching(/protected_page/) })
  })

  it('🔴 list unreadable / malformed => refused (never "protect nothing")', async () => {
    for (const fake of [gateFake({}, { lookupError: true }), gateFake({ meta_cycle_protected_slugs: 'geo' })]) {
      const deps = { ...fakeDeps(fakeGh()), createPageGuard: () => realGuard(fake, 'system') }
      await expect(runPrepare(deps, makeInput())).rejects.toMatchObject({ humanReason: expect.stringMatching(/protected_page/) })
    }
  })

  it('unprotected page passes the gate (no receipt) and prepare proceeds', async () => {
    const fake = gateFake({ meta_cycle_protected_slugs: ['something-else'] })
    const deps = { ...fakeDeps(fakeGh()), createPageGuard: () => realGuard(fake, 'system') }
    const out = await runPrepare(deps, makeInput())
    expect(out.output).toMatchObject({ page_url: 'https://example.com/geo', content_path: 'website/geo.html' })
    expect(fake.receipts).toHaveLength(0)
  })
})

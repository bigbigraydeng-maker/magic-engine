/**
 * open_pr step:
 *   - Scenario 1 (happy path): draft:true PR 创建后必须回读 detail 验 receipt
 *   - Scenario 2 (same-run crash/retry recovery): 422 recovery 逐个 candidate 核对
 *     receipt，命中同 run 的 PR 才 adopt
 *   - Scenario 4 (foreign/wrong-receipt PR fail-closed): draft=false / head/base
 *     不符 / body 无 receipt → 一律 INVALID_STATE 零写入
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorizedExecutionContext } from '@/lib/kernel/types'
import { createPageApplyOptimizationCapability } from '..'

function noopSb(): SupabaseClient {
  return { from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) } as unknown as SupabaseClient
}

function fakeCtx(): AuthorizedExecutionContext {
  return {
    decisionId: 'dec', runId: 'run', clientId: 'c',
    actionKey: 'page.apply_optimization_request', actionVersion: 1,
    policyVersion: 1, costCapUsd: null, idempotencyKey: 'k', expiresAt: null,
  } as unknown as AuthorizedExecutionContext
}

const PREP = {
  repo_owner: 'o', repo_name: 'r', default_branch: 'main',
  page_url: 'https://x.com/page', content_path: 'website/x.html', page_version_token: 'sha1',
  branch_name: 'me/page-apply/idem',
  patched_content: '<html></html>',
  diff_changes: [{ field: 'meta_description', before: 'a', after: 'b', changed: true }],
}

// Receipt-carrying body as capability emits it
const RECEIPT_BODY = `- kernel_run_id: run\n- authorization_decision_id: dec\n`

async function runOpenPr(fakeGh: any) {
  const cap = createPageApplyOptimizationCapability(noopSb(), {
    resolveGithubConnection: async () => ({
      repoOwner: 'o', repoName: 'r', defaultBranch: 'main',
      contentPaths: ['website/x.html'], plainToken: 't',
    }),
    createGithubClient: () => fakeGh,
    createPageGuard: () => ({ clientId: 'c', assert: async () => undefined }) as never,
  })
  return cap.steps.open_pr({
    ctx: fakeCtx(), stepKey: 'open_pr', attempt: 1, idempotencyKey: 'x',
    runInput: {},
    priorOutputs: { prepare: PREP as unknown as Record<string, unknown> },
  })
}

// ── Scenario 1: happy path ────────────────────────────────────────────────────

describe('open_pr · scenario 1 · happy path (draft + receipt readback)', () => {
  it('createPullRequest draft:true; getPullRequestDetail readback receipt 通过', async () => {
    let capturedParams: any = null
    const gh: any = {
      async createPullRequest(_o: string, _r: string, params: any) {
        capturedParams = params
        return { number: 7, html_url: 'https://github.com/o/r/pull/7', title: params.title }
      },
      async getPullRequestDetail(_o: string, _r: string, n: number) {
        return {
          number: n, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 't', body: capturedParams.body,
          htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    const result = await runOpenPr(gh)
    expect(capturedParams.draft).toBe(true)
    expect(capturedParams.head).toBe('me/page-apply/idem')
    expect(capturedParams.base).toBe('main')
    expect(capturedParams.body).toMatch(/kernel_run_id: run/)
    expect(capturedParams.body).toMatch(/authorization_decision_id: dec/)
    expect(result.output.pr_number).toBe(7)
  })
})

// ── Scenario 2 (partial): same-run crash/retry — 422 → adopt owned PR ───────

describe('open_pr · scenario 2 · same-run 422 recovery adopts owned PR', () => {
  it('422 + list 找到一条 receipt 全对的 owned open Draft PR → adopt', async () => {
    const gh: any = {
      async createPullRequest() { throw new Error('422 Validation Failed: A pull request already exists') },
      async listPullRequestsByHead() {
        return [{ number: 99, html_url: 'https://github.com/o/r/pull/99' }]
      },
      async getPullRequestDetail(_o: string, _r: string, n: number) {
        return {
          number: n, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'ours', body: RECEIPT_BODY,
          htmlUrl: 'https://github.com/o/r/pull/99',
        }
      },
    }
    const result = await runOpenPr(gh)
    expect(result.output.pr_number).toBe(99)
  })
})

// ── Scenario 4: foreign / wrong-receipt PR → fail-closed, zero write ─────────

describe('open_pr · scenario 4 · foreign/wrong-receipt PR fail-closed', () => {
  it('happy path: PR draft=false → INVALID_STATE (receipt_mismatch)', async () => {
    const gh: any = {
      async createPullRequest() { return { number: 7, html_url: 'https://github.com/o/r/pull/7' } },
      async getPullRequestDetail() {
        return {
          number: 7, state: 'open', merged: false, mergedAt: null, draft: false, // ← not draft
          headRef: 'me/page-apply/idem', baseRef: 'main', title: 't',
          body: RECEIPT_BODY, htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    await expect(runOpenPr(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/pr_open_receipt_mismatch/),
    })
  })

  it('happy path: PR head/base 不符 → INVALID_STATE', async () => {
    const gh: any = {
      async createPullRequest() { return { number: 7, html_url: 'https://github.com/o/r/pull/7' } },
      async getPullRequestDetail() {
        return {
          number: 7, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'someone/other/branch', baseRef: 'main',
          title: 't', body: RECEIPT_BODY, htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    await expect(runOpenPr(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/receipt/),
    })
  })

  it('happy path: PR body 无 receipt marker → INVALID_STATE', async () => {
    const gh: any = {
      async createPullRequest() { return { number: 7, html_url: 'https://github.com/o/r/pull/7' } },
      async getPullRequestDetail() {
        return {
          number: 7, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 't', body: 'some third-party PR body',
          htmlUrl: 'https://github.com/o/r/pull/7',
        }
      },
    }
    await expect(runOpenPr(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/receipt/),
    })
  })

  it('422 recovery: 只有 attacker PR (no receipt) → fail-closed', async () => {
    const gh: any = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() {
        return [{ number: 500, html_url: 'https://github.com/o/r/pull/500' }]
      },
      async getPullRequestDetail() {
        return {
          number: 500, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'attacker', body: 'no receipt',
          htmlUrl: 'https://github.com/o/r/pull/500',
        }
      },
    }
    await expect(runOpenPr(gh)).rejects.toMatchObject({
      code: 'INVALID_STATE',
      humanReason: expect.stringMatching(/找不到.*receipt|不属于本 run/),
    })
  })

  it('422 recovery: 首个 candidate attacker、次个 owned → 选 owned', async () => {
    const gh: any = {
      async createPullRequest() { throw new Error('422 already exists') },
      async listPullRequestsByHead() {
        return [
          { number: 500, html_url: 'https://github.com/o/r/pull/500' },
          { number: 99, html_url: 'https://github.com/o/r/pull/99' },
        ]
      },
      async getPullRequestDetail(_o: string, _r: string, n: number) {
        if (n === 500) {
          return {
            number: 500, state: 'open', merged: false, mergedAt: null, draft: true,
            headRef: 'me/page-apply/idem', baseRef: 'main',
            title: 'attacker', body: 'no receipt',
            htmlUrl: 'https://github.com/o/r/pull/500',
          }
        }
        return {
          number: 99, state: 'open', merged: false, mergedAt: null, draft: true,
          headRef: 'me/page-apply/idem', baseRef: 'main',
          title: 'ours', body: RECEIPT_BODY,
          htmlUrl: 'https://github.com/o/r/pull/99',
        }
      },
    }
    const result = await runOpenPr(gh)
    expect(result.output.pr_number).toBe(99)
  })
})

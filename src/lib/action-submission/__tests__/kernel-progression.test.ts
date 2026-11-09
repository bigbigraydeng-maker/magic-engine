/**
 * Kernel 集成 —— caller → 真 runAction → pending_approval → Approval Queue 可读。
 *
 * 🔴 用现成 fake-supabase + makeFixture + makeRegistry。真实 mapping table 不动，
 *    通过注入的 mapper 指向一个**合成 outward test action**（跟 outward-authorization
 *    测试同一个套路）。
 *
 * 🔴 断言的验收标准（spec §3 / §12）：
 *    · action_runs[0].status === 'pending_approval'
 *    · authorization_decision_id != null
 *    · authorization_decisions[0].verdict === 'require_approval'
 *    · listPendingRunsForClient() 读得到
 *    · capability handler call count === 0
 */

import { describe, it, expect } from 'vitest'
import { runAction } from '@/lib/kernel/runner'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import type { ActionDefinition, CapabilityImplementation } from '@/lib/kernel/types'
import type { CandidateMappingResult } from '@/lib/action-bridge'
import { listPendingRunsForClient } from '@/lib/kernel-approval/queries'
import { makeFixture, makeRegistry, CLIENT_A, GOAL_A } from '@/lib/kernel/__tests__/fixtures'
import { submitPageOptimizationRequest } from '..'
import type { PageOptimizationRequestCallerDeps, SubmitPageOptimizationRequestInput } from '../types'
import type { PageOptimizationRequest } from '@/lib/page-optimization'

// ── 合成 outward test action ──────────────────────────────────────────────
//
// 用真实注册表里那个 key 做载体（`ActionKey` 是封闭 union），但把 sideEffect
// 覆写成 outward + inputSchema 覆写成 page-optimization 的形状 —— 这样注入的
// mapper 返回它时，Kernel 会跑 outward + require_approval 的分支，验证的正是
// caller 真的把这条 run 推到 pending_approval。

const TEST_ACTION_KEY = 'seo.build_publish_package' as const

function outwardTestAction(): ActionDefinition {
  const base = ACTION_REGISTRY.get(TEST_ACTION_KEY) as ActionDefinition
  return {
    ...base,
    sideEffect: 'outward',
    reversible: true,
    providerIdempotency: 'supported',
    outwardAuthorization: {
      declaredIn: 'action-submission caller v1 kernel-progression test only',
      approval: { mode: 'human_only' },
      rollback: 'snapshot_restore',
    },
    inputSchema: {
      type: 'object',
      required: ['page_url', 'page_version_token', 'validated_diff_hash'],
      properties: {
        page_url: { type: 'string' },
        page_version_token: { type: 'string' },
        validated_diff_hash: { type: 'string' },
        intents: { type: 'array' },
        do_not_touch: { type: 'array' },
      },
      additionalProperties: false,
    },
    idempotency: { keyFields: ['page_url', 'validated_diff_hash'], scope: 'client' },
    costModel: {
      kind: 'fixed',
      estimate: () => 0,
      stepCeilingUsd: { build: 0, persist: 0, verify: 0 },
    },
  }
}

const APPROVAL_POLICY = {
  action_key: TEST_ACTION_KEY,
  mode: 'require_approval',
  spend_cap_per_run_usd: 100,
}

/** 一个能被观测调用次数的 capability —— 用来断言"一次都没被调"。 */
function countingCapability(calls: string[]) {
  const step = (name: string) => async () => {
    calls.push(name)
    return { output: {}, verification: null, costActualUsd: 0 }
  }
  return (): Readonly<Record<string, CapabilityImplementation>> => ({
    [TEST_ACTION_KEY]: {
      actionKey: TEST_ACTION_KEY,
      version: 1,
      steps: { build: step('build'), persist: step('persist'), verify: step('verify') },
    } as unknown as CapabilityImplementation,
  })
}

/** 一个合成的 PageOptimizationRequest —— 形状够走 caller，内容不重要。 */
function makeRequest(): PageOptimizationRequest {
  return {
    clientId: CLIENT_A,
    page: { url: 'https://client.example/geo/some-page' },
    intents: [
      {
        field: 'meta_title',
        proposedValue: 'Better title',
        semanticIntent: { known: true, value: 'clarify H1' },
      },
    ],
    lineage: { findingRefs: ['finding-1'] },
    verification: {
      metricRef: 'geo.answerability',
      windowDays: 14,
      baseline: 'previous window',
      criteria: {
        success: 'answerability up ≥ 10%',
        failure: 'answerability down',
        indeterminate: 'no signal',
      },
    },
    constraints: { doNotTouch: [] },
    basedOnVersion: { known: true, value: 'test-version-token' },
  }
}

function makeInput(): SubmitPageOptimizationRequestInput {
  return {
    candidateIdentity: { domain: 'test-domain', intent: 'test-intent' },
    request: makeRequest(),
    kernelMeta: {
      clientId: CLIENT_A,
      purpose: 'growth',
      goalId: GOAL_A,
      triggeredBy: 'human',
      rationale: 'kernel-progression integration test',
    },
    precomputed: { validatedDiffHash: 'sha256:test-precomputed' },
  }
}

// ── 集成 ──────────────────────────────────────────────────────────────────

describe('caller → 真 runAction → pending_approval', () => {
  it('happy path：run 停在 pending_approval，decision 是 require_approval，handler 零调用', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardTestAction()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const mapping: CandidateMappingResult = {
      outcome: 'mapped',
      actionKey: TEST_ACTION_KEY,
      actionVersion: 1,
    }
    const deps: PageOptimizationRequestCallerDeps = {
      kernelDeps: f.kernel,
      mapCandidate: () => mapping,
      runAction, // 真实 Kernel progression
    }

    const result = await submitPageOptimizationRequest(deps, makeInput())

    // ── caller 层：pending_approval + authorizationDecisionId 非空 ──
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome).toBe('pending_approval')
    expect(result.runId).toBeTruthy()
    expect(result.authorizationDecisionId).toBeTruthy()

    // ── Kernel 落库：run 与 decision 都真存在 ──
    const runs = f.tables.action_runs
    expect(runs).toHaveLength(1)
    const run = runs[0] as Record<string, unknown>
    expect(run.status).toBe('pending_approval')
    expect(run.authorization_decision_id).toBe(result.authorizationDecisionId)
    expect(run.client_id).toBe(CLIENT_A)
    expect(run.action_key).toBe(TEST_ACTION_KEY)
    expect(run.needs_human).toBe(true)

    const decisions = f.tables.authorization_decisions
    expect(decisions).toHaveLength(1)
    const decision = decisions[0] as Record<string, unknown>
    expect(decision.id).toBe(result.authorizationDecisionId)
    expect(decision.verdict).toBe('require_approval')
    expect(decision.action_run_id).toBe(run.id)
    expect(decision.client_id).toBe(run.client_id)

    // ── caller 传下去的 input 原样落库 ──
    const submittedInput = run.input as Record<string, unknown>
    expect(submittedInput).toEqual({
      page_url: 'https://client.example/geo/some-page',
      page_version_token: 'test-version-token',
      validated_diff_hash: 'sha256:test-precomputed',
      intents: [
        {
          field: 'meta_title',
          proposedValue: 'Better title',
          semanticIntent: { known: true, value: 'clarify H1' },
        },
      ],
      do_not_touch: [],
    })

    // ── 关键安全断言：capability handler 一次都不许被调 ──
    expect(calls, '对外 + require_approval 的 action 在 pending_approval 停手 —— handler 不该被调').toEqual([])
  })

  it('Approval Queue 能读到这条 run', async () => {
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardTestAction()]),
      capabilities: countingCapability(calls),
      options: { policy: APPROVAL_POLICY },
    })

    const deps: PageOptimizationRequestCallerDeps = {
      kernelDeps: f.kernel,
      mapCandidate: () => ({
        outcome: 'mapped',
        actionKey: TEST_ACTION_KEY,
        actionVersion: 1,
      }),
      runAction,
    }

    const result = await submitPageOptimizationRequest(deps, makeInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // 走 Approval Queue 的真实读路径
    const page = await listPendingRunsForClient(f.supabase, CLIENT_A)
    expect(page.runs).toHaveLength(1)
    const listed = page.runs[0]
    expect(listed.id).toBe(result.runId)
    expect(listed.status).toBe('pending_approval')
    expect(listed.authorization_decision_id).toBe(result.authorizationDecisionId)

    // 再次断言 handler 零调用
    expect(calls).toEqual([])
  })

  it('政策配成 auto_approve → Kernel 落 outward_requires_human_policy deny；caller 返回 kernel_denied', async () => {
    // 这条不是 caller 的行为测试 —— 是证明 Safety Gate 里 spec §2 引用的
    // 那道结构闸真的挡在了 handler 之前。对 outward action，`auto_approve`
    // 一定被判 deny，handler 一次都不能被调。
    const calls: string[] = []
    const f = makeFixture({
      registry: makeRegistry([outwardTestAction()]),
      capabilities: countingCapability(calls),
      options: {
        policy: { action_key: TEST_ACTION_KEY, mode: 'auto_approve', spend_cap_per_run_usd: 100 },
      },
    })

    const deps: PageOptimizationRequestCallerDeps = {
      kernelDeps: f.kernel,
      mapCandidate: () => ({
        outcome: 'mapped',
        actionKey: TEST_ACTION_KEY,
        actionVersion: 1,
      }),
      runAction,
    }

    const result = await submitPageOptimizationRequest(deps, makeInput())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('kernel_denied')

    const decision = f.tables.authorization_decisions[0] as Record<string, unknown>
    expect(decision.deny_code).toBe('outward_requires_human_policy')
    expect(calls, '对外 + auto_approve 被 preflight 判 deny —— handler 一次都不该被调').toEqual([])
  })
})

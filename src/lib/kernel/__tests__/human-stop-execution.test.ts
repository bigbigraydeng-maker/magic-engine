import { describe, expect, it, vi } from 'vitest'
import type { EnvelopeFactsResolver } from '../deps'
import type { EnvelopeFacts, EnvelopeRequest } from '../autonomy-envelope'
import type { ActionDefinition, TriggeredBy } from '../types'
import { ACTION_REGISTRY } from '../registry'
import { runAction, submitActionRun } from '../runner'
import { authorizeRun } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import { CLIENT_A, GOAL_A, makeFixture, makeRegistry, liveFence } from './fixtures'

const facts: EnvelopeFacts = {
  beforeCents: 1000, accountDailyTotalBeforeCents: null, dailyCapCents: null,
  learningPhaseApplicable: true, learningStage: null, hoursSinceLastChange: null,
  adStudyCount: 1, hasRollbackHandler: true,
}

// Real runner/authorization/gateway; only persistence, server facts and the external
// operation are replaced. No live database, advertising account or token is used.
function fixture(actionKey: 'ads.pause_unit' | 'ads.pause_campaign' | 'ads.cut_unit_budget' | 'ads.cut_campaign_budget', resolveFacts: EnvelopeFactsResolver) {
  const base = ACTION_REGISTRY.get(actionKey)
  if (!base) throw new Error('Missing production ads definition')
  const definition: ActionDefinition = { ...base, verification: null }
  const write = vi.fn(async () => ({ output: { applied: true } }))
  const rollback = vi.fn(async () => ({ ok: true, rollbackKind: 'noop' as const, detail: {} }))
  const f = makeFixture({
    registry: makeRegistry([definition]),
    options: { policy: { action_key: actionKey, mode: 'auto_approve' } },
    capabilities: () => ({ [actionKey]: {
      actionKey, version: 1, rollback,
      steps: {
        snapshot_pre: async () => ({ output: {} }),
        apply: write,
        readback: async () => ({ output: { applied: true } }),
      },
    } }),
  })
  const kernel = { ...f.kernel, resolveEnvelopeFacts: resolveFacts }
  const input = {
    clientId: CLIENT_A, goalId: actionKey === 'ads.cut_campaign_budget' ? null : GOAL_A,
    purpose: actionKey === 'ads.cut_campaign_budget' ? 'maintenance' as const : 'growth' as const,
    actionKey, triggeredBy: 'human' as TriggeredBy,
    input: {
      cycle_date: '2026-09-30', ad_account_id: '123',
      ...(actionKey.includes('campaign') ? { campaign_id: '456' } : { adset_id: '456' }),
      ...(actionKey.startsWith('ads.cut_') ? { after_cents: 500 } : {}),
    },
  }
  return { kernel, input, write, definition, fixture: f, tables: f.tables }
}

describe('人工止损从提交到执行的安全边界', () => {
  it.each(['ads.pause_unit', 'ads.pause_campaign', 'ads.cut_unit_budget', 'ads.cut_campaign_budget'] as const)('%s 两层均允许真实止损，重放只写一次', async key => {
    const request: EnvelopeRequest = key === 'ads.pause_unit' || key === 'ads.pause_campaign'
      ? { kind: 'pause', afterCents: 0 } : { kind: 'budget_change', afterCents: 500 }
    const resolver = vi.fn<EnvelopeFactsResolver>(async () => ({ request, facts }))
    const f = fixture(key, resolver)
    const first = await runAction(f.kernel, f.input)
    expect(first.kind, JSON.stringify(first)).toBe('succeeded')
    await runAction(f.kernel, f.input)
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ at: 'authorize' }))
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ at: 'pre_provider' }))
  })

  it('同一请求重试不重复写入，但用户重新发起的止损会创建新动作', async () => {
    const resolver = vi.fn<EnvelopeFactsResolver>(async () => ({
      request: { kind: 'pause', afterCents: 0 }, facts,
    }))
    const f = fixture('ads.pause_campaign', resolver)
    const firstIntent = { ...f.input, idempotencyNonce: 'attempt-1' }

    expect((await runAction(f.kernel, firstIntent)).kind).toBe('succeeded')
    expect((await runAction(f.kernel, firstIntent)).kind).toBe('idempotent_hit')
    expect((await runAction(f.kernel, { ...f.input, idempotencyNonce: 'attempt-2' })).kind).toBe('succeeded')
    expect(f.write).toHaveBeenCalledTimes(2)
  })

  it.each(['facts:query_failed', 'circuit:tripped', 'budget_decreased'])('授权后发生 %s：执行前挡住，零写入', async condition => {
    const request: EnvelopeRequest = { kind: 'budget_change', afterCents: 500 }
    const resolver: EnvelopeFactsResolver = async ({ at }) => {
      if (at === 'authorize') return { request, facts }
      return condition === 'budget_decreased'
        ? { request, facts: { ...facts, beforeCents: 400 } }
        : { unavailable: condition }
    }
    const f = fixture('ads.cut_unit_budget', resolver)
    expect((await runAction(f.kernel, f.input)).kind).toBe('dead_letter')
    expect(f.write).not.toHaveBeenCalled()
  })

  it('同样的未知学习期事实仍阻止 AI 自动暂停', async () => {
    const f = fixture('ads.pause_unit', async () => ({ request: { kind: 'pause', afterCents: 0 }, facts }))
    expect((await runAction(f.kernel, { ...f.input, triggeredBy: 'agent' })).kind).toBe('denied')
    expect(f.write).not.toHaveBeenCalled()
  })

  it('合法 AI 事实和当前自动规则允许真实有限自治执行，回执如实说明对外授权', async () => {
    const f = fixture('ads.pause_unit', async () => ({
      request: { kind: 'pause', afterCents: 0 },
      facts: { ...facts, accountDailyTotalBeforeCents: 1000, dailyCapCents: 2000,
        learningStage: 'SUCCESS', hoursSinceLastChange: 100, adStudyCount: 0 },
    }))
    expect((await runAction(f.kernel, { ...f.input, triggeredBy: 'agent' })).kind).toBe('succeeded')
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.tables.authorization_decisions[0].reason).toContain('有限自动执行')
    expect(f.tables.authorization_decisions[0].reason).not.toContain('不对外')
  })

  it.each(['unknown_signer', 'human_only', 'policy_changed'] as const)('%s 不能借 bounded 例外获得执行权', async condition => {
    const f = fixture('ads.pause_unit', async () => ({ request: { kind: 'pause', afterCents: 0 }, facts }))
    const { run } = await submitActionRun(f.kernel, f.input)
    const authorized = await authorizeRun(f.kernel, run)
    if (authorized.verdict !== 'allow' || !authorized.ctx) throw new Error('Expected initial authorization')
    if (condition === 'unknown_signer') f.tables.authorization_decisions[0].decided_by = 'unknown'
    const executionKernel = condition === 'human_only' ? {
      ...f.kernel,
      registry: makeRegistry([{ ...f.definition, outwardAuthorization: {
        declaredIn: 'test', rollback: 'provider_native', approval: { mode: 'human_only' },
      } }]),
    } : f.kernel
    if (condition === 'policy_changed') f.tables.client_automation_policies[0].mode = 'require_approval'
    await expect(executeAuthorizedRun(executionKernel, authorized.ctx, liveFence(f.fixture))).rejects.toMatchObject({
      code: condition === 'policy_changed' ? 'POLICY_CHANGED' : 'OUTWARD_SIDE_EFFECT_BLOCKED',
    })
    expect(f.write).not.toHaveBeenCalled()
  })
})

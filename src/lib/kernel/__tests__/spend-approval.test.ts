/**
 * 加钱类动作的 PM 本人闸（第 3 刀 3a，设计稿 `docs/specs/2026-11-03-ads-knife3-spend-gate-and-budget-buttons-design.md` §2）。
 *
 * 真 runner / 授权 / 批准 / Gateway；只换掉持久化、服务端事实和对 Meta 的写入。
 * 不连生产库、不碰广告账户。五道闸每道单独一组测试：删掉任何一道，对应那组必须红。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnvelopeFactsResolver } from '../deps'
import type { EnvelopeFacts, EnvelopeRequest } from '../autonomy-envelope'
import { isWithinPmScaleEnvelope, selectEnvelopeVerdict } from '../autonomy-envelope'
import type { ActionDefinition, AuthorizationDecision, PolicyMode } from '../types'
import { ACTION_KEYS, ACTION_REGISTRY } from '../registry'
import { approveAndRun, runAction, submitActionRun } from '../runner'
import { approveRun } from '../human-approval'
import { authorizeRun, reuseLiveAuthorization } from '../authorize'
import { executeAuthorizedRun } from '../gateway'
import {
  assertSpendApproverSigned,
  isSpendApproverUser,
  isSpendIncreaseAction,
  signedBySpendApprover,
} from '../spend-approval'
import { isSpendApproverEmail } from '@/lib/auth/whitelist'
import { CLIENT_A, GOAL_A, makeFixture, makeRegistry, liveFence } from './fixtures'

const PM = 'pm@magiclab.test'
const STAFF = 'staff@magiclab.test'
const isPm = (email: string) => email.toLowerCase() === PM

/** 能放量的事实：学习期读不到（CTS/NAL 实况）、其余都在信封内。 */
const okFacts: EnvelopeFacts = {
  beforeCents: 1000, accountDailyTotalBeforeCents: 1000, clientDailyTotalBeforeCents: 1000,
  dailyCapCents: 5000, clientDailyCapCents: 5000,
  learningPhaseApplicable: true, learningStage: null, hoursSinceLastChange: 100,
  adStudyCount: 0, hasRollbackHandler: true,
}
const scaleRequest: EnvelopeRequest = { kind: 'budget_change', afterCents: 1100 }

function fixture(opts: {
  mode: PolicyMode
  facts?: EnvelopeFacts
  isSpendApprover?: ((email: string) => boolean) | null
}) {
  const base = ACTION_REGISTRY.get('ads.scale_unit_budget')
  if (!base) throw new Error('Missing production ads definition')
  const definition: ActionDefinition = { ...base, verification: null }
  const write = vi.fn(async () => ({ output: { applied: true } }))
  const rollback = vi.fn(async () => ({ ok: true, rollbackKind: 'noop' as const, detail: {} }))
  const f = makeFixture({
    registry: makeRegistry([definition]),
    options: { policy: { action_key: 'ads.scale_unit_budget', mode: opts.mode } },
    capabilities: () => ({ 'ads.scale_unit_budget': {
      actionKey: 'ads.scale_unit_budget', version: 1, rollback,
      steps: {
        snapshot_pre: async () => ({ output: {} }),
        apply: write,
        readback: async () => ({ output: { applied: true } }),
      },
    } }),
  })
  const resolver = vi.fn<EnvelopeFactsResolver>(async () => ({ request: scaleRequest, facts: opts.facts ?? okFacts }))
  const kernel = {
    ...f.kernel,
    resolveEnvelopeFacts: resolver,
    ...(opts.isSpendApprover === null ? {} : { isSpendApprover: opts.isSpendApprover ?? isPm }),
  }
  const input = {
    clientId: CLIENT_A, goalId: GOAL_A, purpose: 'growth' as const,
    actionKey: 'ads.scale_unit_budget' as const, triggeredBy: 'human' as const,
    input: { cycle_date: '2026-11-03', ad_account_id: '123', adset_id: '456', campaign_id: '789', before_cents: 1000, after_cents: 1100 },
  }
  return { kernel, input, write, resolver, tables: f.tables, fixture: f }
}

async function pending(f: ReturnType<typeof fixture>) {
  const outcome = await runAction(f.kernel, f.input)
  expect(outcome.kind, JSON.stringify(outcome)).toBe('pending_approval')
  return outcome.run.id
}

describe('声明：每个广告动作都明写 spendIncrease', () => {
  it('🔴 守卫：注册表里每个 ads.* 动作都写了 true / false，不许缺', () => {
    const ads = ACTION_KEYS.filter((k) => k.startsWith('ads.'))
    expect(ads.length).toBeGreaterThan(0)
    for (const key of ads) {
      expect(typeof ACTION_REGISTRY.get(key)?.spendIncrease, key).toBe('boolean')
    }
  })

  it('加钱类恰好是加预算 / 挪预算 / 新建再营销组；刹车都不是', () => {
    const spend = ACTION_KEYS.filter((k) => isSpendIncreaseAction(ACTION_REGISTRY.get(k))).sort()
    expect(spend).toEqual(['ads.add_retargeting_adset', 'ads.budget_move_plan', 'ads.scale_unit_budget'])
    for (const brake of ['ads.pause_unit', 'ads.pause_campaign', 'ads.cut_unit_budget', 'ads.cut_campaign_budget', 'ads.auto_pause_on_d3']) {
      expect(isSpendIncreaseAction(ACTION_REGISTRY.get(brake)), brake).toBe(false)
    }
  })
})

describe('名单判定 fail closed', () => {
  afterEach(() => { delete process.env.ADS_SPEND_APPROVER_EMAILS })

  it('ADS_SPEND_APPROVER_EMAILS 没配 = 谁都不是；不回落到 ADMIN_EMAILS', () => {
    process.env.ADMIN_EMAILS = PM
    expect(isSpendApproverEmail(PM)).toBe(false)
    delete process.env.ADMIN_EMAILS
  })

  it('精确匹配、忽略大小写和空格；空邮箱不算', () => {
    process.env.ADS_SPEND_APPROVER_EMAILS = ` ${PM} ,`
    expect(isSpendApproverEmail('PM@MagicLab.test')).toBe(true)
    expect(isSpendApproverEmail(STAFF)).toBe(false)
    expect(isSpendApproverEmail('')).toBe(false)
  })

  it('内核没注入判定 → 谁都不是批准人；机器签的放行永远不算', () => {
    expect(isSpendApproverUser({}, PM)).toBe(false)
    expect(isSpendApproverUser({ isSpendApprover: isPm }, null)).toBe(false)
    const human = { decided_by: 'human', decided_by_user: PM } as Pick<AuthorizationDecision, 'decided_by' | 'decided_by_user'>
    expect(signedBySpendApprover({ isSpendApprover: isPm }, human)).toBe(true)
    expect(signedBySpendApprover({ isSpendApprover: isPm }, { ...human, decided_by: 'policy' })).toBe(false)
    expect(signedBySpendApprover({ isSpendApprover: isPm }, { ...human, decided_by_user: STAFF })).toBe(false)
  })
})

describe('PM 放量信封：只放宽「学习期读不到」这一条', () => {
  const envelope = (ACTION_REGISTRY.get('ads.scale_unit_budget')?.outwardAuthorization?.approval as { envelope: Parameters<typeof isWithinPmScaleEnvelope>[2] }).envelope

  it('学习期读不到：AI 信封拒，PM 信封放', () => {
    const ai = selectEnvelopeVerdict({ triggeredBy: 'human', actionKey: 'ads.scale_unit_budget', request: scaleRequest, facts: okFacts, envelope })
    expect(ai.within).toBe(false)
    const pm = selectEnvelopeVerdict({ triggeredBy: 'human', actionKey: 'ads.scale_unit_budget', request: scaleRequest, facts: okFacts, envelope, pmApprovedSpendIncrease: true })
    expect(pm).toMatchObject({ within: true, envelopeUsed: 'pm_scale' })
  })

  it.each([
    ['明确还在学习期', { learningStage: 'LEARNING' }],
    ['72 小时内改过', { hoursSinceLastChange: 10 }],
    ['在 Meta 实验里', { adStudyCount: 1 }],
    ['超日上限', { dailyCapCents: 1050, clientDailyCapCents: 1050 }],
  ] as const)('%s → PM 信封照样拒', (_label, patch) => {
    expect(isWithinPmScaleEnvelope(scaleRequest, { ...okFacts, ...patch }, envelope).within).toBe(false)
  })

  it('一次超过 20% → PM 信封照样拒', () => {
    expect(isWithinPmScaleEnvelope({ kind: 'budget_change', afterCents: 1300 }, okFacts, envelope).within).toBe(false)
  })
})

describe('第 1 道（同步）在 sync-policy 测试里；第 2 道：授权预检', () => {
  it('🔴 策略是自动批准 → 加钱类直接拒，一次都不写 Meta', async () => {
    const f = fixture({ mode: 'auto_approve' })
    const outcome = await runAction(f.kernel, f.input)
    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions.at(-1)?.deny_code).toBe('outward_requires_human_policy')
    expect(f.tables.authorization_decisions.at(-1)?.reason).toContain('只有 PM 本人能批')
    expect(f.write).not.toHaveBeenCalled()
  })
})

describe('第 3 道：签批准', () => {
  it('🔴 非 PM 点批准 → 抛错、不签决策、run 仍等 PM', async () => {
    const f = fixture({ mode: 'require_approval' })
    const runId = await pending(f)
    const decisionsBefore = f.tables.authorization_decisions.length
    await expect(approveRun(f.kernel, runId, STAFF)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    expect(f.tables.authorization_decisions.length).toBe(decisionsBefore)
    expect((await f.kernel.requireRun(runId)).status).toBe('pending_approval')
    expect(f.write).not.toHaveBeenCalled()
  })

  it('🔴 内核没注入判定 → PM 本人也批不了', async () => {
    const f = fixture({ mode: 'require_approval', isSpendApprover: null })
    const runId = await pending(f)
    await expect(approveRun(f.kernel, runId, PM)).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
  })

  it('PM 本人批 → 学习期读不到也能执行到 Meta，批准时和碰 Meta 前各判一次信封', async () => {
    const f = fixture({ mode: 'require_approval' })
    const runId = await pending(f)
    const outcome = await approveAndRun(f.kernel, runId, PM)
    expect(outcome.kind, JSON.stringify(outcome)).toBe('succeeded')
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.resolver).toHaveBeenCalledWith(expect.objectContaining({ at: 'authorize' }))
    expect(f.resolver).toHaveBeenCalledWith(expect.objectContaining({ at: 'pre_provider' }))
  })

  it('PM 批时信封判不过（72 小时内改过）→ 当场落可恢复 deny，说清哪条，不写 Meta', async () => {
    const f = fixture({ mode: 'require_approval', facts: { ...okFacts, hoursSinceLastChange: 10 } })
    const runId = await pending(f)
    const outcome = await approveAndRun(f.kernel, runId, PM)
    expect(outcome.kind).toBe('denied')
    expect(f.tables.authorization_decisions.at(-1)?.deny_code).toBe('outside_autonomy_envelope')
    expect(f.tables.authorization_decisions.at(-1)?.reason).toContain('72 小时')
    expect(f.write).not.toHaveBeenCalled()
  })
})

describe('第 4 道：复用旧授权', () => {
  it('🔴 放行签字人不是 PM → 不复用（返回 null 重新授权）', async () => {
    const f = fixture({ mode: 'require_approval' })
    const runId = await pending(f)
    const approved = await approveRun(f.kernel, runId, PM)
    expect(approved.verdict).toBe('allow')
    const run = await f.kernel.requireRun(runId)
    expect(await reuseLiveAuthorization(f.kernel, run)).not.toBeNull()
    const allow = f.tables.authorization_decisions.find((d) => d.id === run.authorization_decision_id)
    if (!allow) throw new Error('missing allow decision')
    allow.decided_by_user = STAFF
    expect(await reuseLiveAuthorization(f.kernel, run)).toBeNull()
  })
})

describe('第 5 道：执行前复核', () => {
  it('🔴 放行决策被改成别人签的 → Gateway 停手，零写入', async () => {
    const f = fixture({ mode: 'require_approval' })
    const runId = await pending(f)
    const approved = await approveRun(f.kernel, runId, PM)
    if (approved.verdict !== 'allow' || !approved.ctx) throw new Error('expected allow')
    const allow = f.tables.authorization_decisions.find((d) => d.id === approved.decision.id)
    if (!allow) throw new Error('missing allow decision')
    allow.decided_by_user = STAFF
    await expect(executeAuthorizedRun(f.kernel, approved.ctx, liveFence(f.fixture))).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })
    expect(f.write).not.toHaveBeenCalled()
  })

  it('assertSpendApproverSigned：非加钱类不管；加钱类未签即抛', () => {
    const decision = { decided_by: 'policy', decided_by_user: null, action_key: 'ads.pause_unit' } as Pick<AuthorizationDecision, 'decided_by' | 'decided_by_user' | 'action_key'>
    expect(() => assertSpendApproverSigned({ spendIncrease: false }, decision, false)).not.toThrow()
    expect(() => assertSpendApproverSigned({ spendIncrease: true }, decision, false)).toThrow(/只有 PM 本人能批/)
    expect(() => assertSpendApproverSigned({ spendIncrease: true }, decision, true)).not.toThrow()
  })
})

describe('刹车不受影响', () => {
  it('提交本身照旧（submitActionRun 不看批准人）', async () => {
    const f = fixture({ mode: 'require_approval' })
    const { run } = await submitActionRun(f.kernel, f.input)
    const auth = await authorizeRun(f.kernel, run)
    expect(auth.verdict).toBe('require_approval')
  })
})

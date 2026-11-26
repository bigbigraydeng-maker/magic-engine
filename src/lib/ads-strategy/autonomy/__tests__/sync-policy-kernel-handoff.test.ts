/**
 * 「同步规则写出的策略 × 内核授权」衔接测试（魏征点名没覆盖的那一处）。
 *
 * 单测各自都绿不代表接上了：同步规则只测「写了什么 mode」，内核只测「拿到某个 mode 怎么判」，
 * 2026-11-04 之前两边都绿，可客户一开受限自动档，D3 自动暂停就被内核直接拒、PM 看不到。
 *
 * 这里把 `targetModeFor` 产出的 mode 原样写进客户政策，用**真注册表里的 D3 定义**、
 * 真 runner / authorize（只换持久化）提交一次，断言它停在等批准而不是被拒。
 * 不连生产库、不碰 Meta：等批准阶段 capability 一步都不跑（断言了）。
 */
import { describe, expect, it } from 'vitest'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import type { CapabilityImplementation } from '@/lib/kernel/types'
import { makeFixture, makeRegistry, CLIENT_A } from '@/lib/kernel/__tests__/fixtures'
import { submitAdsAutoPauseCandidate } from '@/lib/action-submission/ads-auto-pause'
import { ADS_AUTO_PAUSE_ACTION_KEY } from '@/lib/action-submission/ads-auto-pause-key'
import { targetModeFor, type AutonomyMode } from '../sync-policy'

function d3Fixture(policyMode: string) {
  const definition = ACTION_REGISTRY.get(ADS_AUTO_PAUSE_ACTION_KEY)
  if (!definition) throw new Error('注册表里没有 D3 自动暂停定义')
  const calls: string[] = []
  const capability: CapabilityImplementation = {
    actionKey: ADS_AUTO_PAUSE_ACTION_KEY,
    version: definition.version,
    steps: Object.fromEntries(
      definition.steps.map((step) => [step, async () => { calls.push(step); return { output: {} } }]),
    ),
  }
  const f = makeFixture({
    registry: makeRegistry([definition]),
    capabilities: () => ({ [ADS_AUTO_PAUSE_ACTION_KEY]: capability }),
    options: { policy: { action_key: ADS_AUTO_PAUSE_ACTION_KEY, mode: policyMode } },
  })
  return { f, calls }
}

async function submit(f: ReturnType<typeof d3Fixture>['f']) {
  return submitAdsAutoPauseCandidate(f.kernel, {
    clientId: CLIENT_A,
    adAccountId: 'act_1',
    adsetId: 'adset-9',
    diagnosisCode: 'D3',
    insightDate: '2026-11-03',
    triggeredByRef: 'diag-run-1',
    rationale: '「测试广告组」连续 3 天花钱没结果',
    evidence: {},
  })
}

describe('🔴 同步规则写出的策略喂给内核：D3 自动暂停不再被拒', () => {
  it.each<AutonomyMode>(['bounded_auto', 'observe'])('自治档 %s → 同步写出的 mode 让内核停在等批准', async (autonomy) => {
    const mode = targetModeFor(ADS_AUTO_PAUSE_ACTION_KEY, autonomy)
    const { f, calls } = d3Fixture(mode)

    const result = await submit(f)

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, outcome: 'pending_approval' })
    expect(f.tables.authorization_decisions[0]?.deny_code ?? null).toBeNull()
    expect(calls, '等批准阶段不许真的去暂停').toEqual([])
  })

  it('对照组：旧同步写的 auto_approve 喂给内核 → 被拒（outward_requires_human_policy）——证明这组测试分得出好坏', async () => {
    const { f, calls } = d3Fixture('auto_approve')

    const result = await submit(f)

    expect(result).toMatchObject({ ok: false, reason: 'kernel_denied' })
    expect(f.tables.authorization_decisions[0]?.deny_code).toBe('outward_requires_human_policy')
    expect(calls).toEqual([])
  })
})

/**
 * `sync-policy.ts` 的纯判据测试。
 *
 * 这里只测**纯函数**：映射表、动作键清单、幂等判据、审计标签。
 * 不碰 supabase、不碰 Inngest —— 那些在
 * src/lib/inngest/functions/__tests__/ads-autonomy-sync.test.ts 里。
 *
 * 重点锁死两件事：
 *   1. `deny` 永远不在映射值域里（它是为未来管理员 / 熔断预留的，同步不许写）。
 *   2. 幂等判据按**时间戳**比，不按字符串比 —— ISO 字符串的字典序在时区偏移
 *      不同时会骗人。
 */
import { describe, it, expect } from 'vitest'
import {
  AUTONOMY_TO_POLICY_MODE,
  listAdsActionKeys,
  planAutonomySync,
  requiresHumanApprovalPolicy,
  syncActorLabel, targetModeFor } from '../sync-policy'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'

describe('AUTONOMY_TO_POLICY_MODE', () => {
  it('observe → require_approval', () => {
    expect(AUTONOMY_TO_POLICY_MODE.observe).toBe('require_approval')
  })

  it('bounded_auto → auto_approve', () => {
    expect(AUTONOMY_TO_POLICY_MODE.bounded_auto).toBe('auto_approve')
  })

  it('🔴 值域里永远没有 deny —— 同步不许写 deny', () => {
    expect(Object.values(AUTONOMY_TO_POLICY_MODE)).not.toContain('deny')
  })
})

describe('listAdsActionKeys', () => {
  it('至少 6 个键，全部以 ads. 开头', () => {
    const keys = listAdsActionKeys()
    expect(keys.length).toBeGreaterThanOrEqual(6)
    for (const key of keys) {
      expect(key.startsWith('ads.')).toBe(true)
    }
  })

  it('包含 ads.pause_unit', () => {
    expect(listAdsActionKeys()).toContain('ads.pause_unit')
  })

  it('系列预算动作会进入 Inngest 驱动的广告策略同步', () => {
    expect(listAdsActionKeys()).toContain('ads.cut_campaign_budget')
  })
})

const SPEND_INCREASE_KEYS = new Set(listAdsActionKeys().filter((k) => ACTION_REGISTRY.get(k)?.spendIncrease === true))
/** 直接读动作定义（不经被测函数）：对外 + approval 不是 bounded = 内核对 auto_approve 一律拒。 */
const HUMAN_ONLY_KEYS = new Set(
  listAdsActionKeys().filter((k) => {
    const d = ACTION_REGISTRY.get(k)
    return d?.sideEffect === 'outward' && d.outwardAuthorization?.approval.mode !== 'bounded'
  }),
)
const MUST_ASK = (k: string) => SPEND_INCREASE_KEYS.has(k) || HUMAN_ONLY_KEYS.has(k)

describe('planAutonomySync', () => {
  it('没有历史回执时：每个键一条，全部不跳过', () => {
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt: '2026-09-25T10:00:00.000Z',
      lastSynced: new Map(),
    })
    expect(plan.map((i) => i.key)).toEqual([...listAdsActionKeys()])
    for (const item of plan) {
      expect(item.skip).toBeNull()
      // 🔴 第 3 刀 3a：加钱类不管自治程度，一律要审批（只有 PM 本人能批）；
      //    只能人点头的对外动作同理（内核 ⑥b 对它们 + auto_approve 直接拒）
      expect(item.mode).toBe(MUST_ASK(item.key) ? 'require_approval' : 'auto_approve')
    }
  })

  it('🔴 加钱类动作在 bounded_auto 下也是 require_approval（第 3 刀 3a 第 1 道闸）', () => {
    for (const key of ['ads.scale_unit_budget', 'ads.budget_move_plan', 'ads.add_retargeting_adset']) {
      expect(SPEND_INCREASE_KEYS.has(key)).toBe(true)
      expect(targetModeFor(key, 'bounded_auto')).toBe('require_approval')
    }
    // 刹车不受影响
    for (const key of ['ads.pause_unit', 'ads.pause_campaign', 'ads.cut_unit_budget', 'ads.cut_campaign_budget']) {
      expect(targetModeFor(key, 'bounded_auto')).toBe('auto_approve')
    }
  })

  it('🔴 只能人点头的对外动作（D3 自动暂停）在 bounded_auto 下也写 require_approval，不写 auto_approve', () => {
    // 守卫：注册表里确实有这类动作，且 D3 自动暂停就在其中——不然下面的断言是空转
    expect(HUMAN_ONLY_KEYS.has('ads.auto_pause_on_d3')).toBe(true)
    expect(ACTION_REGISTRY.get('ads.auto_pause_on_d3')?.outwardAuthorization?.approval.mode).toBe('human_only')
    for (const key of HUMAN_ONLY_KEYS) {
      expect(requiresHumanApprovalPolicy(key), key).toBe(true)
      for (const mode of ['bounded_auto', 'observe'] as const) {
        expect(targetModeFor(key, mode), `${key} @ ${mode}`).toBe('require_approval')
      }
    }
    const plan = planAutonomySync({ autonomyMode: 'bounded_auto', sourceUpdatedAt: '2026-11-04T00:00:00.000Z', lastSynced: new Map() })
    expect(plan.find((i) => i.key === 'ads.auto_pause_on_d3')?.mode).toBe('require_approval')
  })

  it('信封内自治（bounded）的刹车动作不受影响：bounded_auto 下仍是 auto_approve', () => {
    for (const key of ['ads.pause_unit', 'ads.pause_campaign', 'ads.cut_unit_budget', 'ads.cut_campaign_budget', 'ads.swap_creative']) {
      expect(requiresHumanApprovalPolicy(key), key).toBe(false)
      expect(targetModeFor(key, 'bounded_auto'), key).toBe('auto_approve')
    }
  })

  it('认不出的动作键当成要人点头（fail closed）', () => {
    expect(requiresHumanApprovalPolicy('ads.not_a_real_action')).toBe(true)
    expect(targetModeFor('ads.not_a_real_action', 'bounded_auto')).toBe('require_approval')
  })

  it('🔴 D3 自动暂停旧回执写的是 auto_approve（部署前）→ 设置没人动也要重写成 require_approval', () => {
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt: '2026-09-25T10:00:00.000Z',
      lastSynced: new Map([['ads.auto_pause_on_d3', { sourceUpdatedAt: '2026-10-01T00:00:00.000Z', toMode: 'auto_approve' }]]),
    })
    expect(plan.find((i) => i.key === 'ads.auto_pause_on_d3')).toMatchObject({ mode: 'require_approval', skip: null })
  })

  it('🔴 同步规则改过（上次写的目标模式不同）→ 不看时间也要重写：部署后旧的 auto_approve 行会被改过来', () => {
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt: '2026-09-25T10:00:00.000Z',
      lastSynced: new Map([
        ['ads.scale_unit_budget', { sourceUpdatedAt: '2026-10-01T00:00:00.000Z', toMode: 'auto_approve' }],
        ['ads.pause_unit', { sourceUpdatedAt: '2026-10-01T00:00:00.000Z', toMode: 'auto_approve' }],
        ['ads.cut_unit_budget', { sourceUpdatedAt: '2026-10-01T00:00:00.000Z', toMode: null }],
      ]),
    })
    const byKey = new Map(plan.map((i) => [i.key, i]))
    expect(byKey.get('ads.scale_unit_budget')).toMatchObject({ mode: 'require_approval', skip: null })
    expect(byKey.get('ads.pause_unit')?.skip).toBe('already_synced')
    expect(byKey.get('ads.cut_unit_budget')?.skip).toBeNull() // 读不到目标模式 = 当没同步过
  })

  it('observe 模式下每个键都是 require_approval', () => {
    const plan = planAutonomySync({
      autonomyMode: 'observe',
      sourceUpdatedAt: '2026-09-25T10:00:00.000Z',
      lastSynced: new Map(),
    })
    for (const item of plan) {
      expect(item.mode).toBe('require_approval')
    }
  })

  it('🔴 幂等：等于 / 更旧 / 更新三种时间戳的跳过判据', () => {
    const sourceUpdatedAt = '2026-09-25T10:00:00.000Z'
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt,
      lastSynced: new Map([
        ['ads.pause_unit', { sourceUpdatedAt: '2026-09-25T10:00:00.000Z', toMode: 'auto_approve' }], // 相等 → 跳过
        ['ads.cut_unit_budget', { sourceUpdatedAt: '2026-09-25T09:59:59.000Z', toMode: 'auto_approve' }], // 更旧 → 不跳过
        ['ads.scale_unit_budget', { sourceUpdatedAt: '2026-09-26T00:00:00.000Z', toMode: 'require_approval' }], // 更新 → 跳过
      ]),
    })
    const byKey = new Map(plan.map((i) => [i.key, i.skip]))
    expect(byKey.get('ads.pause_unit')).toBe('already_synced')
    expect(byKey.get('ads.cut_unit_budget')).toBeNull()
    expect(byKey.get('ads.scale_unit_budget')).toBe('already_synced')
  })

  it('🔴 按时间戳比，不按字符串比 —— 时区偏移不同时字典序会骗人', () => {
    // sourceUpdatedAt = 2026-09-25T00:00:00+13:00 即 2026-09-24T11:00:00Z。
    // lastSynced = 2026-09-24T12:00:00Z 时间上更晚 → 已同步过。
    // 但字符串比较：'2026-09-24T12:00:00Z' < '2026-09-25T00:00:00+13:00'，
    // 会误判成「没同步过」。
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt: '2026-09-25T00:00:00+13:00',
      lastSynced: new Map([['ads.pause_unit', { sourceUpdatedAt: '2026-09-24T12:00:00Z', toMode: 'auto_approve' }]]),
    })
    const item = plan.find((i) => i.key === 'ads.pause_unit')
    expect(item?.skip).toBe('already_synced')
  })

  it('读不懂的时间戳一律当没同步过（宁可多写一次幂等 UPDATE）', () => {
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt: '2026-09-25T10:00:00.000Z',
      lastSynced: new Map([['ads.pause_unit', { sourceUpdatedAt: 'garbage', toMode: 'auto_approve' }]]),
    })
    const item = plan.find((i) => i.key === 'ads.pause_unit')
    expect(item?.skip).toBeNull()
  })
})

describe('syncActorLabel', () => {
  it('带邮箱', () => {
    expect(syncActorLabel('pm@example.test', '2026-09-25T10:00:00.000Z')).toBe(
      'autonomy-sync:pm@example.test:2026-09-25T10:00:00.000Z',
    )
  })

  it('null 邮箱 → unknown', () => {
    expect(syncActorLabel(null, 'x')).toBe('autonomy-sync:unknown:x')
  })

  it('空白邮箱 → unknown', () => {
    expect(syncActorLabel('   ', 'x')).toBe('autonomy-sync:unknown:x')
  })
})

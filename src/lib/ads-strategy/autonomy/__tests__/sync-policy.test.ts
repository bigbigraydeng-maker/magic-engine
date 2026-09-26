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
  syncActorLabel,
} from '../sync-policy'

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
})

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
      expect(item.mode).toBe('auto_approve')
    }
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
        ['ads.pause_unit', '2026-09-25T10:00:00.000Z'], // 相等 → 跳过
        ['ads.cut_unit_budget', '2026-09-25T09:59:59.000Z'], // 更旧 → 不跳过
        ['ads.scale_unit_budget', '2026-09-26T00:00:00.000Z'], // 更新 → 跳过
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
      lastSynced: new Map([['ads.pause_unit', '2026-09-24T12:00:00Z']]),
    })
    const item = plan.find((i) => i.key === 'ads.pause_unit')
    expect(item?.skip).toBe('already_synced')
  })

  it('读不懂的时间戳一律当没同步过（宁可多写一次幂等 UPDATE）', () => {
    const plan = planAutonomySync({
      autonomyMode: 'bounded_auto',
      sourceUpdatedAt: '2026-09-25T10:00:00.000Z',
      lastSynced: new Map([['ads.pause_unit', 'garbage']]),
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

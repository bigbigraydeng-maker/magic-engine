/**
 * 预算锁配置读函数测试（ads IMPACT 阶段 2，设计 §4.1 硬前置第 2 条 / §14 M4）。
 *
 * 这是本 PR 的核心断言：跟 src/lib/ads-strategy/config.ts 的 fail-open 方向相反——
 * 缺行、读失败都必须锁定，不能沿用"没有配置行 = 默认放开"那一套。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const maybeSingle = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}))

import {
  loadBudgetPolicy,
  parseBudgetPolicyRow,
  lockedBudgetPolicy,
  DEFAULT_PER_UNIT_DAILY_CHANGE_CAP_PCT,
} from '../budget-policy'

describe('loadBudgetPolicy — 缺行 / 读错误一律锁定（M4）', () => {
  beforeEach(() => { maybeSingle.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('没有配置行（no_row）→ locked:true，不沿用 config.ts 的默认放开', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const { policy, source } = await loadBudgetPolicy('c1')
    expect(source).toBe('no_row')
    expect(policy.locked).toBe(true)
    expect(policy.totalDailyCapMinor).toBeNull()
    expect(policy.perUnitDailyChangeCapPct).toBeNull()
  })

  it('读失败（read_error）→ locked:true，跟 config.ts 的 fail-open 方向相反', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const { policy, source, error } = await loadBudgetPolicy('c1')
    expect(source).toBe('read_error')
    expect(policy.locked).toBe(true)
    expect(error).toBe('timeout')
  })

  it('select 本身抛异常（如网络层错误）→ 同样 locked:true 的 read_error，不外泄未捕获异常', async () => {
    maybeSingle.mockRejectedValue(new Error('network down'))
    const { policy, source, error } = await loadBudgetPolicy('c1')
    expect(source).toBe('read_error')
    expect(policy.locked).toBe(true)
    expect(error).toBe('network down')
  })

  it('有行且 budget_locked 显式为 false → 不锁定', async () => {
    maybeSingle.mockResolvedValue({
      data: { budget_locked: false, total_daily_cap_minor: 500000, per_unit_daily_change_cap_pct: 15 },
      error: null,
    })
    const { policy, source } = await loadBudgetPolicy('c1')
    expect(source).toBe('row')
    expect(policy.locked).toBe(false)
    expect(policy.totalDailyCapMinor).toBe(500000)
    expect(policy.perUnitDailyChangeCapPct).toBe(15)
  })

  it('有行但 budget_locked 是 true → 锁定（正常配置路径,非缺省兜底）', async () => {
    maybeSingle.mockResolvedValue({ data: { budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null }, error: null })
    const { policy, source } = await loadBudgetPolicy('c1')
    expect(source).toBe('row')
    expect(policy.locked).toBe(true)
  })
})

describe('parseBudgetPolicyRow — locked 判定不对称，只有显式 false 才解锁', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['true', true],
    ['字符串 "false"（脏值，非布尔）', 'false'],
    ['数字 0（脏值，非布尔）', 0],
  ])('budget_locked = %s → locked:true', (_name, value) => {
    const policy = parseBudgetPolicyRow({ budget_locked: value, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null })
    expect(policy.locked).toBe(true)
  })

  it('budget_locked 严格 === false → locked:false', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: false, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: null })
    expect(policy.locked).toBe(false)
  })
})

describe('parseBudgetPolicyRow — 脏值只影响自己的字段，不传染 locked 判定路径', () => {
  it('total_daily_cap_minor 是负数 → 按未设置处理，locked 判定不受影响', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: false, total_daily_cap_minor: -100, per_unit_daily_change_cap_pct: null })
    expect(policy.totalDailyCapMinor).toBeNull()
    expect(policy.locked).toBe(false) // 脏值没有把 locked 带坏
  })

  it('total_daily_cap_minor 是非整数 → 按未设置处理', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: false, total_daily_cap_minor: 100.5, per_unit_daily_change_cap_pct: null })
    expect(policy.totalDailyCapMinor).toBeNull()
  })

  it('total_daily_cap_minor 是数字字符串（Postgres bigint 常见返回形态）→ 正常解析', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: false, total_daily_cap_minor: '250000', per_unit_daily_change_cap_pct: null })
    expect(policy.totalDailyCapMinor).toBe(250000)
  })

  it('per_unit_daily_change_cap_pct 超出 0-100 → 按未设置处理，locked 判定不受影响', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: false, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: 150 })
    expect(policy.perUnitDailyChangeCapPct).toBeNull()
    expect(policy.locked).toBe(false)
  })

  it('per_unit_daily_change_cap_pct 是 0 或负数 → 按未设置处理', () => {
    expect(parseBudgetPolicyRow({ budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: 0 }).perUnitDailyChangeCapPct).toBeNull()
    expect(parseBudgetPolicyRow({ budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: -5 }).perUnitDailyChangeCapPct).toBeNull()
  })

  it('per_unit_daily_change_cap_pct 是数字字符串（Postgres numeric 常见返回形态）→ 正常解析', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: true, total_daily_cap_minor: null, per_unit_daily_change_cap_pct: '12.5' })
    expect(policy.perUnitDailyChangeCapPct).toBe(12.5)
  })

  it('两个上限字段都合法 → 原样保留，且互不影响（total 设了，pct 可以仍是 null）', () => {
    const policy = parseBudgetPolicyRow({ budget_locked: false, total_daily_cap_minor: 100000, per_unit_daily_change_cap_pct: null })
    expect(policy.totalDailyCapMinor).toBe(100000)
    expect(policy.perUnitDailyChangeCapPct).toBeNull()
  })
})

describe('lockedBudgetPolicy / DEFAULT_PER_UNIT_DAILY_CHANGE_CAP_PCT', () => {
  it('lockedBudgetPolicy() 返回锁定且两项上限皆未设置', () => {
    expect(lockedBudgetPolicy()).toEqual({ locked: true, totalDailyCapMinor: null, perUnitDailyChangeCapPct: null })
  })

  it('兜底变动上限取自设计 §4.3「单次 ≤20%」，唯一定义处', () => {
    expect(DEFAULT_PER_UNIT_DAILY_CHANGE_CAP_PCT).toBe(20)
  })
})

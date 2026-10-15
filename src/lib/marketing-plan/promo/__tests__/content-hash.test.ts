import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { promoContentHash, __sha256HexForTest } from '../content-hash'
import { baseSpec } from './fixtures'
import type { PromoSpec } from '../spec'

/** 深拷贝夹具，避免用例之间互相污染。 */
function clone(spec: PromoSpec): PromoSpec {
  return structuredClone(spec)
}

describe('promoContentHash', () => {
  it('同一 spec 调两次结果相同，且是 16 位十六进制', () => {
    const spec = baseSpec()
    const a = promoContentHash(spec)
    const b = promoContentHash(spec)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  it('对象键顺序不同但内容一样 → 同一指纹', () => {
    const spec = baseSpec()
    // 通过 JSON 往返后手工重建，打乱顶层键顺序。
    const parsed = JSON.parse(JSON.stringify(spec)) as PromoSpec
    const reordered = {
      checks: parsed.checks,
      phases: parsed.phases,
      goal_id: parsed.goal_id,
      schema: parsed.schema,
    } as unknown as PromoSpec
    expect(promoContentHash(reordered)).toBe(promoContentHash(spec))
  })

  it('checks 内容不同 → 同一指纹', () => {
    const spec = baseSpec()
    const withChecks = clone(spec)
    withChecks.checks = [{ phase_id: 'p1', check_key: 'landing.item_live', verified_by: 'x@example.com', verified_at: '2026-10-30T00:00:00Z', note: '' }]
    expect(promoContentHash(withChecks)).toBe(promoContentHash(spec))
  })

  it('gate_snapshot 不同 → 同一指纹', () => {
    const spec = baseSpec()
    const withSnapshot = clone(spec)
    withSnapshot.gate_snapshot = { captured_at: '2026-10-30T00:00:00Z', passed: true }
    expect(promoContentHash(withSnapshot)).toBe(promoContentHash(spec))
  })

  it('改广告步骤的 daily_budget_cents → 指纹变化', () => {
    const spec = baseSpec()
    const changed = clone(spec)
    const step = changed.phases[0].steps[0]
    if (step.kind !== 'ads_campaign') throw new Error('夹具结构变了')
    step.settings.daily_budget_cents = 9999
    expect(promoContentHash(changed)).not.toBe(promoContentHash(spec))
  })

  it('改广告步骤的 audience_ref → 指纹变化', () => {
    const spec = baseSpec()
    const changed = clone(spec)
    const step = changed.phases[0].steps[0]
    if (step.kind !== 'ads_campaign') throw new Error('夹具结构变了')
    step.settings.audience_ref = 'aud-2'
    expect(promoContentHash(changed)).not.toBe(promoContentHash(spec))
  })

  it('改广告步骤的 creative_refs → 指纹变化', () => {
    const spec = baseSpec()
    const changed = clone(spec)
    const step = changed.phases[0].steps[0]
    if (step.kind !== 'ads_campaign') throw new Error('夹具结构变了')
    step.settings.creative_refs = ['vid-2']
    expect(promoContentHash(changed)).not.toBe(promoContentHash(spec))
  })

  it('改阶段 start_date → 指纹变化', () => {
    const spec = baseSpec()
    const changed = clone(spec)
    changed.phases[0].start_date = '2026-11-02'
    expect(promoContentHash(changed)).not.toBe(promoContentHash(spec))
  })

  it('改 goal_id → 指纹变化', () => {
    const spec = baseSpec()
    const changed = clone(spec)
    changed.goal_id = 'goal-2'
    expect(promoContentHash(changed)).not.toBe(promoContentHash(spec))
  })

  it('交换两个阶段的顺序 → 指纹变化', () => {
    const spec = baseSpec()
    const changed = clone(spec)
    changed.phases = [changed.phases[1], changed.phases[0]]
    expect(promoContentHash(changed)).not.toBe(promoContentHash(spec))
  })
})

describe('纯 JS sha256 与标准实现一致（浏览器里也要能算）', () => {
  it.each(['', 'abc', '推广计划 内容指纹', 'a'.repeat(1000), JSON.stringify({ x: [1, 2, { y: '中文' }] })])('输入 %#', (input) => {
    expect(__sha256HexForTest(input)).toBe(createHash('sha256').update(input).digest('hex'))
  })
})

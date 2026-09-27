import { describe, it, expect } from 'vitest'
import {
  detectSpendSpike,
  detectDataCompleteness,
  type DailySpendPoint,
  type DetectorVerdict,
} from '../circuit-detectors'

/** 造一个非零花费点，日期只是占位，判据不看日期。 */
function point(spendCents: number, day = 1): DailySpendPoint {
  return { insightDate: `2026-09-${String(day).padStart(2, '0')}`, spendCents }
}

/** 造 n 个相同花费的非零天。 */
function points(spendCents: number, n: number): DailySpendPoint[] {
  return Array.from({ length: n }, (_, i) => point(spendCents, i + 1))
}

const CAP = 1_000_000

describe('detectSpendSpike', () => {
  it('targetSpendCents 为 null 时 undeterminable', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 7),
      targetSpendCents: null,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:spend_missing_for_target_day')
    }
  })

  it('超过绝对硬顶时 trip，且 sticky 为 false', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 7),
      targetSpendCents: CAP + 1,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('trip')
    if (verdict.kind === 'trip') {
      expect(verdict.reason).toBe('circuit:absolute_spend_cap')
      expect(verdict.sticky).toBe(false)
    }
  })

  it('恰好等于绝对硬顶时不熔断（判据是严格大于）', () => {
    // 🔴 历史花费必须取到 CAP/2：中位数 × 3 = 1.5 × CAP > CAP，倍数那条才不会先触发，
    //    这一条才真的在验"硬顶"。原来这里传 points(100, 7) —— 中位数 100、阈值 300，
    //    而 target = CAP = 1_000_000 早就被倍数那条判成 trip 了，
    //    于是这条用例名字写着"硬顶"，实际验的是别的判据（而且结论相反）。
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(CAP / 2, 7),
      targetSpendCents: CAP,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('绝对硬顶超了但只有 2 个非零天时仍 trip（顺序优先于样本量）', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 2),
      targetSpendCents: CAP + 1,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('trip')
    if (verdict.kind === 'trip') {
      expect(verdict.reason).toBe('circuit:absolute_spend_cap')
    }
  })

  it('恰好 4 个非零天时 undeterminable', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 4),
      targetSpendCents: 100,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:not_enough_spend_days')
    }
  })

  it('恰好 5 个非零天时能判（不因样本量 undeterminable）', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 5),
      targetSpendCents: 100,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('花费严格大于中位数 × 3 时 trip', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 5),
      targetSpendCents: 301,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('trip')
    if (verdict.kind === 'trip') {
      expect(verdict.reason).toBe('circuit:spend_spike')
      expect(verdict.sticky).toBe(false)
    }
  })

  it('花费恰好等于中位数 × 3 时不熔断（严格大于）', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 5),
      targetSpendCents: 300,
      absoluteCapCents: CAP,
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('偶数个非零天时中位数取两个中间值的平均', () => {
    // 非零花费 [100, 200, 300, 400] → 中位数 (200 + 300) / 2 = 250
    const previousDays = [point(100, 1), point(200, 2), point(300, 3), point(400, 4)]
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays,
      targetSpendCents: 100,
      absoluteCapCents: CAP,
    })
    // 只有 4 个非零天 → undeterminable，但 evidence 里应带上算出来的中位数
    expect(verdict.kind).toBe('undeterminable')
    expect(verdict.evidence.medianCents).toBe(250)
  })

  it('previousDays 乱序传入结果不变', () => {
    const ordered = [point(100, 1), point(200, 2), point(300, 3), point(400, 4), point(500, 5)]
    const shuffled = [point(300, 3), point(100, 1), point(500, 5), point(200, 2), point(400, 4)]

    const a = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: ordered,
      targetSpendCents: 1000,
      absoluteCapCents: CAP,
    })
    const b = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: shuffled,
      targetSpendCents: 1000,
      absoluteCapCents: CAP,
    })

    expect(a.kind).toBe(b.kind)
    expect(a.evidence.medianCents).toBe(b.evidence.medianCents)
  })

  it('每种结论的 evidence 都带上约定的字段', () => {
    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: points(100, 5),
      targetSpendCents: 100,
      absoluteCapCents: CAP,
    })
    expect(verdict.evidence).toMatchObject({
      targetDate: '2026-09-26',
      targetSpendCents: 100,
      nonZeroDayCount: 5,
      medianCents: 100,
      absoluteCapCents: CAP,
    })
  })

  /**
   * 🔴 这条是变异测出来补的（D8：把 `.filter(spend > 0)` 改成 `>= 0` → 原来一片绿）。
   *
   * 为什么原来抓不住：之前所有用例的历史花费都是**同一个数**，于是"零天算不算进去"
   * 对中位数没有影响 —— 一堆 100 里掺几个 0，中位数还是 100。
   * 测试要能分辨这件事，历史花费必须**分散**，而且零天要多到足以把中位数拉下来。
   *
   * 这里：非零天 [100,200,300,400,500] 中位数 300、阈值 900 → 花 500 不算突刺。
   * 一旦零天被算进样本，[0,0,0,0,100,200,300,400,500] 中位数变 100、阈值 300
   * → 同样花 500 就变成"突刺"。**零花费天会把阈值拉低，于是正常花费被误判成突刺。**
   */
  it('🔴 零花费天不算进中位数样本（掺零会把阈值拉低、误判正常花费）', () => {
    const spread = [point(100, 1), point(200, 2), point(300, 3), point(400, 4), point(500, 5)]
    const withZeros = [...spread, point(0, 6), point(0, 7), point(0, 8), point(0, 9)]

    const verdict = detectSpendSpike({
      targetDate: '2026-09-26',
      previousDays: withZeros,
      targetSpendCents: 500,
      absoluteCapCents: CAP,
    })

    expect(verdict.kind).toBe('no_trip')
    expect(verdict.evidence.nonZeroDayCount).toBe(5)
    expect(verdict.evidence.medianCents).toBe(300)
  })
})

describe('detectDataCompleteness', () => {
  it('row 为 null 时 undeterminable，reason 为 growth_state_missing', () => {
    const verdict = detectDataCompleteness({ targetDate: '2026-09-26', row: null })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:growth_state_missing')
    }
    expect(verdict.evidence).toMatchObject({ targetDate: '2026-09-26', dataCompleteness: null })
  })

  it('dataCompleteness 为 complete 时 no_trip', () => {
    const verdict = detectDataCompleteness({
      targetDate: '2026-09-26',
      row: { dataCompleteness: 'complete' },
    })
    expect(verdict.kind).toBe('no_trip')
    expect(verdict.evidence).toMatchObject({ targetDate: '2026-09-26', dataCompleteness: 'complete' })
  })

  it('dataCompleteness 为 partial 时 undeterminable，reason 为 data_partial', () => {
    const verdict = detectDataCompleteness({
      targetDate: '2026-09-26',
      row: { dataCompleteness: 'partial' },
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:data_partial')
    }
  })

  it('两个 reason 字符串互不相同', () => {
    const missing = detectDataCompleteness({ targetDate: '2026-09-26', row: null })
    const partial = detectDataCompleteness({
      targetDate: '2026-09-26',
      row: { dataCompleteness: 'partial' },
    })
    expect(missing.kind).toBe('undeterminable')
    expect(partial.kind).toBe('undeterminable')
    if (missing.kind === 'undeterminable' && partial.kind === 'undeterminable') {
      expect(missing.reason).not.toBe(partial.reason)
    }
  })

  it('三条分支都不返回 trip', () => {
    const verdicts: DetectorVerdict[] = [
      detectDataCompleteness({ targetDate: '2026-09-26', row: null }),
      detectDataCompleteness({ targetDate: '2026-09-26', row: { dataCompleteness: 'complete' } }),
      detectDataCompleteness({ targetDate: '2026-09-26', row: { dataCompleteness: 'partial' } }),
    ]
    for (const verdict of verdicts) {
      expect(verdict.kind).not.toBe('trip')
    }
  })
})

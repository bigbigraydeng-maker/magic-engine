import { describe, it, expect } from 'vitest'
import {
  detectSpendSpike,
  detectDataCompleteness,
  type DailySpendPoint,
  type DetectorVerdict,
  detectClientSpendOverCap,
  type AccountSpendFact,
  type DetectorConfigSource,
  detectRollbackFailure,
  detectJevLowScoreStreak,
  type RollbackStepRow,
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

/** 客户时区下的「完整前一天」，所有账户都跟它比。 */
const REF = '2026-09-26'

/**
 * 造一个账户花费事实。默认是「数据就是参考日当天、还在投、NZD」——
 * 也就是最普通的健康账户；每条用例只覆盖它要验的那一两个字段。
 */
function account(over: Partial<AccountSpendFact> & { adAccountId: string }): AccountSpendFact {
  return {
    lastCompleteDate: REF,
    spendCents: 0,
    hasDeliveringEntity: true,
    currency: 'NZD',
    ...over,
  }
}

describe('detectClientSpendOverCap - 配置来源', () => {
  it('fallback → facts:config_read_failed', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', spendCents: 100 })],
      capCents: 1000,
      configSource: 'fallback',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:config_read_failed')
    }
  })

  it('default → facts:no_strategy_config', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', spendCents: 100 })],
      capCents: 1000,
      configSource: 'default',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:no_strategy_config')
    }
  })

  it('capCents 为 null → facts:cap_not_configured', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', spendCents: 100 })],
      capCents: null,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:cap_not_configured')
    }
  })

  it('三种配置来源的 reason 互不相同', () => {
    const reasons = new Set<string>()
    const sources: DetectorConfigSource[] = ['fallback', 'default', 'row']
    for (const source of sources) {
      const verdict = detectClientSpendOverCap({
        clientReferenceDate: REF,
        accounts: [account({ adAccountId: 'a1', spendCents: 100 })],
        capCents: source === 'row' ? null : 1000,
        configSource: source,
      })
      expect(verdict.kind).toBe('undeterminable')
      if (verdict.kind === 'undeterminable') {
        reasons.add(verdict.reason)
      }
    }
    expect(reasons.size).toBe(3)
  })
})

describe('detectClientSpendOverCap - 无账户', () => {
  it('没有账户 → no_trip', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('no_trip')
  })
})

describe('detectClientSpendOverCap - 逐账户贡献', () => {
  it('数据是参考日 → 用当天花费', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 500 })],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('no_trip')
    expect(verdict.evidence.totalCents).toBe(500)
  })

  it('没数据 + 没在投 → 贡献 0', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({ adAccountId: 'a1', lastCompleteDate: null, spendCents: null, hasDeliveringEntity: false }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('no_trip')
    expect(verdict.evidence.totalCents).toBe(0)
  })

  it('没数据 + 不知道在不在投 → facts:account_data_missing', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({ adAccountId: 'a1', lastCompleteDate: null, spendCents: null, hasDeliveringEntity: null }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:account_data_missing')
      expect(verdict.evidence.blockedByAccountId).toBe('a1')
    }
  })

  it('数据落后 + 没在投 → 贡献 0，仍然能判出结论', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 500 }),
        account({
          adAccountId: 'a2',
          lastCompleteDate: '2026-09-20',
          spendCents: 999,
          hasDeliveringEntity: false,
        }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('no_trip')
    expect(verdict.evidence.totalCents).toBe(500)
    const perAccount = verdict.evidence.perAccount as { adAccountId: string; contributedCents: number }[]
    expect(perAccount.find((p) => p.adAccountId === 'a2')?.contributedCents).toBe(0)
  })

  it('数据落后 + 在投 → facts:account_data_stale，blockedByAccountId 是它', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 500 }),
        account({
          adAccountId: 'a2',
          lastCompleteDate: '2026-09-20',
          spendCents: 999,
          hasDeliveringEntity: true,
        }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:account_data_stale')
      expect(verdict.evidence.blockedByAccountId).toBe('a2')
    }
  })

  it('数据落后 + 快照拿不到 → facts:snapshot_unavailable', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({
          adAccountId: 'a1',
          lastCompleteDate: '2026-09-20',
          spendCents: 999,
          hasDeliveringEntity: null,
        }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:snapshot_unavailable')
    }
  })

  it('数据比参考日还新 → facts:account_date_ahead', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: '2026-09-27', spendCents: 100 })],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:account_date_ahead')
    }
  })
})

describe('detectClientSpendOverCap - 币种闸', () => {
  it('贡献 0 的账户 currency 为 null → 不触发币种闸', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 500, currency: 'NZD' }),
        account({
          adAccountId: 'a2',
          lastCompleteDate: '2026-09-20',
          spendCents: 999,
          hasDeliveringEntity: false,
          currency: null,
        }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('贡献 > 0 的两个账户币种不同 → facts:currency_mismatch', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [
        account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 500, currency: 'NZD' }),
        account({ adAccountId: 'a2', lastCompleteDate: REF, spendCents: 500, currency: 'AUD' }),
      ],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:currency_mismatch')
    }
  })

  it('贡献 > 0 的账户 currency 为 null → facts:currency_unknown', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 500, currency: null })],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('undeterminable')
    if (verdict.kind === 'undeterminable') {
      expect(verdict.reason).toBe('facts:currency_unknown')
    }
  })
})

describe('detectClientSpendOverCap - 比上限', () => {
  it('合计恰好等于 capCents × 1.2 → 不熔断（严格大于）', () => {
    // capCents = 1000 → 阈值 1200，合计 1200 不熔断
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 1200 })],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('合计比 capCents × 1.2 多 1 分 → 熔断', () => {
    const verdict = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 1201 })],
      capCents: 1000,
      configSource: 'row',
    })
    expect(verdict.kind).toBe('trip')
    if (verdict.kind === 'trip') {
      expect(verdict.reason).toBe('circuit:client_daily_cap_exceeded')
      expect(verdict.sticky).toBe(false)
    }
  })

  it('capCents 取会产生浮点误差的值（10007）时判据不误判', () => {
    // 10007 * 1.2 = 12008.4（浮点），阈值应严格为 12008.4，合计 12008 不熔断、12009 熔断
    const below = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 12008 })],
      capCents: 10007,
      configSource: 'row',
    })
    expect(below.kind).toBe('no_trip')

    const above = detectClientSpendOverCap({
      clientReferenceDate: REF,
      accounts: [account({ adAccountId: 'a1', lastCompleteDate: REF, spendCents: 12009 })],
      capCents: 10007,
      configSource: 'row',
    })
    expect(above.kind).toBe('trip')
  })
})

/** 造一条撤回步骤行。默认 succeeded，测试里按需覆盖。 */
function makeStep(overrides: Partial<RollbackStepRow> & { runId: string }): RollbackStepRow {
  return {
    runId: overrides.runId,
    status: overrides.status ?? 'succeeded',
    lastError: overrides.lastError ?? null,
  }
}

/** evidence 里允许出现的键，恰好这三个——多一个都说明原始行漏进来了。 */
const EXPECTED_EVIDENCE_KEYS = ['failedRunIds', 'totalStepCount', 'firstFailedError']

describe('detectRollbackFailure', () => {
  it('空数组 → no_trip（这批没有撤回步骤是正常状态）', () => {
    const verdict = detectRollbackFailure({ rollbackSteps: [] })
    expect(verdict.kind).toBe('no_trip')
  })

  it('全是 succeeded → no_trip', () => {
    const verdict = detectRollbackFailure({
      rollbackSteps: [
        makeStep({ runId: 'run-1', status: 'succeeded' }),
        makeStep({ runId: 'run-2', status: 'succeeded' }),
      ],
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('一条 failed → trip 且 sticky 为 true', () => {
    const verdict = detectRollbackFailure({
      rollbackSteps: [makeStep({ runId: 'run-1', status: 'failed', lastError: 'boom' })],
    })
    expect(verdict.kind).toBe('trip')
    if (verdict.kind !== 'trip') {
      throw new Error('expected trip')
    }
    // 撤回失败是 v1 里唯一不可逆的信号，必须 sticky，否则一天后系统自己接着动手。
    expect(verdict.sticky).toBe(true)
  })

  it('多条 failed → reason 用第一条的 runId，evidence.failedRunIds 含全部', () => {
    const verdict = detectRollbackFailure({
      rollbackSteps: [
        makeStep({ runId: 'run-1', status: 'succeeded' }),
        makeStep({ runId: 'run-2', status: 'failed', lastError: 'first' }),
        makeStep({ runId: 'run-3', status: 'failed', lastError: 'second' }),
      ],
    })
    expect(verdict.kind).toBe('trip')
    if (verdict.kind !== 'trip') {
      throw new Error('expected trip')
    }
    expect(verdict.reason).toBe('circuit:rollback_failed:run-2')
    expect(verdict.evidence.failedRunIds).toEqual(['run-2', 'run-3'])
  })

  it('status 是 dead_letter / pending 这些非 failed 的值 → no_trip', () => {
    const verdict = detectRollbackFailure({
      rollbackSteps: [
        makeStep({ runId: 'run-1', status: 'dead_letter' }),
        makeStep({ runId: 'run-2', status: 'pending' }),
      ],
    })
    expect(verdict.kind).toBe('no_trip')
  })

  it('lastError 为 null 时 evidence.firstFailedError 是 null', () => {
    const verdict = detectRollbackFailure({
      rollbackSteps: [makeStep({ runId: 'run-1', status: 'failed', lastError: null })],
    })
    expect(verdict.kind).toBe('trip')
    expect(verdict.evidence.firstFailedError).toBeNull()
  })

  it('evidence 里不含原始步骤数组，键恰好是那三个', () => {
    const verdict = detectRollbackFailure({
      rollbackSteps: [
        makeStep({ runId: 'run-1', status: 'failed', lastError: 'boom' }),
        makeStep({ runId: 'run-2', status: 'succeeded' }),
      ],
    })
    expect(Object.keys(verdict.evidence).sort()).toEqual([...EXPECTED_EVIDENCE_KEYS].sort())
  })
})

describe('detectJevLowScoreStreak', () => {
  it('打桩返回 undeterminable，且明确不是 no_trip', () => {
    const verdict = detectJevLowScoreStreak()
    expect(verdict.kind).toBe('undeterminable')
    // no_trip 是在说"查过了、没问题"，而真实情况是"压根没查"，两者意思相反。
    expect(verdict.kind).not.toBe('no_trip')
  })
})

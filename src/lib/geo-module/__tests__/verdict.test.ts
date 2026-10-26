/**
 * #1347 · GEO 验证判定层（IMPACT Check 段）。
 *
 * 覆盖四道 fail-closed 闸 + 两个判据空隙 + 整数比率（防浮点陷阱）+ 「永不误判 failure」硬约束。
 */
import { describe, it, expect } from 'vitest'
import { evaluateQualifiedMentionVerdict, type GeoVerificationSide } from '../verdict'
import { GEO_M1_RULE_VERSION } from '../types'
import type { GeoCoverageSummary } from '../types'
import type { GeoComparabilityCohortInput } from '@/lib/geo-measurement'

const K = <T,>(value: T) => ({ known: true, value }) as const

/** 采集身份 —— 每个字段都是 GeoMaybeUnknown 包装，不是裸值。 */
function acquisition(overrides: Record<string, unknown> = {}) {
  return {
    querySetVersion: K('cts_geo_baseline_v1'),
    queryKey: K('brand_01'),
    engineFamily: K('openai'),
    modelVersion: K('gpt-5-search-api-2025-10-14'),
    locale: K('en-NZ'),
    market: K('nz'),
    sample: {
      samplePlan: K({ plannedCount: 1 }),
      sampleIndex: K(0),
      samplingParameters: K({}),
    },
    ...overrides,
  }
}

/** 一份可比的 cohort 身份（质量三项都过 v1 冻结阈值：conf≥0.8 / 覆盖≥0.8 / 失败率≤0.2）。 */
function cohort(overrides: Record<string, unknown> = {}): GeoComparabilityCohortInput {
  return {
    acquisition: acquisition(),
    interpretation: {
      parserVersion: K('geo-baseline/parser/v1'),
      metricRulesVersion: K('geo-baseline/rules/v1'),
    },
    confidence: K(1),
    engineCoverage: K(1),
    failureRate: K(0),
    ...overrides,
  } as unknown as GeoComparabilityCohortInput
}

/** 一份覆盖账。只填判定用得上的字段，其余给中性值。 */
function coverage(
  interpretableQueries: number,
  qualifiedMentionQueries: number,
  explicitPositiveQueries: number,
  ruleVersion: string = GEO_M1_RULE_VERSION,
  queryCount: number = interpretableQueries,
): GeoCoverageSummary {
  return {
    ruleVersion,
    queryCount,
    interpretableQueries,
    qualifiedMentionQueries,
    explicitPositiveQueries,
    conditionalQueries: 0,
    fullyDeferredQueries: queryCount - interpretableQueries,
    perQuery: [],
  } as unknown as GeoCoverageSummary
}

/**
 * 一侧输入。cohorts 是**每条成功观测一份**的数组（与平台 buildComparabilityInputs 同形状）。
 * 默认按 interpretable 条数生成，queryKey 逐条不同，模拟真实批次。
 */
function side(
  interpretable: number,
  mention: number,
  explicitPositive: number,
  cohortOverrides: Record<string, unknown> = {},
  ruleVersion?: string,
  queryCount?: number,
  cohortCount?: number,
): GeoVerificationSide {
  // 🔴 helper 自保：interpretable 可能是 Infinity/NaN（闸 0 的测试输入），
  //    直接拿去 Array.from({length}) 会炸。cohorts 数量与被测判据无关，钳到合理范围。
  const rawN = cohortCount ?? interpretable
  const n = Number.isInteger(rawN) && rawN > 0 ? Math.min(rawN, 64) : 1
  return {
    coverage: coverage(interpretable, mention, explicitPositive, ruleVersion, queryCount),
    cohorts: Array.from({ length: n }, (_, i) =>
      cohort({
        acquisition: acquisition({ queryKey: K(`q${i}`) }),
        ...cohortOverrides,
      }),
    ),
  }
}

describe('闸 1 · 解释身份（规则版本）不一致 → indeterminate', () => {
  it('两侧 ruleVersion 不同 → 不比数字，直接 indeterminate', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 17, 5, {}, 'geo-module/m1/v2'),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toEqual(['rule_version_mismatch'])
  })
})

describe('闸 2 · 测量层判不可比 → indeterminate（永不 failure）', () => {
  it('查询集版本不同 → indeterminate，并透传 mismatch', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, undefined, 1),
      followUp: side(18, 5, 1, {
        acquisition: acquisition({ querySetVersion: K('cts_geo_baseline_v2'), queryKey: K('q0') }), // ← 换了查询集
      }, undefined, undefined, 1),
    })
    // 覆盖率从 13/18 掉到 5/18 —— 但不可比，**绝不允许**判 failure。
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
    expect(r.comparabilityMismatches?.length ?? 0).toBeGreaterThan(0)
  })

  it('locale 不同 → indeterminate', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, undefined, 1),
      followUp: side(18, 16, 4, {
        acquisition: acquisition({ locale: K('en-AU'), queryKey: K('q0') }), // ← 换了 locale
      }, undefined, undefined, 1),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
  })

  it('质量阈值不过（失败率超上限）→ indeterminate', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, undefined, 1),
      followUp: side(18, 16, 4, { failureRate: K(0.5) }, undefined, undefined, 1),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
  })
})

describe('闸 3 · 证据不足（分母为 0）→ indeterminate，绝不当成覆盖率 0', () => {
  it('基线可解释 query = 0 → insufficient_baseline_evidence', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(0, 0, 0),
      followUp: side(18, 13, 3),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('insufficient_baseline_evidence')
    expect(r.measured.baselineMention).toEqual({ known: false, reason: 'no_interpretable_queries' })
  })

  it('复测可解释 query = 0 → insufficient_followup_evidence，不判 failure', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(0, 0, 0),
    })
    // 复测什么都没测出来 ≠ 覆盖掉到 0。绝不能判 failure。
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('insufficient_followup_evidence')
  })

  it('两侧都为 0 → 两个原因码都出，去重后不重复', () => {
    const r = evaluateQualifiedMentionVerdict({ baseline: side(0, 0, 0), followUp: side(0, 0, 0) })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toEqual([
      'insufficient_baseline_evidence',
      'insufficient_followup_evidence',
    ])
  })
})

describe('闸 4 · 正常判定', () => {
  it('提及覆盖上升 + explicit_positive 不降 → success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 3),
    })
    expect(r.verdict).toBe('success')
    expect(r.reasonCodes).toEqual(['mention_coverage_increased', 'explicit_positive_not_decreased'])
  })

  it('提及覆盖上升 + explicit_positive 也升 → success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 5),
    })
    expect(r.verdict).toBe('success')
  })

  it('提及覆盖明确下降（两侧可比、证据充足）→ failure', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 9, 3),
    })
    expect(r.verdict).toBe('failure')
    // 🔴 failure 也要带 EP 方向（魏征 A1）：审计要看得到 failure 时 EP 是什么情况
    expect(r.reasonCodes).toEqual(['mention_coverage_decreased', 'explicit_positive_not_decreased'])
  })

  it('分母小幅变化时按比率比，不按绝对数（12/18 → 11/16 应判上升）', () => {
    // 绝对数 12 → 11 是「掉了」，但比率 0.667 → 0.6875 是「涨了」。必须按比率。
    // 分母 16/18 = 0.889 > 0.8 收缩下限，不触发闸 3。
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 12, 3, {}, undefined, 18),
      followUp: side(16, 11, 3, {}, undefined, 18),
    })
    expect(r.verdict).toBe('success')
    expect(r.reasonCodes).toEqual(['mention_coverage_increased', 'explicit_positive_not_decreased'])
  })
})

describe('闸 3 · 分母收缩（华佗实测的「退步判成成功」攻击）', () => {
  it('复测分母缩到基线 2/3（18→12）→ denominator_shrunk，不许判 success', () => {
    // 华佗原始攻击：基线 13/18(72.2%) vs 复测 10/12(83.3%) 比率在涨，
    // 但被提及的绝对数 13→10 其实在掉 —— 6 个 query 变 defer 把分母缩了。
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, 18),
      followUp: side(12, 10, 3, {}, undefined, 18),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('denominator_shrunk')
  })

  it('极端版：17/18 数据丢失（复测只剩 1/1 满分）→ 绝不判 success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, 18),
      followUp: side(1, 1, 1, {}, undefined, 18),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('denominator_shrunk')
  })

  it('分母恰好在下限上（18 → 15，15/18 = 0.833 > 0.8）→ 放行，正常判定', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 12, 3, {}, undefined, 18),
      followUp: side(15, 12, 3, {}, undefined, 18),
    })
    expect(r.verdict).toBe('success') // 12/18=0.667 → 12/15=0.8 上升
    expect(r.reasonCodes).not.toContain('denominator_shrunk')
  })

  it('分母涨了（更多 query 可解释）→ 不触发收缩闸', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(12, 8, 2, {}, undefined, 18),
      followUp: side(18, 13, 3, {}, undefined, 18),
    })
    expect(r.reasonCodes).not.toContain('denominator_shrunk')
  })

  it('样本量账被报出来 —— 覆盖率永远配样本量读（finding.ts 先例）', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, 18),
      followUp: side(12, 10, 3, {}, undefined, 18),
    })
    expect(r.sample.baseline).toEqual({ queryCount: 18, interpretableQueries: 18, fullyDeferredQueries: 0 })
    expect(r.sample.followUp).toEqual({ queryCount: 18, interpretableQueries: 12, fullyDeferredQueries: 6 })
  })
})

describe('闸 0 · 不信任输入（魏征实测：负数分子曾直接落 failure）', () => {
  it.each([
    ['分子为负', 18, -5, 3],
    ['分子 > 分母', 18, 20, 3],
    ['EP > 分母', 18, 13, 20],
    ['分母非整数', 17.5, 13, 3],
    ['分母 Infinity', Infinity, 13, 3],
    ['分母 NaN', NaN, 13, 3],
    ['分子 NaN', 18, NaN, 3],
  ])('%s → malformed_coverage_input，绝不判 failure/success', (_, den, mention, ep) => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, 18),
      followUp: side(den, mention, ep, {}, undefined, Math.max(18, Number.isFinite(den) ? den : 18)),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toEqual(['malformed_coverage_input'])
  })
})

describe('凭据口径 · measured 的分母必须是 interpretableQueries（补 W1 漏网）', () => {
  it('有 defer 时 measured 报的是可解释数，不是 query 总数', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, 18),
      followUp: side(15, 12, 3, {}, undefined, 18),
    })
    // followUp: 总数 18、可解释 15。measured 分母必须是 15。
    expect(r.measured.followUpMention).toEqual({ known: true, numerator: 12, denominator: 15 })
    expect(r.measured.followUpExplicitPositive).toEqual({ known: true, numerator: 3, denominator: 15 })
    // 同一份输出里，sample 才报总数
    expect(r.sample.followUp.queryCount).toBe(18)
  })
})

describe('cohorts 必须逐条比，不能只比第一条（补 cohorts 漏网）', () => {
  it('只有第 3 条 cohort 的模型版本不同 → 仍须判 not_comparable', () => {
    const baselineSide = side(18, 13, 3, {}, undefined, 18, 5)
    // 复测：前两条身份一致，第 3 条换了模型版本
    const followUpSide: typeof baselineSide = {
      coverage: baselineSide.coverage,
      cohorts: baselineSide.cohorts.map((c, i) =>
        i === 2
          ? cohort({ acquisition: acquisition({ queryKey: K('q2'), modelVersion: K('gpt-5-OTHER') }) })
          : c,
      ),
    }
    const r = evaluateQualifiedMentionVerdict({ baseline: baselineSide, followUp: followUpSide })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
  })

  it('mismatch 的 left 恒指 baseline（传参顺序锁住，审计不能归错侧）', () => {
    // 只让 baseline 侧质量不合格（失败率超上限），mismatch 必须报在 left
    const bad = side(18, 13, 3, { failureRate: K(0.9) }, undefined, 18, 3)
    const good = side(18, 13, 3, {}, undefined, 18, 3)
    const r = evaluateQualifiedMentionVerdict({ baseline: bad, followUp: good })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('not_comparable')
    const dims = (r.comparabilityMismatches ?? []).map((m) => m.dimension)
    expect(dims.some((d) => String(d).startsWith('left.'))).toBe(true)
    expect(dims.some((d) => String(d).startsWith('right.'))).toBe(false)
  })
})

describe('魏征 M3 · queryCount 与 interpretableQueries 必须区分（Codex #1032 P1 语义）', () => {
  it('分母误用 queryCount 会判 failure，用 interpretableQueries 才判 success', () => {
    // 基线 13/18(可解释18)；复测 mention=11、可解释=15、总数仍 18（3 个 defer）。
    // 正确（用 interpretable）：13/18=0.722 → 11/15=0.733 上升 → success
    // 错误（用 queryCount）：13/18=0.722 → 11/18=0.611 下降 → failure
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3, {}, undefined, 18),
      followUp: side(15, 11, 3, {}, undefined, 18),
    })
    expect(r.verdict).toBe('success')
    expect(r.sample.followUp.queryCount).toBe(18)
    expect(r.sample.followUp.interpretableQueries).toBe(15)
    expect(r.sample.followUp.fullyDeferredQueries).toBe(3)
  })
})

describe('判据空隙的保守填充（本层判断，非判据原文）', () => {
  it('空隙①：提及覆盖持平 → indeterminate（既非上升也非明确下降）', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 13, 3),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('空隙①变体：比率持平但分母不同（13/18 vs 26/36）→ 仍判持平', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(36, 26, 6),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('空隙②：提及涨了但 explicit_positive 跌了 → indeterminate，不判 failure 也不判 success', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 5),
      followUp: side(18, 16, 2),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_increased')
    expect(r.reasonCodes).toContain('explicit_positive_decreased')
  })

  it('持平 + explicit_positive 跌 → indeterminate，两个码都带上', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 5),
      followUp: side(18, 13, 2),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
    expect(r.reasonCodes).toContain('explicit_positive_decreased')
  })
})

/**
 * 🔴 本组测的是**比率等价性**，不是「防浮点陷阱」。
 *    变异验证实测：把实现换成浮点除法，本组全部仍绿 —— 在 query 数 < 400 的范围内
 *    两种实现等价（穷举验证过）。保留本组是为了钉住「按比率比、不按绝对数比」这条语义，
 *    不是为了证明整数实现修了什么 bug。
 */
describe('比率等价性（分母不同也要比对）', () => {
  it('1/3 vs 2/6 判持平', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(3, 1, 0),
      followUp: side(6, 2, 0),
    })
    expect(r.verdict).toBe('indeterminate')
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('7/9 vs 70/90 判持平', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(9, 7, 0),
      followUp: side(90, 70, 0),
    })
    expect(r.reasonCodes).toContain('mention_coverage_unchanged')
  })

  it('相邻比率也能分出来：13/18 vs 14/19（≈0.7222 vs ≈0.7368）→ 上升', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 0),
      followUp: side(19, 14, 0),
    })
    expect(r.verdict).toBe('success')
  })
})

describe('输出契约', () => {
  it('metricRef 与冻结判据同一把尺子', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 3),
    })
    expect(r.metricRef).toBe(`${GEO_M1_RULE_VERSION}:qualified_mention_coverage`)
  })

  it('measured 带回两侧原始分子分母，不藏计算过程', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(20, 17, 4),
    })
    expect(r.measured.baselineMention).toEqual({ known: true, numerator: 13, denominator: 18 })
    expect(r.measured.followUpMention).toEqual({ known: true, numerator: 17, denominator: 20 })
    expect(r.measured.baselineExplicitPositive).toEqual({ known: true, numerator: 3, denominator: 18 })
    expect(r.measured.followUpExplicitPositive).toEqual({ known: true, numerator: 4, denominator: 20 })
  })

  it('可比时不带 comparabilityMismatches 字段', () => {
    const r = evaluateQualifiedMentionVerdict({
      baseline: side(18, 13, 3),
      followUp: side(18, 16, 3),
    })
    expect(r.comparabilityMismatches).toBeUndefined()
  })
})

describe('硬约束：永不误判 failure', () => {
  it('所有 indeterminate 路径下，即使覆盖大幅下降也绝不落 failure', () => {
    const bigDrop = { interpretable: 18, mention: 1, explicitPositive: 0 }
    const cases = [
      // 规则版本不同
      {
        baseline: side(18, 17, 5),
        followUp: side(bigDrop.interpretable, bigDrop.mention, bigDrop.explicitPositive, {}, 'geo-module/m1/v2'),
      },
      // 不可比（换查询集）
      {
        baseline: side(18, 17, 5, {}, undefined, undefined, 1),
        followUp: side(bigDrop.interpretable, bigDrop.mention, bigDrop.explicitPositive, {
          acquisition: acquisition({ querySetVersion: K('other_set'), queryKey: K('q0') }),
        }, undefined, undefined, 1),
      },
      // 复测证据不足
      { baseline: side(18, 17, 5), followUp: side(0, 0, 0) },
    ]
    for (const c of cases) {
      expect(evaluateQualifiedMentionVerdict(c).verdict).not.toBe('failure')
    }
  })
})

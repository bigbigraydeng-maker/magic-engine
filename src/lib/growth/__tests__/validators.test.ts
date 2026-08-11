/**
 * Growth Module 契约校验器 —— 冻结不变量的守卫（Issue #877 / WP01）
 *
 * 每一条断言都指向 WP00 契约冻结 v1.0 里的一条红线，不是为了凑数量。
 */

import { describe, it, expect } from 'vitest'
import {
  validateGrowthEvidence,
  validateGrowthFinding,
  validateGrowthPrescription,
  validateGrowthActionCandidate,
  validateGrowthVerificationDefinition,
} from '../validators'
import type {
  GrowthActionCandidate,
  GrowthActionCandidateIdentity,
  GrowthEvidence,
  GrowthFinding,
  GrowthPrescription,
  GrowthVerificationDefinition,
} from '../types'

// ── 合法样本（就地构造，不建共享 fixture 文件）────────────────────────────────

const evidence = (): GrowthEvidence => ({
  source: { kind: 'ai_visibility_snapshot', sourceId: 'snap-1' },
  observedAt: '2026-08-10T01:00:00.000Z',
  rawLocator: { known: true, value: 'ai_visibility_snapshots/snap-1#raw_response' },
  interpretation: { known: true, value: { parserVersion: 'geo-parser@2026-08-01' } },
  confidence: { known: true, value: 0.82 },
})

const finding = (): GrowthFinding => ({
  pillar: 'ai_visibility',
  severity: 'high',
  statement: '品牌在 AU 市场的对比类问句里没有被作为可选项给出',
  evidence: [evidence()],
})

const verification = (): GrowthVerificationDefinition => ({
  metricRef: 'geo.qualified_mention_rate',
  windowDays: 28,
  baseline: '干预前最近一个同队列批次的合格提及率',
  criteria: {
    success: '同队列合格提及率相对基线提升 ≥ 5 个百分点',
    failure: '同队列合格提及率相对基线下降',
    indeterminate: '两侧采集身份或解释身份对不上，或引擎覆盖率低于阈值',
  },
})

const candidate = (): GrowthActionCandidate => ({
  identity: { domain: 'geo', intent: 'optimize_page_answerability' },
  input: { pageRef: 'canonical:home', intents: ['add_faq_block'] },
  basis: [finding()],
  expectedImpact: 'medium',
  cost: { spendsMoney: true, ceilingUsd: { known: true, value: 2.5 } },
  verification: verification(),
})

const prescription = (): GrowthPrescription => ({
  goalId: { known: false, reason: 'not_recorded_by_source' },
  covers: [finding()],
  notDoing: [{ statement: '本轮不动价格页', reason: '价格属于客户红线，不由平台改' }],
  orderingRationale: '先补答案可见度，广告等基线稳定后再谈',
})

/** 把一个合法样本改坏一处。 */
const mutate = <T>(base: T, patch: Record<string, unknown>): unknown => ({ ...base, ...patch })

// ── Evidence ─────────────────────────────────────────────────────────────────

describe('validateGrowthEvidence', () => {
  it('完整的一条证据通过', () => {
    expect(validateGrowthEvidence(evidence())).toEqual({ ok: true })
  })

  it('三项都「不知道」但写了理由码，同样通过 —— 不知道是合法状态', () => {
    expect(
      validateGrowthEvidence(
        mutate(evidence(), {
          rawLocator: { known: false, reason: 'not_recorded_by_source' },
          interpretation: { known: false, reason: 'not_applicable' },
          confidence: { known: false, reason: 'not_recorded_by_source' },
        }),
      ),
    ).toEqual({ ok: true })
  })

  // 🔴 WP00 §4 / §6 / §14.2 #14：省略会让下游把「不知道」读成「一样」，补 0 会读成「一次都没有」。
  it.each([
    ['字段整个省略', { rawLocator: undefined }],
    ['写成 null', { rawLocator: null }],
    ['known 不是布尔字面量', { rawLocator: { known: 'yes', value: 'x' } }],
    ['未知理由码没登记', { confidence: { known: false, reason: 'whatever' } }],
    ['来源 kind 为空', { source: { kind: '', sourceId: 'snap-1' } }],
    ['来源 sourceId 为空', { source: { kind: 'x', sourceId: '   ' } }],
    ['观测时刻解析不了', { observedAt: 'last tuesday' }],
    ['置信度超出 0–1', { confidence: { known: true, value: 1.5 } }],
    ['解释身份缺 parserVersion', { interpretation: { known: true, value: {} } }],
  ])('被拒：%s', (_label, patch) => {
    expect(validateGrowthEvidence(mutate(evidence(), patch)).ok).toBe(false)
  })

  it('校验器不改动传入对象', () => {
    const input = evidence()
    const before = JSON.stringify(input)
    validateGrowthEvidence(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})

// ── Finding ──────────────────────────────────────────────────────────────────

describe('validateGrowthFinding', () => {
  it('带一条证据的发现通过', () => {
    expect(validateGrowthFinding(finding())).toEqual({ ok: true })
  })

  // 🔴 WP00 §5.2 红线 —— 这是 ME2 相对既有 DiagnosticFinding 收紧的那一条。
  it.each([
    ['证据数组为空', []],
    ['证据字段缺失', undefined],
  ])('没有证据支撑的发现不许存在：%s', (_label, ev) => {
    expect(validateGrowthFinding(mutate(finding(), { evidence: ev })).ok).toBe(false)
  })

  it('嵌套的坏证据会带着路径被拒', () => {
    const result = validateGrowthFinding(
      mutate(finding(), { evidence: [mutate(evidence(), { observedAt: 'nope' })] }),
    )
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain('evidence[0]')
  })

  it.each([
    ['支柱不在六维里', { pillar: 'website' }],
    ['严重度没登记', { severity: 'catastrophic' }],
    ['陈述是空白', { statement: '   ' }],
  ])('被拒：%s', (_label, patch) => {
    expect(validateGrowthFinding(mutate(finding(), patch)).ok).toBe(false)
  })
})

// ── Prescription ─────────────────────────────────────────────────────────────

describe('validateGrowthPrescription', () => {
  it('目标未知（客户还没建 Goal）依然是合法处方', () => {
    expect(validateGrowthPrescription(prescription())).toEqual({ ok: true })
  })

  it('「刻意不做」可以是空数组', () => {
    expect(validateGrowthPrescription(mutate(prescription(), { notDoing: [] }))).toEqual({ ok: true })
  })

  // 🔴 WP00 §5.3：做成可选字段就等于永远没人填。
  it('「刻意不做」整个省略 → 拒绝', () => {
    expect(validateGrowthPrescription(mutate(prescription(), { notDoing: undefined })).ok).toBe(false)
  })

  it.each([
    ['覆盖的发现为空', { covers: [] }],
    ['不做的条目缺理由', { notDoing: [{ statement: '不动价格页' }] }],
    ['排序理由为空', { orderingRationale: '' }],
    ['目标写成裸字符串而非显式已知/未知', { goalId: 'goal-1' }],
  ])('被拒：%s', (_label, patch) => {
    expect(validateGrowthPrescription(mutate(prescription(), patch)).ok).toBe(false)
  })
})

// ── VerificationDefinition ───────────────────────────────────────────────────

describe('validateGrowthVerificationDefinition', () => {
  it('三档判据齐全的定义通过', () => {
    expect(validateGrowthVerificationDefinition(verification())).toEqual({ ok: true })
  })

  it('指标引用不绑定既有 flywheel 词汇表 —— 任何非空引用都收', () => {
    expect(
      validateGrowthVerificationDefinition(
        mutate(verification(), { metricRef: 'measurement.owned_domain_citation_rate' }),
      ),
    ).toEqual({ ok: true })
  })

  // 🔴 WP00 §5.5：只有成功和失败两档，会逼系统在证据不足时编一个答案。
  it('缺「无法判定」这一档 → 拒绝', () => {
    const { indeterminate, ...twoWay } = verification().criteria
    void indeterminate
    expect(validateGrowthVerificationDefinition(mutate(verification(), { criteria: twoWay })).ok).toBe(false)
  })

  it.each([
    ['窗口为 0', { windowDays: 0 }],
    ['窗口不是整数', { windowDays: 7.5 }],
    ['指标引用为空', { metricRef: '' }],
    ['对照为空', { baseline: '' }],
    ['判据不是对象', { criteria: 'looks good' }],
  ])('被拒：%s', (_label, patch) => {
    expect(validateGrowthVerificationDefinition(mutate(verification(), patch)).ok).toBe(false)
  })
})

// ── ActionCandidate ──────────────────────────────────────────────────────────

describe('validateGrowthActionCandidate', () => {
  it('完整的候选通过', () => {
    expect(validateGrowthActionCandidate(candidate())).toEqual({ ok: true })
  })

  // 🔴 WP00 §5.4 红线 1 + §8.2：候选不带授权，多出来的顶层字段一律拒绝而不是忽略。
  //    用白名单不用黑名单 —— 本仓是 AU/NZ 拼写，`authorised` 能从黑名单底下穿过去。
  it.each([['authorised'], ['sideEffect']])('夹带 %s → 拒绝（不是忽略）', (key) => {
    const result = validateGrowthActionCandidate(mutate(candidate(), { [key]: 'anything' }))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain(key)
  })

  // 🔴 WP00 §8.3 第 3 条冻结的是「不能是一段自由文本」，命名规范归 K-WP02。
  it.each([
    ['写成一个字符串', 'seo.build_publish_package'],
    ['某一段为空', { domain: 'geo', intent: '' }],
  ])('候选身份必须是两段非空的结构体：%s → 拒绝', (_label, identity) => {
    expect(validateGrowthActionCandidate(mutate(candidate(), { identity })).ok).toBe(false)
  })

  it('长意图名不再被误拒 —— 长度不是 WP01 的判据', () => {
    expect(
      validateGrowthActionCandidate(
        mutate(candidate(), {
          identity: { domain: 'geo', intent: 'optimize_page_answerability_for_comparison_queries' },
        }),
      ),
    ).toEqual({ ok: true })
  })

  // 🔴 WP00 §8.4 / GEO 契约 §7.1：说不出成本上界的付费步骤一律 fail closed。
  it('会花钱却说不出上界 → 拒绝', () => {
    expect(
      validateGrowthActionCandidate(
        mutate(candidate(), {
          cost: { spendsMoney: true, ceilingUsd: { known: false, reason: 'not_recorded_by_source' } },
        }),
      ).ok,
    ).toBe(false)
  })

  it('不花钱时上界未知是合法的', () => {
    expect(
      validateGrowthActionCandidate(
        mutate(candidate(), {
          cost: { spendsMoney: false, ceilingUsd: { known: false, reason: 'not_applicable' } },
        }),
      ),
    ).toEqual({ ok: true })
  })

  it.each([
    ['依据的发现为空', { basis: [] }],
    ['预期影响没登记', { expectedImpact: 'huge' }],
    ['缺验证定义', { verification: undefined }],
    ['验证定义本身不合法', { verification: { metricRef: 'x' } }],
  ])('被拒：%s', (_label, patch) => {
    expect(validateGrowthActionCandidate(mutate(candidate(), patch)).ok).toBe(false)
  })
})

// ── provider 中立输入必须真的是 JSON 值 ──────────────────────────────────────

describe('ActionCandidate.input 的 JSON 值检查', () => {
  it('嵌套的对象 / 数组 / null / 数字 / 布尔全部放行', () => {
    expect(
      validateGrowthActionCandidate(
        mutate(candidate(), {
          input: { a: { b: [1, 'x', true, null, { c: 0 }] }, d: -1.5 },
        }),
      ),
    ).toEqual({ ok: true })
  })

  // 🔴 这些都能过 TypeScript 之外的入口混进来，然后在落 jsonb 时静默变形或直接抛异常。
  it.each([
    ['undefined 值', { a: undefined }],
    ['函数', { a: () => 1 }],
    ['symbol', { a: Symbol('x') }],
    // 用 BigInt() 而不是 10n 字面量 —— 本仓 tsconfig 没设 target，字面量语法过不了 tsc
    ['bigint', { a: BigInt(10) }],
    ['Date（非普通对象）', { a: new Date() }],
    ['Map（非普通对象）', { a: new Map() }],
    ['NaN', { a: Number.NaN }],
    ['Infinity', { a: Number.POSITIVE_INFINITY }],
    ['深层嵌套里的 undefined', { a: { b: [{ c: undefined }] } }],
  ])('被拒：%s', (_label, input) => {
    expect(validateGrowthActionCandidate(mutate(candidate(), { input })).ok).toBe(false)
  })

  it('循环引用被拒，且不会栈溢出', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(validateGrowthActionCandidate(mutate(candidate(), { input: cyclic })).ok).toBe(false)
  })

  it('同一个对象被引用两次（不是环）仍然放行', () => {
    const shared = { k: 'v' }
    expect(
      validateGrowthActionCandidate(mutate(candidate(), { input: { a: shared, b: shared } })),
    ).toEqual({ ok: true })
  })

  it('顶层是数组 → 拒绝', () => {
    expect(validateGrowthActionCandidate(mutate(candidate(), { input: ['not', 'an', 'object'] })).ok).toBe(false)
  })

  // 🔴 下面这几种都能过 `Array.prototype.every` / `Object.values`，
  //    但 JSON 序列化会把它们悄悄改掉或丢掉 —— 实测见 validators.ts 的判据表。
  const rejectsInput = (input: unknown): boolean =>
    validateGrowthActionCandidate(mutate(candidate(), { input })).ok === false

  it('稀疏数组被拒 —— 空洞在序列化后会变成 null', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(rejectsInput({ a: [1, , 3] })).toBe(true)
    expect(JSON.stringify({ a: [1, , 3] })).toBe('{"a":[1,null,3]}')
  })

  it('数组上挂了额外的字符串属性 → 拒绝（序列化时会丢）', () => {
    const withExtra: unknown[] = ['a']
    ;(withExtra as unknown as Record<string, unknown>).foo = 'x'
    expect(rejectsInput({ a: withExtra })).toBe(true)
  })

  it('symbol 键 → 拒绝（序列化时会丢）', () => {
    expect(rejectsInput({ a: { [Symbol('s')]: 1 } })).toBe(true)
  })

  it('不可枚举属性 → 拒绝（序列化时会丢）', () => {
    const hidden = {}
    Object.defineProperty(hidden, 'a', { value: 1, enumerable: false, configurable: true })
    expect(rejectsInput({ a: hidden })).toBe(true)
  })

  it('🔴 可枚举的 getter → 拒绝，而且**不会被调用**（校验器不许跑别人的副作用）', () => {
    let invoked = false
    const withGetter = {}
    Object.defineProperty(withGetter, 'a', {
      enumerable: true,
      configurable: true,
      get() {
        invoked = true
        return 1
      },
    })
    expect(rejectsInput({ a: withGetter })).toBe(true)
    expect(invoked, 'getter 被调用了 —— 校验器必须只读描述符').toBe(false)
  })
})

// ── 校验结果不可被调用方改坏 ─────────────────────────────────────────────────

describe('GrowthValidationResult 是冻结的', () => {
  it('共用的成功值改不动', () => {
    const result = validateGrowthEvidence(evidence())
    expect(result).toEqual({ ok: true })
    expect(Object.isFrozen(result)).toBe(true)
    expect(() => {
      ;(result as { ok: boolean }).ok = false
    }).toThrow()
    // 改不动之后，下一次调用拿到的仍然是 ok
    expect(validateGrowthEvidence(evidence())).toEqual({ ok: true })
  })

  it('失败值同样冻结', () => {
    const result = validateGrowthEvidence(mutate(evidence(), { observedAt: 'nope' }))
    expect(result.ok).toBe(false)
    expect(Object.isFrozen(result)).toBe(true)
  })
})

// ── 类型层契约 ───────────────────────────────────────────────────────────────
//
// 🔴 下面每一条 `@ts-expect-error` 本身就是断言，由 `npm run type-check` 判定，
//    **刻意不产生任何运行时断言** —— 早先那两句 `expect(fixture.x).toBe(...)`
//    验的是测试自己写的样本数据，读起来却像在验契约。
//    若某一行不再报错，说明契约被放松了，tsc 会当场失败。

// 契约：候选身份是结构体，Kernel 那种 `domain.intent` 字符串不能当它用。
// @ts-expect-error
const IDENTITY_IS_NOT_A_STRING: GrowthActionCandidateIdentity = 'seo.build_publish_package'

// 契约：notDoing 必填 —— 做成可选就等于永远没人填。
const { notDoing: _droppedNotDoing, ...prescriptionWithoutNotDoing } = prescription()
// @ts-expect-error
const PRESCRIPTION_NEEDS_NOT_DOING: GrowthPrescription = prescriptionWithoutNotDoing

// 契约：verification 必填 —— 判据必须先于执行确定。
const { verification: _droppedVerification, ...candidateWithoutVerification } = candidate()
// @ts-expect-error
const CANDIDATE_NEEDS_VERIFICATION: GrowthActionCandidate = candidateWithoutVerification

void IDENTITY_IS_NOT_A_STRING
void PRESCRIPTION_NEEDS_NOT_DOING
void CANDIDATE_NEEDS_VERIFICATION

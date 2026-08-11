/**
 * Magic Engine 2.0 · Growth Module 契约 —— 纯校验器（Issue #877 / WP01）
 *
 * 🔴 **纯函数。** 不落库、不改传入对象、不规范化、不推断、不补默认值、
 *    不做任何域推理。同样的输入必然得到同样的结论。
 *
 * 🔴 只校验 WP00 冻结的不变量 + 明显畸形的输入。业务判断属于 Domain Module
 *    （WP05），塞进这里会让契约层悄悄变成业务逻辑的存放地 —— 这正是
 *    `src/lib/kernel/registry.ts` 的 `validateAgainstSchema` 刻意避开的那件事。
 *
 * 返回形状沿用全仓惯例（`src/lib/validation-utils.ts` / kernel registry）：
 * `{ ok: true } | { ok: false; reason }`。不引第三方校验器。
 */

import type { DiagnosticDimension, DiagnosticSeverity } from '@/types/diagnostic'
import type { GrowthUnknownReason } from './types'

export type GrowthValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/** 🔴 全模块共用同一个成功值，所以必须冻结 —— 否则任何调用方都能改到别人的结果。 */
const OK: GrowthValidationResult = Object.freeze({ ok: true as const })
const fail = (reason: string): GrowthValidationResult => Object.freeze({ ok: false as const, reason })

// ── 基础判据 ──────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 只要求「能被解析成一个时刻」，不强制 ISO 8601 —— WP00 §5.1 冻结的是「什么时候」，不是格式。 */
function isParseableTimestamp(value: unknown): boolean {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

/**
 * 用 `Record<Union, true>` 而不是数组：上游枚举加了新值而这里没跟上时
 * **编译失败**，不是运行时才发现少了一个分支。
 */
const PILLARS: Readonly<Record<DiagnosticDimension, true>> = {
  seo: true, ai_visibility: true, ads: true, social: true, reputation: true, competitor: true,
}
const SEVERITIES: Readonly<Record<DiagnosticSeverity, true>> = {
  critical: true, high: true, medium: true, low: true, info: true,
}
const UNKNOWN_REASONS: Readonly<Record<GrowthUnknownReason, true>> = {
  not_recorded_by_source: true, not_applicable: true, source_ambiguous: true,
}
const IMPACTS: Readonly<Record<'low' | 'medium' | 'high', true>> = {
  low: true, medium: true, high: true,
}

const inSet = (set: Readonly<Record<string, true>>, v: unknown): boolean =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(set, v)

/**
 * 「不知道」必须显式写出来。
 *
 * 🔴 字段缺失 / `null` 一律判非法：省略会让下游把「不知道」读成「一样」，
 *    补 0 会让「不可算」读成「一次都没有」
 *    （WP00 §4 / §6 / §14.2 #14 · GEO 契约 §5 第 3 条）。
 */
function validateMaybeUnknown(
  value: unknown,
  label: string,
  checkKnownValue: (v: unknown) => string | null,
): GrowthValidationResult {
  if (!isPlainObject(value)) {
    return fail(`${label} 必须显式写成 { known: true, value } 或 { known: false, reason }，不能省略或写 null`)
  }
  if (value.known === true) {
    const problem = checkKnownValue(value.value)
    return problem === null ? OK : fail(`${label}.value ${problem}`)
  }
  if (value.known === false) {
    return inSet(UNKNOWN_REASONS, value.reason)
      ? OK
      : fail(`${label}.reason 必须是已登记的未知理由码`)
  }
  return fail(`${label}.known 必须是 true 或 false`)
}

// ── Evidence ─────────────────────────────────────────────────────────────────

export function validateGrowthEvidence(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) return fail('Evidence 必须是一个对象')

  const source = value.source
  if (!isPlainObject(source)) return fail('Evidence.source 必须是一个对象')
  if (!isNonEmptyString(source.kind)) return fail('Evidence.source.kind 不能为空')
  if (!isNonEmptyString(source.sourceId)) return fail('Evidence.source.sourceId 不能为空')

  if (!isParseableTimestamp(value.observedAt)) {
    return fail('Evidence.observedAt 必须是可解析的时间戳')
  }

  const locator = validateMaybeUnknown(value.rawLocator, 'Evidence.rawLocator', (v) =>
    isNonEmptyString(v) ? null : '必须是非空字符串',
  )
  if (!locator.ok) return locator

  const interpretation = validateMaybeUnknown(value.interpretation, 'Evidence.interpretation', (v) =>
    isPlainObject(v) && isNonEmptyString(v.parserVersion) ? null : '必须带非空 parserVersion',
  )
  if (!interpretation.ok) return interpretation

  // 置信度是质量信号，不是身份维度（GEO 契约 §3.3）——它只被校验取值范围。
  return validateMaybeUnknown(value.confidence, 'Evidence.confidence', (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
      ? null
      : '必须是 0 到 1 之间的有限数',
  )
}

// ── Finding ──────────────────────────────────────────────────────────────────

export function validateGrowthFinding(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) return fail('Finding 必须是一个对象')
  if (!inSet(PILLARS, value.pillar)) return fail('Finding.pillar 必须是已登记的支柱之一')
  if (!inSet(SEVERITIES, value.severity)) return fail('Finding.severity 必须是已登记的严重度之一')
  if (!isNonEmptyString(value.statement)) return fail('Finding.statement 不能为空')

  // 🔴 WP00 §5.2 红线：指不回证据的发现不许存在。
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    return fail('Finding 必须至少引用一条 Evidence —— 没有证据支撑的发现不许存在')
  }
  for (let i = 0; i < value.evidence.length; i += 1) {
    const result = validateGrowthEvidence(value.evidence[i])
    if (!result.ok) return fail(`Finding.evidence[${i}]：${result.reason}`)
  }
  return OK
}

function validateFindingList(value: unknown, label: string): GrowthValidationResult {
  if (!Array.isArray(value) || value.length === 0) {
    return fail(`${label} 必须至少包含一条 Finding`)
  }
  for (let i = 0; i < value.length; i += 1) {
    const result = validateGrowthFinding(value[i])
    if (!result.ok) return fail(`${label}[${i}]：${result.reason}`)
  }
  return OK
}

// ── Prescription ─────────────────────────────────────────────────────────────

/** 「刻意不做什么」可以是空数组，但必须显式存在（WP00 §5.3）。 */
function validateNotDoing(value: unknown): GrowthValidationResult {
  if (!Array.isArray(value)) {
    return fail('Prescription.notDoing 必须显式给出（可以是空数组，但不能省略）')
  }
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i]
    if (!isPlainObject(entry)) return fail(`Prescription.notDoing[${i}] 必须是一个对象`)
    if (!isNonEmptyString(entry.statement)) return fail(`Prescription.notDoing[${i}].statement 不能为空`)
    if (!isNonEmptyString(entry.reason)) return fail(`Prescription.notDoing[${i}].reason 不能为空`)
  }
  return OK
}

export function validateGrowthPrescription(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) return fail('Prescription 必须是一个对象')

  const goal = validateMaybeUnknown(value.goalId, 'Prescription.goalId', (v) =>
    isNonEmptyString(v) ? null : '必须是非空字符串',
  )
  if (!goal.ok) return goal

  const covers = validateFindingList(value.covers, 'Prescription.covers')
  if (!covers.ok) return covers

  const notDoing = validateNotDoing(value.notDoing)
  if (!notDoing.ok) return notDoing

  if (!isNonEmptyString(value.orderingRationale)) {
    return fail('Prescription.orderingRationale 不能为空')
  }
  return OK
}

// ── VerificationDefinition ───────────────────────────────────────────────────

export function validateGrowthVerificationDefinition(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) return fail('VerificationDefinition 必须是一个对象')
  if (!isNonEmptyString(value.metricRef)) return fail('VerificationDefinition.metricRef 不能为空')

  const window = value.windowDays
  if (typeof window !== 'number' || !Number.isInteger(window) || window <= 0) {
    return fail('VerificationDefinition.windowDays 必须是正整数')
  }
  if (!isNonEmptyString(value.baseline)) return fail('VerificationDefinition.baseline 不能为空')

  const criteria = value.criteria
  if (!isPlainObject(criteria)) return fail('VerificationDefinition.criteria 必须是一个对象')
  // 🔴 WP00 §5.5 红线：只有成功和失败两档，会逼系统在证据不足时编一个答案。
  for (const key of ['success', 'failure', 'indeterminate'] as const) {
    if (!isNonEmptyString(criteria[key])) {
      return fail(`VerificationDefinition.criteria.${key} 必须写清楚 —— 成功 / 失败 / 无法判定三档缺一不可`)
    }
  }
  return OK
}

// ── ActionCandidate ──────────────────────────────────────────────────────────

/**
 * 候选身份只要求两段非空。
 *
 * 🔴 WP00 §8.3 第 3 条冻结的是「**不能是一段自由文本**」—— 结构体 + 下面这个
 *    对象判断已经完整满足。大小写 / 分隔符 / 长度属于命名规范，归 K-WP02，
 *    在这里加语法闸只会误拒 K-WP02 本来认得的意图。
 */
function validateCandidateIdentity(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) {
    return fail('ActionCandidate.identity 必须是 { domain, intent } 结构，不能是一个字符串')
  }
  for (const key of ['domain', 'intent'] as const) {
    if (!isNonEmptyString(value[key])) {
      return fail(`ActionCandidate.identity.${key} 不能为空`)
    }
  }
  return OK
}

/**
 * `input` 必须真的是 JSON 值，不是「看起来像个对象」就算。
 *
 * 🔴 判据是「**会不会在序列化时静默变样**」，下面每一条都实测过：
 *
 *   | 输入 | `JSON.stringify` 之后 |
 *   |---|---|
 *   | 稀疏数组 `[1,,3]` | `[1,null,3]` —— 空洞变成 `null` |
 *   | 数组上的额外字符串属性 | 直接丢掉 |
 *   | symbol 键 | 直接丢掉 |
 *   | 不可枚举属性 | 直接丢掉 |
 *   | `undefined` / 函数 | 对象里丢掉、数组里变 `null` |
 *   | `Date` / `Map` / 类实例 | 变成字符串或 `{}` |
 *   | `NaN` / `Infinity` | 变成 `null` |
 *   | `bigint` | 直接抛异常 |
 *
 * 🔴 **一律读属性描述符，绝不触发 getter。** 访问器属性直接拒绝 ——
 *    校验器是纯函数，不能在「只是检查一下」的时候把别人的副作用跑掉。
 *    （`Object.values()` 会调 getter，所以这里不能用它。）
 *
 * 🔴 只查**值**，不查键名语义。`ancestors` 只跟踪当前这条路径，
 *    所以同一个对象被引用两次（DAG）不算环，只有真的成环才拒。
 */
function isJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false

  if (ancestors.has(value)) return false
  ancestors.add(value)
  const ok = Array.isArray(value)
    ? isDenseJsonArray(value, ancestors)
    : isJsonRecord(value, ancestors)
  ancestors.delete(value)
  return ok
}

/** 数组必须稠密，且除了下标与 `length` 之外不许有别的自有属性。 */
function isDenseJsonArray(node: readonly unknown[], ancestors: Set<object>): boolean {
  if (Object.getOwnPropertySymbols(node).length > 0) return false
  // 自有属性名应当正好是 0…length-1 再加一个 `length`；对不上就说明有空洞或有夹带。
  if (Object.getOwnPropertyNames(node).length !== node.length + 1) return false

  for (let i = 0; i < node.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(node, i)
    // 描述符缺失 = 空洞；没有 value = 访问器；不可枚举 = 序列化时会丢
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false
    if (!isJsonValue(descriptor.value, ancestors)) return false
  }
  return true
}

/** 普通对象只许带「可枚举的字符串键数据属性」。 */
function isJsonRecord(node: object, ancestors: Set<object>): boolean {
  const proto = Object.getPrototypeOf(node) as unknown
  if (proto !== Object.prototype && proto !== null) return false
  if (Object.getOwnPropertySymbols(node).length > 0) return false

  for (const key of Object.getOwnPropertyNames(node)) {
    const descriptor = Object.getOwnPropertyDescriptor(node, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return false
    if (!isJsonValue(descriptor.value, ancestors)) return false
  }
  return true
}

/**
 * 🔴 候选只有这六个字段，多出来的一律**拒绝**而不是忽略（WP00 §5.4 / §8.2）。
 *
 * 为什么是白名单不是黑名单：黑名单守不住这条红线 —— 本仓规定 AU/NZ 英语拼写，
 * 一个 `authorised` 就能绕过去，`riskLevel` / `authorizationDecisionId` 之类的
 * 驼峰变体同样穿得过。仓库既有先例是 `src/lib/kernel/registry.ts` 的
 * `additionalProperties === false`。
 *
 * 代价是前向兼容：契约要加字段本来就必须走一次改契约的 PR（§8.3 第 5 条），
 * 那正是同步改这份清单的时刻。
 */
const CANDIDATE_KEYS: readonly string[] = [
  'identity', 'input', 'basis', 'expectedImpact', 'cost', 'verification',
]

/**
 * 🔴 会花钱却说不出上界 = 非法。
 *
 * WP00 §8.4 / GEO 契约 §7.1 第 3 条：说不出成本上界的付费步骤一律 fail closed。
 */
function validateCandidateCost(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) return fail('ActionCandidate.cost 必须是一个对象')
  if (typeof value.spendsMoney !== 'boolean') {
    return fail('ActionCandidate.cost.spendsMoney 必须是布尔值')
  }
  const ceiling = validateMaybeUnknown(value.ceilingUsd, 'ActionCandidate.cost.ceilingUsd', (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null : '必须是非负的有限数',
  )
  if (!ceiling.ok) return ceiling

  const ceilingKnown = isPlainObject(value.ceilingUsd) && value.ceilingUsd.known === true
  if (value.spendsMoney && !ceilingKnown) {
    return fail('这个动作会花钱却说不出成本上界 —— 按 fail closed 拒绝，不许先跑了再说')
  }
  return OK
}

export function validateGrowthActionCandidate(value: unknown): GrowthValidationResult {
  if (!isPlainObject(value)) return fail('ActionCandidate 必须是一个对象')

  const extra = Object.keys(value).filter((key) => !CANDIDATE_KEYS.includes(key))
  if (extra.length > 0) {
    return fail(`ActionCandidate 只有六个字段，多出来的不认：${extra.join('、')} —— 候选不是命令，授权 / 风险 / 副作用一个都不许夹带`)
  }

  const identity = validateCandidateIdentity(value.identity)
  if (!identity.ok) return identity

  if (!isPlainObject(value.input)) {
    return fail('ActionCandidate.input 必须是一个对象')
  }
  if (!isJsonValue(value.input, new Set())) {
    return fail(
      'ActionCandidate.input 必须是纯 JSON 值 —— undefined / 函数 / symbol / bigint / ' +
        'Date 之类的非普通对象 / NaN / 循环引用都不行（它们会在落库时静默变形或直接抛异常）',
    )
  }

  const basis = validateFindingList(value.basis, 'ActionCandidate.basis')
  if (!basis.ok) return basis

  if (!inSet(IMPACTS, value.expectedImpact)) {
    return fail('ActionCandidate.expectedImpact 必须是 low / medium / high 之一')
  }
  const cost = validateCandidateCost(value.cost)
  if (!cost.ok) return cost

  // 必填 —— 判据必须在动作发生之前就定死（WP00 §4 verify 段红线）。
  const verification = validateGrowthVerificationDefinition(value.verification)
  if (!verification.ok) return fail(`ActionCandidate.verification：${verification.reason}`)

  return OK
}

/**
 * ME2 Product Map v1 —— registry 组件的纯校验器（Issue #974）。
 *
 * 🔴 纯函数。不落库、不改传入对象、不补默认值。分类规则（哪个类型能有什么、
 *    不能有什么）与成熟度上限（`maturity.ts`）都在这里强制，任何调用方
 *    （种子数据测试、未来的 GitHub 同步、Dashboard 提交）都绕不过去。
 *
 * 返回形状沿用全仓惯例（`src/lib/growth/validators.ts` / `src/lib/validation-utils.ts`）：
 * `{ ok: true } | { ok: false; reason }`。
 */

import type {
  BusinessLane,
  ComponentType,
  DapeStage,
  EvidenceRecord,
  Maturity,
  MaturityEvidenceFlags,
  RegistryComponent,
  RiskLevel,
} from './types'
import { deriveMaturityCeiling } from './maturity'

export type ProductMapValidationResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const OK: ProductMapValidationResult = Object.freeze({ ok: true as const })
const fail = (reason: string): ProductMapValidationResult => Object.freeze({ ok: false as const, reason })

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isParseableTimestamp(value: unknown): boolean {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

const inSet = <T extends string>(set: Readonly<Record<T, true>>, v: unknown): v is T =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(set, v)

const COMPONENT_TYPES: Readonly<Record<ComponentType, true>> = {
  module: true, capability: true, adapter: true, agent: true, playbook: true, platform: true, registry: true,
}
const BUSINESS_LANES: Readonly<Record<BusinessLane, true>> = {
  shared: true, geo: true, seo: true, social: true, ads: true,
}
const DAPE_STAGES: Readonly<Record<DapeStage, true>> = {
  discovery: true, analysis: true, prescription: true, authorization: true,
  execution: true, verification: true, outcome: true, learning: true,
}
const MATURITIES: Readonly<Record<Maturity, true>> = {
  M0: true, M1: true, M2: true, M3: true, M4: true, M5: true,
}
const RISK_LEVELS: Readonly<Record<RiskLevel, true>> = { A: true, B: true, C: true }
const EVIDENCE_KINDS: Readonly<Record<EvidenceRecord['kind'], true>> = {
  issue: true, pull_request: true, commit: true, source_path: true, production_table: true, doc_reference: true,
}

/** `componentId` 命名规范：小写 kebab-case，不能以连字符开头/结尾，不能连续连字符。 */
const COMPONENT_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function isRepoRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  if (value.startsWith('/')) return false
  if (value.includes('..')) return false
  return true
}

function validateArray(
  value: unknown,
  label: string,
  opts: { readonly minLength?: number; readonly itemCheck?: (v: unknown) => boolean } = {},
): ProductMapValidationResult {
  if (!Array.isArray(value)) return fail(`${label} 必须是数组`)
  const min = opts.minLength ?? 0
  if (value.length < min) return fail(`${label} 至少需要 ${min} 项`)
  const check = opts.itemCheck ?? isNonEmptyString
  for (let i = 0; i < value.length; i += 1) {
    if (!check(value[i])) return fail(`${label}[${i}] 不合法`)
  }
  return OK
}

// ── EvidenceRecord ───────────────────────────────────────────────────────────

export function validateEvidenceRecord(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('EvidenceRecord 必须是一个对象')
  if (!inSet(EVIDENCE_KINDS, value.kind)) return fail('EvidenceRecord.kind 必须是已登记的证据类型之一')
  if (!isNonEmptyString(value.description)) return fail('EvidenceRecord.description 不能为空')
  if (!isNonEmptyString(value.link)) {
    return fail('EvidenceRecord.link 不能为空 —— 证据必须指向具体的 issue / PR / 路径 / 表名')
  }
  return OK
}

// ── MaturityEvidenceFlags ────────────────────────────────────────────────────

const MATURITY_FLAG_KEYS: readonly (keyof MaturityEvidenceFlags)[] = [
  'hasContractFrozen', 'hasMergedToMain', 'hasTargetedTestsPassing',
  'hasRealIntegrationEvidence', 'hasProductionRunEvidence', 'hasRepeatedOutcomeEvidence',
]

export function validateMaturityEvidenceFlags(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('maturityEvidence 必须是一个对象')
  for (const key of MATURITY_FLAG_KEYS) {
    if (typeof value[key] !== 'boolean') return fail(`maturityEvidence.${key} 必须是布尔值`)
  }
  return OK
}

// ── ComponentBlocker ─────────────────────────────────────────────────────────

function validateBlockerList(value: unknown): ProductMapValidationResult {
  if (!Array.isArray(value)) return fail('blockers 必须显式给出（可以是空数组，但不能省略）')
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i]
    if (!isPlainObject(entry)) return fail(`blockers[${i}] 必须是一个对象`)
    if (!isNonEmptyString(entry.statement)) return fail(`blockers[${i}].statement 不能为空`)
    if (!isParseableTimestamp(entry.since)) return fail(`blockers[${i}].since 必须是可解析的时间戳`)
  }
  return OK
}

// ── 分类规则（Issue #974「分类模型」一节的可执行版本）─────────────────────────

/**
 * 类型专属规则：
 *  - `adapter` 必须声明至少一项 `requiredPermissions` —— 它连接外部系统，
 *    不可能不需要任何权限（Issue #974：Adapter 是「连接外部系统或 provider 的技术适配层」）。
 *  - `platform` / `registry` 的 `businessLanes` 必须严格等于 `['shared']` ——
 *    两者都是「跨业务线共享的基础设施」，不允许挂在单一业务线下。
 */
function validateTypeSpecificRules(component: RegistryComponent): ProductMapValidationResult {
  if (component.type === 'adapter' && component.requiredPermissions.length === 0) {
    return fail('type=adapter 必须声明至少一项 requiredPermissions —— 适配层连接外部系统，不可能零权限')
  }
  if (component.type === 'platform' || component.type === 'registry') {
    const lanes = component.businessLanes
    if (lanes.length !== 1 || lanes[0] !== 'shared') {
      return fail(`type=${component.type} 的 businessLanes 必须严格等于 ['shared'] —— 它是跨业务线共享基础设施`)
    }
  }
  return OK
}

// ── RegistryComponent ────────────────────────────────────────────────────────

const isPositiveInteger = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v > 0
const isComponentIdRef = (v: unknown): boolean => isNonEmptyString(v) && COMPONENT_ID_PATTERN.test(v)

/** 校验所有数组型字段（车道 / DAPE 段 / owner / 依赖 / 消费者 / 路径 / issue&PR 编号 / 权限）。 */
function validateComponentArrays(value: Record<string, unknown>): ProductMapValidationResult {
  const lanes = validateArray(value.businessLanes, 'businessLanes', { minLength: 1, itemCheck: (v) => inSet(BUSINESS_LANES, v) })
  if (!lanes.ok) return lanes

  const stages = validateArray(value.dapeStages, 'dapeStages', { itemCheck: (v) => inSet(DAPE_STAGES, v) })
  if (!stages.ok) return stages

  const owners = validateArray(value.owners, 'owners', { minLength: 1 })
  if (!owners.ok) return owners

  const dependencies = validateArray(value.dependencies, 'dependencies', { itemCheck: isComponentIdRef })
  if (!dependencies.ok) return dependencies

  const consumers = validateArray(value.consumers, 'consumers', { itemCheck: isComponentIdRef })
  if (!consumers.ok) return consumers

  const sourcePaths = validateArray(value.sourcePaths, 'sourcePaths', { minLength: 1, itemCheck: isRepoRelativePath })
  if (!sourcePaths.ok) return sourcePaths

  const issueNumbers = validateArray(value.issueNumbers, 'issueNumbers', { itemCheck: isPositiveInteger })
  if (!issueNumbers.ok) return issueNumbers

  const pullRequestNumbers = validateArray(value.pullRequestNumbers, 'pullRequestNumbers', { itemCheck: isPositiveInteger })
  if (!pullRequestNumbers.ok) return pullRequestNumbers

  return validateArray(value.requiredPermissions, 'requiredPermissions')
}

/** 校验 evidence 列表，并强制 maturity 恰好等于 maturityEvidence 推导出的天花板。 */
function validateEvidenceAndMaturity(value: Record<string, unknown>): ProductMapValidationResult {
  const evidenceList = value.evidence
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    return fail('evidence 必须至少包含一条记录 —— 没有证据支撑的组件不许存在于 registry')
  }
  for (let i = 0; i < evidenceList.length; i += 1) {
    const result = validateEvidenceRecord(evidenceList[i])
    if (!result.ok) return fail(`evidence[${i}]：${result.reason}`)
  }

  const maturityEvidence = validateMaturityEvidenceFlags(value.maturityEvidence)
  if (!maturityEvidence.ok) return maturityEvidence

  if (!inSet(MATURITIES, value.maturity)) return fail('maturity 必须是 M0–M5 之一')

  const ceiling = deriveMaturityCeiling(value.maturityEvidence as MaturityEvidenceFlags)
  if (value.maturity !== ceiling) {
    return fail(
      `maturity 必须等于由 maturityEvidence 推导出的天花板 —— 声明的是 ${String(value.maturity)}，` +
        `证据只能撑到 ${ceiling}。成熟度必须由证据推导，不能由人工随意改成完成`,
    )
  }
  return OK
}

export function validateRegistryComponent(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('RegistryComponent 必须是一个对象')

  if (!isNonEmptyString(value.componentId) || !COMPONENT_ID_PATTERN.test(value.componentId)) {
    return fail('componentId 必须是小写 kebab-case（例如 me2-execution-kernel）')
  }
  if (!inSet(COMPONENT_TYPES, value.type)) return fail('type 必须是七种已登记类型之一')
  if (!isNonEmptyString(value.name)) return fail('name 不能为空')
  if (!isNonEmptyString(value.description)) return fail('description 不能为空')
  if (!isNonEmptyString(value.version)) return fail('version 不能为空')

  const arrays = validateComponentArrays(value)
  if (!arrays.ok) return arrays

  if (!inSet(RISK_LEVELS, value.riskLevel)) return fail('riskLevel 必须是 A / B / C 之一')

  const evidenceAndMaturity = validateEvidenceAndMaturity(value)
  if (!evidenceAndMaturity.ok) return evidenceAndMaturity

  const blockers = validateBlockerList(value.blockers)
  if (!blockers.ok) return blockers

  return validateTypeSpecificRules(value as unknown as RegistryComponent)
}

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
  ArchitecturalRole,
  BusinessLane,
  DapeStage,
  EvidenceRecord,
  EvidenceStatus,
  MaturitySignals,
  OperationalCheck,
  OperationalSnapshot,
  RegistryComponent,
  RiskLevel,
  SupportingArtifact,
} from './types'

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

/** WP00 §3 冻结七层。**没有第八个** —— 加值必须先回到 #872 改冻结契约。 */
const ARCHITECTURAL_ROLES: Readonly<Record<ArchitecturalRole, true>> = {
  agent: true,
  domain_module: true,
  measurement: true,
  shared_capability: true,
  kernel: true,
  attribution_flywheel: true,
  operating_brief: true,
}
const EVIDENCE_STATUSES: Readonly<Record<EvidenceStatus, true>> = { yes: true, no: true, unknown: true }
const ARTIFACT_KINDS: Readonly<Record<SupportingArtifact['kind'], true>> = {
  provider_adapter: true, orchestration_view: true, tooling: true,
}
const BUSINESS_LANES: Readonly<Record<BusinessLane, true>> = {
  shared: true, geo: true, seo: true, social: true, ads: true,
}
const DAPE_STAGES: Readonly<Record<DapeStage, true>> = {
  discovery: true, analysis: true, prescription: true, authorization: true,
  execution: true, verification: true, outcome: true, learning: true,
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

// ── 三态与四问 ───────────────────────────────────────────────────────────────

const MATURITY_SIGNAL_KEYS: readonly (keyof MaturitySignals)[] = [
  'contractFrozen', 'mergedToMain', 'targetedTestsPassing',
  'realIntegration', 'productionRun', 'repeatedAttributableOutcome',
]

/**
 * 六道成熟度信号必须是三态字符串，**不能是 boolean**。
 * 传 boolean 一律拒绝 —— 那正是丢掉「没查到 / 确定没有」区别的写法。
 */
export function validateMaturitySignals(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('maturitySignals 必须是一个对象')
  for (const key of MATURITY_SIGNAL_KEYS) {
    if (typeof value[key] === 'boolean') {
      return fail(`maturitySignals.${key} 不能是布尔值 —— 必须是 yes / no / unknown 三态`)
    }
    if (!inSet(EVIDENCE_STATUSES, value[key])) {
      return fail(`maturitySignals.${key} 必须是 yes / no / unknown 之一`)
    }
  }
  return OK
}

/**
 * 一条「四问」答案。
 *
 * 🔴 `status !== 'unknown'` 时 `checkedAt` 必填：给得出确定答案，就必须交代
 *    是什么时候查的。否则读的人无法判断它有没有过期。
 */
export function validateOperationalCheck(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('OperationalCheck 必须是一个对象')
  if (typeof value.status === 'boolean') {
    return fail('OperationalCheck.status 不能是布尔值 —— 必须是 yes / no / unknown 三态')
  }
  if (!inSet(EVIDENCE_STATUSES, value.status)) return fail('OperationalCheck.status 必须是 yes / no / unknown 之一')
  if (!isNonEmptyString(value.evidenceSource)) {
    return fail('OperationalCheck.evidenceSource 不能为空 —— 必须说明这个答案是从哪查到的')
  }
  if (value.status === 'unknown') {
    if (value.checkedAt !== null && !isParseableTimestamp(value.checkedAt)) {
      return fail('OperationalCheck.checkedAt 必须是 null 或可解析的时间戳')
    }
  } else if (!isParseableTimestamp(value.checkedAt)) {
    return fail('OperationalCheck.checkedAt 必填 —— 给出确定答案就必须交代核对时间')
  }
  if (value.note !== undefined && !isNonEmptyString(value.note)) {
    return fail('OperationalCheck.note 给了就不能是空字符串')
  }
  return OK
}

const SNAPSHOT_KEYS: readonly (keyof OperationalSnapshot)[] = [
  'codeInMain', 'productionPrerequisitesExist', 'realCallerWired', 'productionRunObserved',
]

/** 四问快照：四问都必须显式存在，任何一问缺失都不许用「其它三问」代偿。 */
export function validateOperationalSnapshot(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('OperationalSnapshot 必须是一个对象')
  for (const key of SNAPSHOT_KEYS) {
    const result = validateOperationalCheck(value[key])
    if (!result.ok) return fail(`${key}：${result.reason}`)
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

// ── SupportingArtifact ───────────────────────────────────────────────────────

/**
 * 附属产物 —— adapter 就活在这里，不是顶层角色。
 * `provider_adapter` 必须声明权限：连接外部系统不可能零权限。
 */
export function validateSupportingArtifact(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('SupportingArtifact 必须是一个对象')
  if (!inSet(ARTIFACT_KINDS, value.kind)) {
    return fail('SupportingArtifact.kind 必须是 provider_adapter / orchestration_view / tooling 之一')
  }
  if (!isNonEmptyString(value.name)) return fail('SupportingArtifact.name 不能为空')
  if (!isNonEmptyString(value.description)) return fail('SupportingArtifact.description 不能为空')

  const paths = validateArray(value.sourcePaths, 'SupportingArtifact.sourcePaths', {
    minLength: 1, itemCheck: isRepoRelativePath,
  })
  if (!paths.ok) return paths

  const permissions = validateArray(value.requiredPermissions, 'SupportingArtifact.requiredPermissions')
  if (!permissions.ok) return permissions
  if (value.kind === 'provider_adapter' && (value.requiredPermissions as unknown[]).length === 0) {
    return fail('provider_adapter 必须声明至少一项 requiredPermissions —— 连接外部系统不可能零权限')
  }

  const evidenceList = value.evidence
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    return fail('SupportingArtifact.evidence 必须至少包含一条记录')
  }
  for (let i = 0; i < evidenceList.length; i += 1) {
    const result = validateEvidenceRecord(evidenceList[i])
    if (!result.ok) return fail(`SupportingArtifact.evidence[${i}]：${result.reason}`)
  }
  return OK
}

// ── 角色专属规则 ─────────────────────────────────────────────────────────────

/**
 * 角色专属规则。只写**由 WP00 直接推得**的那几条，不自创约束：
 *  - `kernel` 是治权基础设施（§3.5），必须 `['shared']`，不许挂在单一业务线下；
 *  - `operating_brief` 是全局注意力投影（§3.7），同理必须 `['shared']`。
 */
function validateRoleSpecificRules(component: RegistryComponent): ProductMapValidationResult {
  if (component.architecturalRole === 'kernel' || component.architecturalRole === 'operating_brief') {
    const lanes = component.businessLanes
    if (lanes.length !== 1 || lanes[0] !== 'shared') {
      return fail(
        `architecturalRole=${component.architecturalRole} 的 businessLanes 必须严格等于 ['shared'] —— 它是跨业务线基础设施`,
      )
    }
  }
  return OK
}

// ── RegistryComponent ────────────────────────────────────────────────────────

const isPositiveInteger = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v > 0
const isComponentIdRef = (v: unknown): boolean => isNonEmptyString(v) && COMPONENT_ID_PATTERN.test(v)

/** 校验所有数组型字段。 */
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

  const contractSpecPaths = validateArray(value.contractSpecPaths, 'contractSpecPaths', { itemCheck: isRepoRelativePath })
  if (!contractSpecPaths.ok) return contractSpecPaths

  const issueNumbers = validateArray(value.issueNumbers, 'issueNumbers', { itemCheck: isPositiveInteger })
  if (!issueNumbers.ok) return issueNumbers

  const pullRequestNumbers = validateArray(value.pullRequestNumbers, 'pullRequestNumbers', { itemCheck: isPositiveInteger })
  if (!pullRequestNumbers.ok) return pullRequestNumbers

  return validateArray(value.requiredPermissions, 'requiredPermissions')
}

/** evidence 列表 + 附属产物列表。 */
function validateEvidenceAndArtifacts(value: Record<string, unknown>): ProductMapValidationResult {
  const evidenceList = value.evidence
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    return fail('evidence 必须至少包含一条记录 —— 没有证据支撑的组件不许存在于 registry')
  }
  for (let i = 0; i < evidenceList.length; i += 1) {
    const result = validateEvidenceRecord(evidenceList[i])
    if (!result.ok) return fail(`evidence[${i}]：${result.reason}`)
  }

  const artifacts = value.supportingArtifacts
  if (!Array.isArray(artifacts)) {
    return fail('supportingArtifacts 必须显式给出（可以是空数组，但不能省略）')
  }
  for (let i = 0; i < artifacts.length; i += 1) {
    const result = validateSupportingArtifact(artifacts[i])
    if (!result.ok) return fail(`supportingArtifacts[${i}]：${result.reason}`)
  }
  return OK
}

/**
 * 校验一条静态登记。
 *
 * 🔴 **拒绝任何动态事实字段**：`maturity` / `maturitySignals` / `maturityEvidence` /
 *    四问快照都不许出现在 registry 条目里。它们是推导结果，写进种子就会过期，
 *    而过期的「已完成」比没有更危险。
 */
export function validateRegistryComponent(value: unknown): ProductMapValidationResult {
  if (!isPlainObject(value)) return fail('RegistryComponent 必须是一个对象')

  for (const forbidden of ['maturity', 'maturityEvidence', 'maturitySignals', 'operational'] as const) {
    if (forbidden in value) {
      return fail(
        `registry 条目不许带 ${forbidden} —— 动态事实由 assessment.ts 从证据源推导，` +
          '手填会在 Git / 生产变化后立刻过期',
      )
    }
  }

  if (!isNonEmptyString(value.componentId) || !COMPONENT_ID_PATTERN.test(value.componentId)) {
    return fail('componentId 必须是小写 kebab-case（例如 me2-execution-kernel）')
  }
  if (!inSet(ARCHITECTURAL_ROLES, value.architecturalRole)) {
    return fail(
      'architecturalRole 必须是 WP00 §3 冻结七层之一（agent / domain_module / measurement / ' +
        'shared_capability / kernel / attribution_flywheel / operating_brief）—— 没有第八个',
    )
  }
  if (!isNonEmptyString(value.name)) return fail('name 不能为空')
  if (!isNonEmptyString(value.description)) return fail('description 不能为空')
  if (!isNonEmptyString(value.version)) return fail('version 不能为空')

  const arrays = validateComponentArrays(value)
  if (!arrays.ok) return arrays

  if (!inSet(RISK_LEVELS, value.riskLevel)) return fail('riskLevel 必须是 A / B / C 之一')

  const evidenceAndArtifacts = validateEvidenceAndArtifacts(value)
  if (!evidenceAndArtifacts.ok) return evidenceAndArtifacts

  const blockers = validateBlockerList(value.blockers)
  if (!blockers.ok) return blockers

  return validateRoleSpecificRules(value as unknown as RegistryComponent)
}

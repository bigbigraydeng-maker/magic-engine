/**
 * 成熟度推导 —— 本 WP 的承重墙。
 *
 * evidenceCeiling 是**严格累积**的梯子：到 M_n 必须 M1..M_n 每一级的证据都齐，
 * 断在第一个缺口（魏征挑刺审的阻塞项 —— 不累积的话，一条手写的 integration
 * 证据就能让零 merged PR 的组件直接 M3，「merged PR 封顶 M2」就被绕空了）。
 *
 * effectiveMaturity = min(declaredMaturity, evidenceCeiling)。
 *
 * 每一级只认自己那类证据；M2 那一级在结构上**只读 ExternalFacts 里的 PR 状态**
 * （或 legacy 的磁盘存在性），M3+ 的判定不读 linkedPullRequests —— 所以
 * 「PR merge 最多自动证明 M2」不是一条 if，是数据流向上的不可能。
 */

import type { ExternalFacts } from './external-facts'
import type { Maturity, ProductMapComponent } from './types'
import { maturityRank, minMaturity } from './types'

export interface MaturityDerivation {
  readonly componentId: string
  readonly declaredMaturity: Maturity
  readonly evidenceCeiling: Maturity
  readonly effectiveMaturity: Maturity
  /** 卡住上限的那一级缺了什么 —— PR 3 的「下一步差什么」直接用。 */
  readonly ceilingReason: string
  /**
   * effective 达到 M4/M5 却只有 manual_claim 撑着 —— 不是 error（事实可能为真），
   * 但控制台必须明示「证据未经机器核验」。
   */
  readonly unverifiedCriticalEvidence: boolean
}

/**
 * M1：有真被冻结的契约。
 * legacy 件的契约和交付 PR 一样是考古题 —— M1/M2 两级统一走「磁盘核验的
 * ownedPaths」通路（registry.test 对着文件系统验），M3 起仍要真证据，
 * M4/M5 对 legacy 永不开放。
 */
export function hasContract(c: ProductMapComponent): boolean {
  if (c.origin === 'legacy') return c.ownedPaths.length > 0
  return c.contractEvidence.length > 0
}

/**
 * M2：代码实现存在。
 * - me2_native：必须有一个 role='implements' 且 ExternalFacts 里状态为 merged 的 PR。
 * - legacy：交付 PR 是考古题，合法通路是「认领的代码路径真实存在」
 *   （registry.test 对着磁盘核验 ownedPaths —— 见子牙设计审第 3 条）。
 */
export function hasImplementation(c: ProductMapComponent, facts: ExternalFacts): boolean {
  if (c.origin === 'legacy') return c.ownedPaths.length > 0
  return c.linkedPullRequests.some((pr) => {
    if (pr.role !== 'implements') return false
    const fact = facts.pullRequests[pr.number]
    return fact !== undefined && fact.state === 'merged'
  })
}

/** M3：真接上了线。 */
export function hasIntegration(c: ProductMapComponent): boolean {
  return c.integrationEvidence.length > 0
}

/** M4：生产真跑过 —— 只对 ME2 原生件开放（legacy 的生产人生记在 operationalStatus）。 */
export function hasProductionValidation(c: ProductMapComponent): boolean {
  return c.origin === 'me2_native' && c.productionEvidence.length > 0
}

/** 严格 YYYY-MM-DD 且真实日历日:'foo'/'bar' 这类脏值按字面去重会绕开 M5 硬门。 */
export function isValidObservationDay(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** M5：≥2 条 recurring_outcome 且观察日不同 —— 一次性跑通不算「持续在学习」。 */
function hasRecurringLearning(c: ProductMapComponent): boolean {
  if (c.origin !== 'me2_native') return false
  const days = new Set(
    c.learningEvidence
      .filter((e) => e.kind === 'recurring_outcome' && isValidObservationDay(e.observedAt))
      .map((e) => e.observedAt),
  )
  return days.size >= 2
}

interface Rung {
  readonly maturity: Maturity
  readonly satisfied: (c: ProductMapComponent, facts: ExternalFacts) => boolean
  readonly missing: string
}

/** 梯子从 M1 起逐级检查；M0 登记即得。顺序就是语义，不许重排。 */
const RUNGS: readonly Rung[] = [
  { maturity: 'M1_CONTRACT_FROZEN', satisfied: (c) => hasContract(c), missing: '缺 frozen_contract 证据' },
  { maturity: 'M2_IMPLEMENTED', satisfied: hasImplementation, missing: '缺 merged 的 implements PR（legacy 件：缺 ownedPaths）' },
  { maturity: 'M3_INTEGRATED', satisfied: (c) => hasIntegration(c), missing: '缺 importer/caller/wiring 证据' },
  { maturity: 'M4_PRODUCTION_VALIDATED', satisfied: (c) => hasProductionValidation(c), missing: '缺可审计的生产执行证据（legacy 件不进 ME2 M4）' },
  { maturity: 'M5_OPERATING_AND_LEARNING', satisfied: (c) => hasRecurringLearning(c), missing: '缺 ≥2 条不同日的 recurring_outcome' },
]

export function evidenceCeiling(
  component: ProductMapComponent,
  facts: ExternalFacts,
): { ceiling: Maturity; reason: string } {
  let ceiling: Maturity = 'M0_REGISTERED'
  for (const rung of RUNGS) {
    if (!rung.satisfied(component, facts)) {
      return { ceiling, reason: `止步 ${ceiling}：${rung.missing}` }
    }
    ceiling = rung.maturity
  }
  return { ceiling, reason: '全部证据齐' }
}

export function deriveMaturity(
  component: ProductMapComponent,
  facts: ExternalFacts,
): MaturityDerivation {
  const { ceiling, reason } = evidenceCeiling(component, facts)
  const effective = minMaturity(component.declaredMaturity, ceiling)

  // 按撑起当前等级的那类证据分别判,不许混数组 —— 混着 .every() 会让一条
  // 无关的 repo_verified learning 条目把「生产证据全是手填」的事实盖掉
  const prodAllManual =
    component.productionEvidence.length > 0 &&
    component.productionEvidence.every((e) => e.verification === 'manual_claim')
  const recurring = component.learningEvidence.filter((e) => e.kind === 'recurring_outcome')
  const learnAllManual =
    recurring.length > 0 && recurring.every((e) => e.verification === 'manual_claim')
  const critical =
    (maturityRank(effective) >= maturityRank('M4_PRODUCTION_VALIDATED') && prodAllManual) ||
    (effective === 'M5_OPERATING_AND_LEARNING' && learnAllManual)

  return {
    componentId: component.id,
    declaredMaturity: component.declaredMaturity,
    evidenceCeiling: ceiling,
    effectiveMaturity: effective,
    ceilingReason: reason,
    unverifiedCriticalEvidence: critical,
  }
}

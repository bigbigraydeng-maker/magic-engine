/**
 * ME2 Product Map v1 —— M0–M5 成熟度推导（Issue #974「成熟度 M0–M5」一节）。
 *
 * 🔴 纯函数，唯一入口是 `deriveMaturityCeiling`。成熟度**只能算出来**，
 *    不接受任何「直接指定」的路径 —— 这正是 Issue #974 那句
 *    「成熟度必须由证据推导，不能由人工随意改成完成」的字面实现。
 *
 * 证据阶梯是累进的：M2 需要 M1 的证据仍然成立、M3 需要 M2 的证据仍然成立……
 * 任何一级证据缺失，天花板就停在它的前一级，不看更高级证据标志是否为 true。
 */

import type { Maturity, MaturityEvidenceFlags } from './types'

interface Rung {
  readonly level: Maturity
  readonly isSatisfied: (evidence: MaturityEvidenceFlags) => boolean
}

/**
 * 六道阶梯，顺序即 Issue #974 的证据上限顺序：
 *   只有 PR → 最高 M1；merge 到 main → 最高 M2；
 *   没有真实集成证据 → 不得 M3；没有生产运行证据 → 不得 M4；
 *   没有重复 outcome 证据 → 不得 M5。
 */
const LADDER: readonly Rung[] = [
  { level: 'M0', isSatisfied: () => true },
  { level: 'M1', isSatisfied: (e) => e.hasContractFrozen },
  { level: 'M2', isSatisfied: (e) => e.hasMergedToMain && e.hasTargetedTestsPassing },
  { level: 'M3', isSatisfied: (e) => e.hasRealIntegrationEvidence },
  { level: 'M4', isSatisfied: (e) => e.hasProductionRunEvidence },
  { level: 'M5', isSatisfied: (e) => e.hasRepeatedOutcomeEvidence },
]

export const MATURITY_ORDER: readonly Maturity[] = LADDER.map((rung) => rung.level)

/** 证据能撑住的最高成熟度 —— 一旦某一级不满足就停在它的前一级。 */
export function deriveMaturityCeiling(evidence: MaturityEvidenceFlags): Maturity {
  let ceiling: Maturity = 'M0'
  for (const rung of LADDER) {
    if (!rung.isSatisfied(evidence)) break
    ceiling = rung.level
  }
  return ceiling
}

/** `a` 是否严格高于 `b`（按阶梯顺序，不是字符串比较）。 */
export function isMaturityAbove(a: Maturity, b: Maturity): boolean {
  return MATURITY_ORDER.indexOf(a) > MATURITY_ORDER.indexOf(b)
}

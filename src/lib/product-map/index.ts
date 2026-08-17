/**
 * ME2 Product Map —— facade。
 *
 * 消费方（PR 3 控制台 / PR 2 同步器）从这里拿：组件清单、成熟度推导、
 * 依赖邻接、blocker 传播、校验结果。warnings 随快照一起返回 ——
 * 「声明高于证据」这类事必须露头,不许死在测试日志里。
 */

import { MANUAL_FACTS_SNAPSHOT } from './external-facts'
import type { ExternalFacts } from './external-facts'
import { deriveMaturity } from './maturity'
import type { MaturityDerivation } from './maturity'
import { deriveOperationalSnapshot } from './operational-snapshot'
import type { OperationalSnapshot } from './operational-snapshot'
import { neighboursOf, propagateBlocked } from './graph'
import type { ComponentNeighbours } from './graph'
import { PRODUCT_MAP_COMPONENTS } from './registry'
import { validateRegistry } from './validate'
import type { ValidationResult } from './validate'
import type { ProductMapComponent } from './types'

export * from './types'
export * from './external-facts'
export { deriveMaturity, evidenceCeiling } from './maturity'
export type { MaturityDerivation } from './maturity'
export { deriveOperationalSnapshot, PROBE_STATUS } from './operational-snapshot'
export type { OperationalProbe, OperationalSnapshot, ProbeStatus } from './operational-snapshot'
export { validateRegistry } from './validate'
export type { ValidationIssue, ValidationResult } from './validate'
export {
  findDanglingDependencies,
  findOrderingCycles,
  neighboursOf,
  propagateBlocked,
} from './graph'
export { PRODUCT_MAP_COMPONENTS } from './registry'

export interface ComponentSnapshot {
  readonly component: ProductMapComponent
  readonly maturity: MaturityDerivation
  readonly operational: OperationalSnapshot
  readonly neighbours: ComponentNeighbours
  /** 沿 requires 边传导过来的上游 blocker 源（空 = 没被上游卡住）。 */
  readonly inheritedBlockedBy: readonly string[]
}

export interface ProductMapSnapshot {
  readonly components: readonly ComponentSnapshot[]
  readonly validation: ValidationResult
  /**
   * 外部事实来源(控制台必须明示):
   * manual_snapshot = 全部手抄;github_sync = 全部来自同步;
   * mixed = 混源 —— 不许把部分同步的快照整体自称机器核验。
   */
  readonly factsSource: 'manual_snapshot' | 'github_sync' | 'mixed'
}

export function buildProductMapSnapshot(
  facts: ExternalFacts = MANUAL_FACTS_SNAPSHOT,
): ProductMapSnapshot {
  const components = PRODUCT_MAP_COMPONENTS
  const blocked = propagateBlocked(components)
  const snapshots = components.map((component) => ({
    component,
    maturity: deriveMaturity(component, facts),
    operational: deriveOperationalSnapshot(component, facts),
    neighbours: neighboursOf(component.id, components),
    inheritedBlockedBy: blocked.get(component.id) ?? [],
  }))
  const sources = Object.values(facts.pullRequests).map((f) => f.source)
  const factsSource =
    sources.length > 0 && sources.every((s) => s === 'github_sync')
      ? 'github_sync'
      : sources.some((s) => s === 'github_sync')
        ? 'mixed'
        : 'manual_snapshot'
  return {
    components: snapshots,
    validation: validateRegistry(components, facts),
    factsSource,
  }
}

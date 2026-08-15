/**
 * ME2 Product Map v1 —— 动态事实的推导层（Issue #974，PR1 只定义接口）。
 *
 * 🔴 本文件**不含任何硬编码的当前事实**。它定义四个证据源的形状，
 *    并在没有接上证据源时一律返回 `unknown`。
 *    「查不到」必须是 `unknown`，**不许补 `no`，更不许补 `yes`**
 *    （WP00 §2 附加规则 1）。
 *
 * 🔴 PR1 不实现真正的探针。四个 provider 都是接口：
 *    - `github` —— main SHA / merged / checks（`github-adapter.ts` 已有只读实现）
 *    - `codeScan` —— main 代码里有没有真实调用方
 *    - `productionObjects` —— 生产库里表/列/函数**在不在**（不是 migration 文件在不在）
 *    - `runtimeObservation` —— 生产里有没有跑过、有没有可归因 outcome
 *    PR2/PR3 才接真实实现。在那之前，Dashboard 显示的就是一整片 `unknown`，
 *    这是**正确**的显示结果，不是缺陷。
 */

import type {
  ComponentAssessment,
  EvidenceStatus,
  MaturitySignals,
  OperationalCheck,
  OperationalSnapshot,
  RegistryComponent,
} from './types'
import { ALL_UNKNOWN_SIGNALS, deriveMaturity } from './maturity'

/** 没接证据源时的统一答案。 */
export const UNVERIFIED: OperationalCheck = Object.freeze({
  status: 'unknown' as const,
  evidenceSource: 'not-wired',
  checkedAt: null,
})

/** 构造一条已核对过的检查结果 —— `checkedAt` 是必填，逼调用方交代时间。 */
export function checked(
  status: EvidenceStatus,
  evidenceSource: string,
  checkedAt: string,
  note?: string,
): OperationalCheck {
  return Object.freeze(note === undefined
    ? { status, evidenceSource, checkedAt }
    : { status, evidenceSource, checkedAt, note })
}

/**
 * 四个只读证据源。全部可选 —— 没给就是 `unknown`。
 *
 * 每个探针只回答**一个**问题，且必须自报 `evidenceSource` 与 `checkedAt`；
 * 探针自己查不到时也要返回 `unknown`，不许替调用方猜。
 */
export interface EvidenceProviders {
  /** ① 代码在 main 吗。 */
  readonly codeInMain?: (component: RegistryComponent) => OperationalCheck
  /** ② 生产前置对象**存在性**（`to_regclass` / `information_schema` / `pg_proc`）。 */
  readonly productionPrerequisites?: (component: RegistryComponent) => OperationalCheck
  /** ③ main 代码里有没有真实调用方（排除测试）。 */
  readonly realCaller?: (component: RegistryComponent) => OperationalCheck
  /** ④ 生产里有没有观察到运行。 */
  readonly productionRun?: (component: RegistryComponent) => OperationalCheck
  /** M1：冻结契约文档在 main 中是否存在（由 `contractSpecPaths` 推导）。 */
  readonly contractFrozen?: (component: RegistryComponent) => OperationalCheck
  /** M2 的另一半：目标测试是否通过。 */
  readonly targetedTests?: (component: RegistryComponent) => OperationalCheck
  /** M5：是否有重复且可归因的 outcome。 */
  readonly repeatedAttributableOutcome?: (component: RegistryComponent) => OperationalCheck
}

const run = (
  probe: ((component: RegistryComponent) => OperationalCheck) | undefined,
  component: RegistryComponent,
): OperationalCheck => (probe ? probe(component) : UNVERIFIED)

/**
 * 「四问」快照。没接探针的那一问就是 `unknown` —— 不做任何回退猜测。
 */
export function buildOperationalSnapshot(
  component: RegistryComponent,
  providers: EvidenceProviders = {},
): OperationalSnapshot {
  return {
    codeInMain: run(providers.codeInMain, component),
    productionPrerequisitesExist: run(providers.productionPrerequisites, component),
    realCallerWired: run(providers.realCaller, component),
    productionRunObserved: run(providers.productionRun, component),
  }
}

/**
 * 六道成熟度信号。
 *
 * 其中四道直接复用四问的答案（同一个事实不查两遍、也不许两处给出不同结论）：
 * - `mergedToMain`  ← 四问①
 * - `realIntegration` ← 四问③
 * - `productionRun` ← 四问④
 * 另外三道有各自的探针。
 *
 * ⚠️ 四问与 M0–M5 **共享证据但不互相换算**：四问答「现在在不在跑」，
 *    M0–M5 答「做到哪一步了」。M1（契约冻结）在四问里根本没有对应项。
 */
export function deriveMaturitySignals(
  component: RegistryComponent,
  snapshot: OperationalSnapshot,
  providers: EvidenceProviders = {},
): MaturitySignals {
  return {
    contractFrozen: run(providers.contractFrozen, component).status,
    mergedToMain: snapshot.codeInMain.status,
    targetedTestsPassing: run(providers.targetedTests, component).status,
    realIntegration: snapshot.realCallerWired.status,
    productionRun: snapshot.productionRunObserved.status,
    repeatedAttributableOutcome: run(providers.repeatedAttributableOutcome, component).status,
  }
}

/** 组装一次完整评估。不传 providers 时返回全 `unknown` —— 这是诚实的默认值。 */
export function assessComponent(
  component: RegistryComponent,
  providers: EvidenceProviders = {},
): ComponentAssessment {
  const operational = buildOperationalSnapshot(component, providers)
  const maturitySignals = deriveMaturitySignals(component, operational, providers)
  return {
    componentId: component.componentId,
    operational,
    maturitySignals,
    maturity: deriveMaturity(maturitySignals),
  }
}

/** 全 `unknown` 的快照 —— 未接证据源时 Dashboard 应该显示的东西。 */
export const UNVERIFIED_SNAPSHOT: OperationalSnapshot = Object.freeze({
  codeInMain: UNVERIFIED,
  productionPrerequisitesExist: UNVERIFIED,
  realCallerWired: UNVERIFIED,
  productionRunObserved: UNVERIFIED,
})

export { ALL_UNKNOWN_SIGNALS }

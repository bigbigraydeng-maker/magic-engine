/**
 * 四问运营快照 —— PO 看的运营真相（Issue #974 / Build Control Room 2026-08-15
 * 05:43 复审 Blocker 4）：code in main? / production prerequisites exist? /
 * real caller wired? / production run observed?
 *
 * 不替代 M0–M5（types.ts 顶部注释）：M0/M1 仍表达"只有想法/契约已冻结"，
 * M5 仍要求重复运行与可归因 outcome。
 *
 * 四问与 deriveMaturity（maturity.ts）读同一组证据 —— contractEvidence /
 * integrationEvidence / productionEvidence / currentBlockers /
 * linkedPullRequests + ExternalFacts，不建第二套手抄真值。
 *
 * 三条铁律：
 * - 没有对应探针可跑 = unknown，不是 no；
 * - no 必须来自明确的负向信号（显式非 merged 的 PR 状态 / provisioning blocker /
 *   明确写"零调用方"的 blocker / operationalStatus='not_operating'）；
 * - 本文件只读结构化证据字段，不读 description 之类的自由文本 —— 天然满足
 *   "docs/Issue 只能是线索，不能单独把格子填成 yes"。
 */

import type { ExternalFacts } from './external-facts'
import type { ProductMapComponent } from './types'
import { isValidObservationDay } from './maturity'

export const PROBE_STATUS = ['yes', 'no', 'unknown'] as const
export type ProbeStatus = (typeof PROBE_STATUS)[number]

export interface OperationalProbe {
  readonly status: ProbeStatus
  /**
   * B4：可审计的**证据身份指针**，不是散文结论。形如 `#962`（PR 号）/
   * `production_run:<ref>` / `importer:<path>` / `blocker:<id>` / `operationalStatus:<值>`。
   */
  readonly evidenceSource: string
  /**
   * YYYY-MM-DD 的机器核验日期。
   * 🔴 B3：`status==='yes'` ⟹ 此值**必非 null**，且证据必须是**机器核验**的
   *    （evidence.verification ∈ {repo_verified, sync_verified}，或 PR fact.source==='github_sync'）——
   *    人工手填的 manual_claim / manual_snapshot 即便带了日期也只判 unknown（见 machineYes / pendingUnknown）。
   *    `no`（来自已登记 blocker / operationalStatus 的结构性负向信号）与 `unknown` 允许 null。
   */
  readonly checkedAt: string | null
}

export interface OperationalSnapshot {
  readonly componentId: string
  readonly codeInMain: OperationalProbe
  readonly productionPrerequisitesExist: OperationalProbe
  readonly realCallerWired: OperationalProbe
  readonly productionRunObserved: OperationalProbe
}

/** 只认这几种明确写出"零调用方"的措辞；查不到不等于查到了"没有"。 */
const NO_CALLER_PATTERN = /零\s*(个\s*)?(importer|调用方|caller)|没有(任何)?调用方|未接(入|线)|电没通/

/**
 * B3（Codex 复审收紧）：什么才算"机器证据"。
 * 🔴 `manual_claim` 是人工手填的声明，**不是机器核验** —— 哪怕它带了 observedAt，
 *    也只是"人手写了个日期"，不能把运营格判成 yes。只有 registry.test 对磁盘核验过
 *    （repo_verified）或 GitHub 同步核验过（sync_verified）才算。
 */
const MACHINE_VERIFICATIONS: ReadonlySet<string> = new Set(['repo_verified', 'sync_verified'])
function isMachineVerified(e: { verification: string; observedAt?: string }): boolean {
  // Codex 复审：observedAt 必须是**真实日历日**（复用 maturity 的严格校验）——
  // 'foo' / 无效日期这类脏值不许当 checkedAt 塞进一个 yes，破坏 OperationalProbe 契约。
  return MACHINE_VERIFICATIONS.has(e.verification) && isValidObservationDay(e.observedAt)
}
/**
 * 在一组证据里找**第一条机器核验且带日期**的（Codex 复审：不固定取第一条 ——
 * 数组里可能第一条是无日期的旧声明、后面才有合格的那条）。
 */
function firstMachineVerified<E extends { verification: string; observedAt?: string }>(
  list: readonly E[],
): E | null {
  return list.find(isMachineVerified) ?? null
}

/** 一条 yes（机器核验 + 带日期）；调用方已保证 checkedAt 非 null。 */
function machineYes(evidenceSource: string, checkedAt: string): OperationalProbe {
  return { status: 'yes', evidenceSource, checkedAt }
}
/** 有声明但都不是机器核验 → 诚实标 unknown「等机器核验」，不编 yes。 */
function pendingUnknown(evidenceSource: string): OperationalProbe {
  return { status: 'unknown', evidenceSource: `${evidenceSource}（仅人工声明，等机器核验）`, checkedAt: null }
}

function deriveCodeInMain(c: ProductMapComponent, facts: ExternalFacts): OperationalProbe {
  if (c.origin === 'legacy') {
    // ownedPaths 存在于磁盘 ≠ 带日期地证明它在 main。没有 GitHub 同步事实 → unknown。
    return {
      status: 'unknown',
      evidenceSource: 'legacy: 无 GitHub 同步事实可确认 main 归属（PR2 起提供带日期的 sync fact）',
      checkedAt: null,
    }
  }

  const implementsPrs = c.linkedPullRequests.filter((pr) => pr.role === 'implements')
  if (implementsPrs.length === 0) {
    return { status: 'unknown', evidenceSource: '未登记 role=implements 的 PR', checkedAt: null }
  }
  // yes 三个硬前提缺一不可：机器同步来源（source==='github_sync'）+ 日期合法 +
  // 目标分支确为 main（baseRef==='main'）。合并到 staging / 功能分支不能宣称代码进了 main；
  // manual_snapshot 是人工快照也不算。任一不满足 → 记为"有合并声明但未证明进 main"。
  let mergedUnproven: OperationalProbe | null = null
  for (const pr of implementsPrs) {
    const fact = facts.pullRequests[pr.number]
    if (fact?.state === 'merged') {
      if (fact.source === 'github_sync' && isValidObservationDay(fact.observedAt) && fact.baseRef === 'main') {
        return machineYes(`#${pr.number}`, fact.observedAt)
      }
      // 只记第一条即可（都无法证明进 main）。区分两种未证明来路，措辞如实：
      // 机器同步但合到非 main 分支（或缺 baseRef）≠ 人工快照，不能套「仅人工声明」的话术。
      if (mergedUnproven === null) {
        mergedUnproven =
          fact.source === 'github_sync'
            ? {
                status: 'unknown',
                evidenceSource: `#${pr.number} 合并到 ${fact.baseRef ?? '未知分支'}（非 main），不能确认代码进 main`,
                checkedAt: null,
              }
            : pendingUnknown(`#${pr.number} 合并（人工快照）`)
      }
    }
  }
  // Codex 复审：只要**存在**一条合并声明，就不能判"确定的 no" —— 它证明不了 yes，
  // 但也意味着无法确定代码不在 main → unknown（缺 baseRef / 合到非 main 分支同理，fail-safe）。
  if (mergedUnproven !== null) return mergedUnproven
  // 没有任何合并声明，才看有没有明确的非合并机器事实 → no
  for (const pr of implementsPrs) {
    const fact = facts.pullRequests[pr.number]
    if (fact !== undefined && fact.state !== 'merged') {
      return { status: 'no', evidenceSource: `#${pr.number}`, checkedAt: fact.observedAt ?? null }
    }
  }
  return { status: 'unknown', evidenceSource: 'PR 状态未同步（ExternalFacts 查无此 PR）', checkedAt: null }
}

function deriveProductionPrerequisites(c: ProductMapComponent): OperationalProbe {
  const provisioning = c.currentBlockers.find((b) => b.kind === 'provisioning')
  if (provisioning) {
    // 已登记的结构性负向信号：身份 = blocker id，允许 checkedAt=null
    return { status: 'no', evidenceSource: `blocker:${provisioning.id}`, checkedAt: null }
  }
  const dataList = c.productionEvidence.filter((e) => e.kind === 'production_data')
  const ok = firstMachineVerified(dataList)
  if (ok) return machineYes(`production_data:${ok.ref}`, ok.observedAt as string)
  if (dataList.length > 0) return pendingUnknown(`production_data:${dataList[0].ref}`)
  return { status: 'unknown', evidenceSource: '未登记 provisioning blocker 或 production_data 证据', checkedAt: null }
}

function deriveRealCallerWired(c: ProductMapComponent): OperationalProbe {
  const ok = firstMachineVerified(c.integrationEvidence)
  if (ok) return machineYes(`${ok.kind}:${ok.ref}`, ok.observedAt as string)
  const negative = c.currentBlockers.find((b) => NO_CALLER_PATTERN.test(b.summary))
  if (negative) {
    return { status: 'no', evidenceSource: `blocker:${negative.id}`, checkedAt: null }
  }
  if (c.integrationEvidence.length > 0) return pendingUnknown(`${c.integrationEvidence[0].kind}:${c.integrationEvidence[0].ref}`)
  return { status: 'unknown', evidenceSource: '未登记 integrationEvidence，也无明确负向 blocker', checkedAt: null }
}

function deriveProductionRunObserved(c: ProductMapComponent): OperationalProbe {
  if (c.origin === 'me2_native') {
    const runList = c.productionEvidence.filter((e) => e.kind === 'production_run')
    const ok = firstMachineVerified(runList)
    if (ok) return machineYes(`production_run:${ok.ref}`, ok.observedAt as string)
    // 有 run 声明但没机器核验 → unknown。**先于 not_operating 判**：这一问是"生产
    // 曾经跑过吗"，一条 run 声明（哪怕没核验）意味着"不是确定没跑过"；而 not_operating
    // 说的是"当前没在运营"，是另一回事，不能拿它把一条 run 声明压成 no。
    if (runList.length > 0) return pendingUnknown(`production_run:${runList[0].ref}`)
    if (c.operationalStatus === 'not_operating') {
      return { status: 'no', evidenceSource: 'operationalStatus:not_operating', checkedAt: null }
    }
    return { status: 'unknown', evidenceSource: '未登记 production_run 证据', checkedAt: null }
  }
  // legacy：legacyOperationalNote 是静态声明，非机器核验 —— Blocker 3 明确它不能单独把
  // 运营格变成 yes。operating_legacy → unknown（有声明但无带日期核验）；
  // not_operating 是明确负向 → no。
  if (c.operationalStatus === 'not_operating') {
    return { status: 'no', evidenceSource: 'operationalStatus:not_operating', checkedAt: null }
  }
  if (c.operationalStatus === 'operating_legacy') {
    return {
      status: 'unknown',
      evidenceSource: c.legacyOperationalNote
        ? 'operationalStatus:operating_legacy（legacyOperationalNote 是静态声明，无带日期核验）'
        : 'operationalStatus:operating_legacy（未登记 legacyOperationalNote）',
      checkedAt: null,
    }
  }
  return { status: 'unknown', evidenceSource: 'operationalStatus 未提供可判定信号', checkedAt: null }
}

export function deriveOperationalSnapshot(
  component: ProductMapComponent,
  facts: ExternalFacts,
): OperationalSnapshot {
  return {
    componentId: component.id,
    codeInMain: deriveCodeInMain(component, facts),
    productionPrerequisitesExist: deriveProductionPrerequisites(component),
    realCallerWired: deriveRealCallerWired(component),
    productionRunObserved: deriveProductionRunObserved(component),
  }
}

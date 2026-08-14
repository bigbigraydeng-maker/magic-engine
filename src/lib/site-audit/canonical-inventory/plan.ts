/**
 * Magic Engine 2.0 · 计划核心的组装（Issue #930 · #960 冻结版）
 *
 * 🔴 这一步**不写任何东西**。它只把「发现到的原始 URL」翻译成一份可复核的清单：
 *    每条候选带 原始 URL / canonical URL / 机器决策 / 原因码 / 归一留痕。
 *
 * 🔴 生成阶段**造不出一条 `accepted`** —— `MachineDecision` 只有 `pending` / `rejected`。
 *    「发现即接受」在类型层就没有入口，而 #930 时代那条「预置 accepted 再重算哈希」
 *    的绕过路径也随之消失。
 *
 * 🔴 这里**不再有** `acknowledgedIncompleteHosts` 入参。它当时是生成入参，
 *    自动化调用方可以自己补上，那道「0 条 / 出错必须有人认」的闸对脚本形同虚设。
 *    #960 把认账移到 `ReviewSubmission.acknowledgements`（要求署名 + 写理由）。
 *
 * 🔴 这里也**不再算 `planHash`**。计划的身份由 L1 信封的 `generationDigest` 承担 ——
 *    那是一个带密钥签名保护的锚点，而 `planHash` 是公开函数算的，谁都能重算。
 */

import { compareStrings } from './canonical-json'
import { INVENTORY_PLAN_CONTRACT_VERSION, NORMALIZATION_RULE_VERSION } from './types'
import type {
  DiscoveryOutcome,
  GeneratedPlanCore,
  GeneratedPlanCounts,
  HostBoundary,
  HostDiscoverySummary,
  MachineCandidate,
} from './types'
import { canonicaliseUrl, normaliseApprovedHosts } from './url-rules'

export class InventoryPlanError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InventoryPlanError'
    this.code = code
  }
}

export interface BuildInventoryPlanInput {
  readonly clientId: string
  /** 通常来自 `clients.domain`。只记录，不参与同源判定。 */
  readonly requestedDomain: string
  /** 被显式批准的精确主机名。不推断、不补 www。 */
  readonly approvedHosts: readonly string[]
  /**
   * 一次逐主机发现的**完整结果**（`discoverCandidateUrls()` 的返回值原样传进来）。
   *
   * 🔴 打包成一个值，不是 `urls` + `perHost` 两个独立入参 ——
   *    两个入参可以来自两次不同的发现，而合并后的清单看不出这件事。
   */
  readonly discovery: DiscoveryOutcome
}

/**
 * 生成一份无写入的候选计划核心。
 *
 * 撞车处理：归一后指向同一个 canonical URL 的多条原始 URL，**按原始 URL 字典序**留第一条，
 * 其余记 `duplicate_canonical_target` 并指回留下的那条。
 * 用字典序而不是「先发现的那条」，是因为发现顺序取决于 sitemap / BFS 的偶然性，
 * 同一个站两次跑可能给出不同的主候选 —— 那样 digest 就不稳定了。
 */
export function buildInventoryPlan(input: BuildInventoryPlanInput): GeneratedPlanCore {
  if (input.clientId.trim().length === 0) {
    throw new InventoryPlanError('missing_client_id', '生成计划必须带租户 client_id')
  }
  if (input.requestedDomain.trim().length === 0) {
    throw new InventoryPlanError('missing_domain', '生成计划必须带目标域名')
  }
  const approvedHosts = normaliseApprovedHosts(input.approvedHosts)
  const boundary: HostBoundary = { requestedDomain: input.requestedDomain.trim(), approvedHosts }

  const discovery = summariseDiscovery(input.discovery.perHost, approvedHosts)
  assertDiscoveryMatchesCandidates(discovery, input.discovery.urls)

  const uniqueOriginals = Array.from(
    new Set(input.discovery.urls.map((u) => u.trim()).filter((u) => u.length > 0)),
  ).sort(compareStrings)
  const candidates = buildCandidates(uniqueOriginals, boundary)

  return {
    contractVersion: INVENTORY_PLAN_CONTRACT_VERSION,
    normalizationRuleVersion: NORMALIZATION_RULE_VERSION,
    clientId: input.clientId.trim(),
    boundary,
    discovery,
    candidates,
    counts: countMachineCandidates(candidates),
  }
}

/**
 * 把逐主机发现结果核对并定型。
 *
 * 🔴 发现结果必须逐个覆盖批准主机 —— 少一个就是那个站根本没被找过，
 *    而合并后的 URL 清单看不出这件事。
 *
 * 0 条 / 出错的主机在这里**不再抛**：它们如实记进 core 并被签名保护，
 * 由复核人在 `acknowledgements` 里署名认账（见 `review.ts`）。
 */
function summariseDiscovery(
  perHost: readonly HostDiscoverySummary[],
  approvedHosts: readonly string[],
): readonly HostDiscoverySummary[] {
  const seen = new Map<string, HostDiscoverySummary>()
  for (const row of perHost) {
    const host = row.host.trim().toLowerCase()
    if (seen.has(host)) {
      throw new InventoryPlanError('duplicate_discovery_host', `发现结果里主机 ${host} 出现了多次`)
    }
    seen.set(host, { host, count: row.count, foreignCount: row.foreignCount ?? 0, error: row.error })
  }
  return approvedHosts.map((host) => {
    const row = seen.get(host)
    if (row === undefined) {
      throw new InventoryPlanError(
        'discovery_host_missing',
        `批准了主机 ${host}，但发现结果里没有它 —— 那个站根本没被找过，合并后的 URL 清单看不出这件事`,
      )
    }
    return row
  })
}

/**
 * 发现摘要里声称的条数，必须跟实际的候选清单对得上（按精确主机名分别数）。
 *
 * 🔴 生成时这道闸抓的是 bug（两个字段来自同一次发现，对不上就是发现器算错了）；
 *    复核前再跑一遍（`assertCoreIntact`）抓的是纵深 —— L1 已经把内容钉死，
 *    但一份**手写**的 core 没有任何东西能证明它来自 `buildInventoryPlan`。
 */
export function assertDiscoveryMatchesCandidates(
  discovery: readonly HostDiscoverySummary[],
  discoveredUrls: readonly string[],
): void {
  const unique = new Set(discoveredUrls.map((u) => u.trim()).filter((u) => u.length > 0))
  const actual = new Map<string, number>()
  for (const url of Array.from(unique)) {
    let host: string
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      continue // 畸形 URL 由候选层记原因码，不参与这里的对账
    }
    actual.set(host, (actual.get(host) ?? 0) + 1)
  }
  for (const row of discovery) {
    const seen = actual.get(row.host) ?? 0
    if (seen !== row.count) {
      throw new InventoryPlanError(
        'discovery_count_mismatch',
        `主机 ${row.host} 的发现摘要说有 ${row.count} 条，实际候选里属于它的有 ${seen} 条 —— ` +
          '两边对不上，说明摘要和清单不是同一次发现的产物（或者清单在传参时被截断了）',
      )
    }
  }
}

/**
 * 把去重排序后的原始 URL 逐条翻成候选。
 *
 * 规则过不去的记 `rejected` + 原因码；撞车的记 `duplicate_canonical_target` 并指回留下的那条；
 * 其余一律 `pending`（等人判）。**一条都不丢** —— 审计要能解释每个发现到的 URL 去哪了。
 */
export function buildCandidates(
  originals: readonly string[],
  boundary: HostBoundary,
): MachineCandidate[] {
  const claimed = new Map<string, string>() // canonicalUrl → 留下的那条 originalUrl
  const candidates: MachineCandidate[] = []

  for (const originalUrl of originals) {
    const result = canonicaliseUrl(originalUrl, boundary)
    if (!result.ok) {
      candidates.push({
        originalUrl,
        canonicalUrl: null,
        machineDecision: 'rejected',
        reasonCodes: result.reasonCodes,
        notes: result.notes,
      })
      continue
    }
    const primary = claimed.get(result.canonicalUrl)
    if (primary !== undefined) {
      candidates.push({
        originalUrl,
        canonicalUrl: result.canonicalUrl,
        machineDecision: 'rejected',
        reasonCodes: ['duplicate_canonical_target'],
        notes: result.notes,
        duplicateOf: primary,
      })
      continue
    }
    claimed.set(result.canonicalUrl, originalUrl)
    candidates.push({
      originalUrl,
      canonicalUrl: result.canonicalUrl,
      machineDecision: 'pending',
      reasonCodes: [],
      notes: result.notes,
    })
  }
  return candidates
}

export function countMachineCandidates(candidates: readonly MachineCandidate[]): GeneratedPlanCounts {
  return {
    discovered: candidates.length,
    pending: candidates.filter((c) => c.machineDecision === 'pending').length,
    rejected: candidates.filter((c) => c.machineDecision === 'rejected').length,
  }
}

// ---------------------------------------------------------------------------
// 纵深校验：这份 core「还是机器生成出来的那一份」吗
// ---------------------------------------------------------------------------

/**
 * 拿 core 里的原始 URL 把整份机器候选重新构造一遍，逐字段比对；再核对发现摘要与计数。
 *
 * 🔴 **这已经不是主闸了。** 主闸是 L1 签名：编辑者改任何一个字段都签不回去。
 *    这一整套「重新推导再对账」保留下来的理由只有一条 —— 没有任何东西能证明
 *    一份**手写**的 core 真的来自 `buildInventoryPlan()`（比如未来某个内部调用方
 *    自己拼了一份再去签）。它挡的是自己人写错，不是编辑者篡改。
 */
export function assertCoreIntact(core: GeneratedPlanCore): void {
  assertVersions(core)
  assertDiscoveryCoverage(core)
  assertDiscoveryMatchesCandidates(
    core.discovery,
    core.candidates.map((c) => c.originalUrl),
  )
  assertCandidatesMachineDerived(core)
  assertCountsMachineDerived(core)
}

function assertVersions(core: GeneratedPlanCore): void {
  if (core.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {
    throw new InventoryPlanError(
      'contract_version_mismatch',
      `计划契约版本是 ${core.contractVersion}，当前代码是 ${INVENTORY_PLAN_CONTRACT_VERSION} —— 重新生成，别在旧结构上盖新章`,
    )
  }
  if (core.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {
    throw new InventoryPlanError(
      'rule_version_mismatch',
      `计划按 ${core.normalizationRuleVersion} 归一，当前代码是 ${NORMALIZATION_RULE_VERSION} —— 规则变了必须重新生成并重新复核`,
    )
  }
}

/** 发现记录与批准主机必须一一对应。 */
function assertDiscoveryCoverage(core: GeneratedPlanCore): void {
  const hosts = core.discovery.map((d) => d.host)
  const approved = [...core.boundary.approvedHosts].sort(compareStrings).join('|')
  if ([...hosts].sort(compareStrings).join('|') !== approved) {
    throw new InventoryPlanError(
      'discovery_coverage_mismatch',
      `发现记录覆盖的主机是 [${hosts.join(', ')}]，批准的是 [${core.boundary.approvedHosts.join(', ')}] —— 对不上`,
    )
  }
}

/**
 * 拿 core 里的原始 URL 重新跑一遍 `buildCandidates()`，结果必须与 core 里的候选**逐字段相等**。
 *
 * 顺序也要一致：主候选的选取依赖字典序，顺序被打乱意味着撞车关系可能被换过。
 */
function assertCandidatesMachineDerived(core: GeneratedPlanCore): void {
  const approvedHosts = normaliseApprovedHosts(core.boundary.approvedHosts)
  const originals = core.candidates.map((c) => c.originalUrl)
  if (new Set(originals).size !== originals.length) {
    throw new InventoryPlanError('duplicate_original_url', '同一条原始 URL 在计划里出现了多次 —— 机器不会这么生成')
  }
  const rebuilt = buildCandidates([...originals].sort(compareStrings), {
    requestedDomain: core.boundary.requestedDomain,
    approvedHosts,
  })
  for (let i = 0; i < rebuilt.length; i++) {
    const diff = firstFieldDifference(core.candidates[i], rebuilt[i])
    if (diff !== null) {
      throw new InventoryPlanError(
        'candidate_not_machine_derived',
        `候选 ${core.candidates[i].originalUrl} 的「${diff}」跟机器重新生成的结果对不上 —— 这一份不是机器刚产出的那一份`,
      )
    }
  }
}

/** `counts` 必须是当前候选用 `countMachineCandidates()` 重新数出来的那一份。 */
function assertCountsMachineDerived(core: GeneratedPlanCore): void {
  const expected = countMachineCandidates(core.candidates)
  const actual = core.counts
  if (
    actual.discovered !== expected.discovered ||
    actual.pending !== expected.pending ||
    actual.rejected !== expected.rejected
  ) {
    throw new InventoryPlanError(
      'counts_not_machine_derived',
      `计划自带的计数（发现 ${actual.discovered} / 待判 ${actual.pending} / 已拒 ${actual.rejected}）` +
        `跟拿当前候选清单重新数出来的（发现 ${expected.discovered} / 待判 ${expected.pending} / ` +
        `已拒 ${expected.rejected}）对不上 —— 最常见的原因是候选被整条删掉、却没有同步改计数`,
    )
  }
}

/** 返回第一个对不上的字段名；全都一致返回 `null`。 */
function firstFieldDifference(actual: MachineCandidate, expected: MachineCandidate): string | null {
  if (actual.originalUrl !== expected.originalUrl) return 'originalUrl'
  if (actual.canonicalUrl !== expected.canonicalUrl) return 'canonicalUrl'
  if (actual.machineDecision !== expected.machineDecision) return 'machineDecision'
  if ((actual.duplicateOf ?? null) !== (expected.duplicateOf ?? null)) return 'duplicateOf'
  if (!sameStringList(actual.reasonCodes, expected.reasonCodes)) return 'reasonCodes'
  if (!sameStringList(actual.notes, expected.notes)) return 'notes'
  return null
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * ISO 8601 时间戳校验。
 *
 * 🔴 「非空字符串」不够：`reviewedAt: 'not-a-date'` 照样能签，
 *    留下一条**排不了序、也证明不了复核时间**的凭据。
 *
 * 🔴 **必须带显式时区**（`Z` 或 `±HH:MM`）。上一版拿「解析回来的 UTC 日期前 10 位」
 *    跟原串比，于是 `2026-08-12T05:00:00`（无时区）在 UTC+12 折算后日期退一天，
 *    一个完全正常的本地时间写法被判非法 —— 而目标市场恰好是 NZ/AU。
 *    要求显式时区比「猜它是哪个时区」正确：一条证明不了自己是几点的凭据，
 *    在审计里跟没有时间戳没区别。
 */
const ISO_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

export function assertValidIsoTimestamp(value: string, label: string): void {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length === 0) {
    throw new InventoryPlanError('missing_timestamp', `${label}必须带时间戳`)
  }
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed) || !ISO_WITH_TIMEZONE.test(trimmed)) {
    throw new InventoryPlanError(
      'invalid_timestamp',
      `${label}「${value}」不是带显式时区的 ISO 8601 时间戳（要 Z 或 ±HH:MM）—— ` +
        '排不了序也证明不了时间',
    )
  }
}

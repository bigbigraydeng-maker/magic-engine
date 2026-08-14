/**
 * Magic Engine 2.0 · 台账计划的组装与复核（Issue #930 · WP05 前置）
 *
 * 🔴 这一步**不写任何东西**。它只把「发现到的原始 URL」翻译成一份可复核的清单：
 *    每条候选带 原始 URL / canonical URL / 决策 / 原因码 / 归一留痕，
 *    整份计划带 规则版本 + 确定性哈希。
 *
 * 🔴 计划刚生成时**没有一条是 accepted** —— 合规候选一律 `pending`，等人判。
 *    「发现即接受」正是 #930 要修的那件事。
 */

import { createHash } from 'crypto'
import {
  INVENTORY_PLAN_CONTRACT_VERSION,
  NORMALIZATION_RULE_VERSION,
  type CanonicalInventoryPlan,
  type CandidateDecision,
  type HostBoundary,
  type HostDiscoverySummary,
  type InventoryCandidate,
  type InventoryPlanCounts,
  type PlanReview,
  type RejectionReasonCode,
  type ReviewedInventoryPlan,
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
  /** 发现阶段拿到的原始 URL（复用现有 `discoverSitemapUrls`）。 */
  readonly discoveredUrls: readonly string[]
  /**
   * 逐主机发现结果（`discoverCandidateUrls()` 的 `perHost`）。
   *
   * 🔴 必须逐个覆盖 `approvedHosts`。少一个主机 = 那个站根本没被找过，
   *    而合并后的 URL 清单看不出这件事。
   */
  readonly discovery: readonly {
    readonly host: string
    readonly count: number
    readonly foreignCount?: number
    readonly error: string | null
  }[]
  /**
   * 明确认过的「不完整发现」主机。
   *
   * 某个主机 0 条或出错时，**必须**在这里列出来才生得成计划 ——
   * 否则一份缺了整个站的台账会一路顺畅地走到激活。
   */
  readonly acknowledgedIncompleteHosts?: readonly string[]
}

/**
 * 生成一份无写入的候选计划。
 *
 * 撞车处理：归一后指向同一个 canonical URL 的多条原始 URL，**按原始 URL 字典序**留第一条，
 * 其余记 `duplicate_canonical_target` 并指回留下的那条。
 * 用字典序而不是「先发现的那条」，是因为发现顺序取决于 sitemap / BFS 的偶然性，
 * 同一个站两次跑可能给出不同的主候选 —— 那样计划哈希就不稳定了。
 */
export function buildInventoryPlan(input: BuildInventoryPlanInput): CanonicalInventoryPlan {
  if (input.clientId.trim().length === 0) {
    throw new InventoryPlanError('missing_client_id', '生成计划必须带租户 client_id')
  }
  if (input.requestedDomain.trim().length === 0) {
    throw new InventoryPlanError('missing_domain', '生成计划必须带目标域名')
  }
  const approvedHosts = normaliseApprovedHosts(input.approvedHosts)
  const boundary: HostBoundary = { requestedDomain: input.requestedDomain.trim(), approvedHosts }

  const discovery = summariseDiscovery(input, approvedHosts)
  assertDiscoveryMatchesCandidates(discovery, input.discoveredUrls)
  const uniqueOriginals = Array.from(new Set(input.discoveredUrls.map((u) => u.trim()).filter((u) => u.length > 0)))
  uniqueOriginals.sort(compareStrings)

  return finalisePlan({
    clientId: input.clientId.trim(),
    boundary,
    discovery,
    candidates: buildCandidates(uniqueOriginals, boundary),
    review: null,
  })
}

/**
 * 把逐主机发现结果核对并定型。
 *
 * 🔴 两道硬闸：
 *    1. 发现结果必须逐个覆盖批准主机 —— 少一个就是那个站根本没被找过；
 *    2. 0 条 / 出错的主机必须被**显式认过**，否则计划生不出来。
 *       0 条可能是站是空的、也可能被 WAF 挡了，长得一模一样，只能由人来分。
 */
function summariseDiscovery(
  input: BuildInventoryPlanInput,
  approvedHosts: readonly string[],
): readonly HostDiscoverySummary[] {
  const seen = new Map<string, { count: number; foreignCount: number; error: string | null }>()
  for (const row of input.discovery) {
    const host = row.host.trim().toLowerCase()
    if (seen.has(host)) {
      throw new InventoryPlanError('duplicate_discovery_host', `发现结果里主机 ${host} 出现了多次`)
    }
    seen.set(host, { count: row.count, foreignCount: row.foreignCount ?? 0, error: row.error })
  }
  const acknowledged = new Set((input.acknowledgedIncompleteHosts ?? []).map((h) => h.trim().toLowerCase()))

  return approvedHosts.map((host) => {
    const row = seen.get(host)
    if (row === undefined) {
      throw new InventoryPlanError(
        'discovery_host_missing',
        `批准了主机 ${host}，但发现结果里没有它 —— 那个站根本没被找过，合并后的 URL 清单看不出这件事`,
      )
    }
    const incomplete = row.error !== null || row.count === 0
    const ack = acknowledged.has(host)
    if (incomplete && !ack) {
      throw new InventoryPlanError(
        'incomplete_discovery_not_acknowledged',
        `主机 ${host} 发现${row.error !== null ? `出错（${row.error}）` : '结果为 0 条'}。` +
          '这可能是站是空的，也可能是被挡住了 —— 必须有人明确认过才能继续，' +
          '否则会产出一份缺了整个站的台账，而缺页没有人会发现。',
      )
    }
    return {
      host,
      count: row.count,
      foreignCount: row.foreignCount,
      error: row.error,
      acknowledged: incomplete ? ack : false,
    }
  })
}

/**
 * 发现摘要里声称的条数，必须跟实际交进来的候选清单对得上（按精确主机名分别数）。
 *
 * 🔴 `discovery` 与 `discoveredUrls` 是**两个独立入参**。不核对的话，
 *    「摘要说 B 站有 1 页」＋「候选清单里一条 B 的都没有」可以同时成立 ——
 *    计划照样签得出来、激活照样成功，B 整个站缺席**且不需要任何人确认**，
 *    因为那道「0 条要有人认」的闸看的是摘要，而摘要说它不是 0。
 */
function assertDiscoveryMatchesCandidates(
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
        `主机 ${row.host} 的发现摘要说有 ${row.count} 条，实际交进来的候选里属于它的有 ${seen} 条 —— ` +
          '两个入参对不上，说明摘要和清单不是同一次发现的产物（或者清单在传参时被截断了）',
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
function buildCandidates(originals: readonly string[], boundary: HostBoundary): InventoryCandidate[] {
  const claimed = new Map<string, string>() // canonicalUrl → 留下的那条 originalUrl
  const candidates: InventoryCandidate[] = []

  for (const originalUrl of originals) {
    const result = canonicaliseUrl(originalUrl, boundary)
    if (!result.ok) {
      candidates.push({
        originalUrl,
        canonicalUrl: null,
        decision: 'rejected',
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
        decision: 'rejected',
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
      decision: 'pending',
      reasonCodes: [],
      notes: result.notes,
    })
  }
  return candidates
}

/** 人工决策只认这三个值。运行时逐字校验 —— 类型系统在反序列化边界上帮不了忙。 */
export const ALLOWED_REVIEW_DECISIONS: readonly Exclude<CandidateDecision, 'pending'>[] = [
  'accepted',
  'rejected',
  'defer',
]

export interface ReviewDecision {
  readonly decision: Exclude<CandidateDecision, 'pending'>
  /** 人工原因码；不给的话按决策自动补 `reviewer_rejected` / `reviewer_deferred`。 */
  readonly reasonCodes?: readonly RejectionReasonCode[]
}

export interface ApplyReviewInput {
  /** 按 **原始 URL** 索引的人工决策。 */
  readonly decisions: Readonly<Record<string, ReviewDecision>>
  readonly review: PlanReview
  /**
   * 对最终 `planHash` 签名。由持密钥的一方提供。
   *
   * 🔴 签名必须是**改文件的人算不出来**的东西 —— 自带的 SHA-256 谁都能重算，
   *    挡不住「改内容 + 自己重签」。这一层不碰密钥，只要求你给得出签名。
   */
  readonly sign: (planHash: string) => string
}

/**
 * 把人工决策盖到计划上，产出一份带签名与新哈希的复核计划。
 *
 * 🔴 规则自动拒掉的候选**不许被人改成 accepted**。畸形 URL / 未批准主机 / 撞车目标
 *    不是「见仁见智」，允许人工覆盖就等于允许绕过主机边界。
 * 🔴 复核必须覆盖到每一条 `pending` —— 漏判的会留在 `pending`，而激活闸拒收带 `pending` 的计划。
 */
export function applyReviewDecisions(
  plan: CanonicalInventoryPlan,
  input: ApplyReviewInput,
): ReviewedInventoryPlan {
  // 🔴 先验来料，再盖章。计划会以文件 / 界面形式在外面转一圈再回来，
  //    这里如果不验就直接 finalisePlan()，等于**替任意输入重新背书**：
  //    把某条候选的 canonical 从 /a 改成 /hacked 再批准，出来的是一份哈希完全自洽的计划，
  //    激活闸只会确认 /hacked 本身规范 —— 于是抓取并写入一个没人复核过的页面。
  //    旧规则版本生成的计划同理，不验就会被悄悄「升级」成当前规则。
  if (plan.review !== null) {
    throw new InventoryPlanError(
      'already_reviewed',
      '这份计划已经有复核签名了 —— 复核只盖一次章。要改决策就从新生成的计划重新走一遍。',
    )
  }
  assertPlanIntact(plan)
  if (input.review.reviewedBy.trim().length === 0) {
    throw new InventoryPlanError('missing_reviewer', '复核必须署名 —— 「谁批的」是这份计划唯一的授权凭据')
  }
  assertValidIsoTimestamp(input.review.reviewedAt)
  const candidates = applyDecisionsToCandidates(plan.candidates, input.decisions)

  const finalised = finalisePlan({
    clientId: plan.clientId,
    boundary: plan.boundary,
    discovery: plan.discovery,
    candidates,
    review: input.review,
  })
  const reviewSignature = input.sign(finalised.planHash)
  if (typeof reviewSignature !== 'string' || reviewSignature.trim().length === 0) {
    throw new InventoryPlanError('missing_signature', '复核签名是空的 —— 没有签名的计划等于没批过，不许产出')
  }
  return { ...finalised, review: input.review, reviewSignature }
}

/**
 * 计划哈希。
 *
 * 覆盖契约版本 / 规则版本 / 租户 / 边界 / 每条候选的全部身份字段 / 计数 / 复核签名。
 * 少盖任何一项，那一项就能在批准之后被悄悄改掉。
 */
export function computePlanHash(plan: Omit<CanonicalInventoryPlan, 'planHash'>): string {
  const payload = {
    contractVersion: plan.contractVersion,
    normalizationRuleVersion: plan.normalizationRuleVersion,
    clientId: plan.clientId,
    boundary: {
      requestedDomain: plan.boundary.requestedDomain,
      approvedHosts: [...plan.boundary.approvedHosts].sort(compareStrings),
    },
    discovery: [...plan.discovery]
      .map((d) => ({
        host: d.host,
        count: d.count,
        foreignCount: d.foreignCount ?? 0,
        error: d.error ?? null,
        acknowledged: d.acknowledged,
      }))
      .sort((a, b) => compareStrings(a.host, b.host)),
    candidates: plan.candidates.map((c) => ({
      originalUrl: c.originalUrl,
      canonicalUrl: c.canonicalUrl,
      decision: c.decision,
      reasonCodes: [...c.reasonCodes].sort(compareStrings),
      notes: [...c.notes].sort(compareStrings),
      duplicateOf: c.duplicateOf ?? null,
    })),
    counts: {
      discovered: plan.counts.discovered,
      pending: plan.counts.pending,
      accepted: plan.counts.accepted,
      rejected: plan.counts.rejected,
      deferred: plan.counts.deferred,
    },
    review: plan.review === null ? null : {
      reviewedBy: plan.review.reviewedBy,
      reviewedAt: plan.review.reviewedAt,
      note: plan.review.note ?? null,
    },
  }
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

/**
 * 把人工决策盖到候选上。
 *
 * 🔴 规则自动拒掉的候选不许被改成 accepted —— 主机边界与 URL 规则不是可商量的项。
 * 🔴 决策指向不存在的候选直接抛，防止复核文件与计划悄悄脱节。
 */
function applyDecisionsToCandidates(
  candidates: readonly InventoryCandidate[],
  decisions: Readonly<Record<string, ReviewDecision>>,
): InventoryCandidate[] {
  const known = new Set(candidates.map((c) => c.originalUrl))
  for (const url of Object.keys(decisions)) {
    if (!known.has(url)) {
      throw new InventoryPlanError('unknown_candidate', `复核决策指向了计划里不存在的候选：${url}`)
    }
  }
  return candidates.map((candidate) => {
    const decision = decisions[candidate.originalUrl]
    if (decision === undefined) return candidate
    // 🔴 决策是从文件 / 界面反序列化进来的，TypeScript 的联合类型在运行时不拦任何东西。
    //    写进去一个 'accept'（少个 ed）会变成一个谁都不认识的状态：激活闸的 pending 检查
    //    看不见它、accepted/rejected/deferred 三个集合也都不含它 —— 它从每一份账里**消失**，
    //    只要还有另一条合法的 accepted，整次激活会写完其余页面然后报「完成」。
    if (!ALLOWED_REVIEW_DECISIONS.includes(decision.decision)) {
      throw new InventoryPlanError(
        'invalid_decision',
        `候选 ${candidate.originalUrl} 的决策是「${String(decision.decision)}」，` +
          `只接受 ${ALLOWED_REVIEW_DECISIONS.join(' / ')} —— 认不出来的值必须当场拒，不能带着签名往下走`,
      )
    }
    if (candidate.decision !== 'pending') {
      throw new InventoryPlanError(
        'auto_rejected_not_overridable',
        `候选 ${candidate.originalUrl} 已被规则判为 ${candidate.decision}（${candidate.reasonCodes.join(',')}），` +
          '不接受人工覆盖 —— 主机边界与 URL 规则不是可商量的项',
      )
    }
    return { ...candidate, decision: decision.decision, reasonCodes: resolveReasonCodes(decision) }
  })
}

/**
 * 一份**未复核**计划是否「还是机器刚生成出来的那一份」。不满足直接抛。
 *
 * 🔴 只验哈希 / 版本 / canonical 推导**都不够**。真实绕过路径：
 *    把某条合规候选的 `decision` 从 `pending` 直接改成 `accepted`，再用公开的
 *    `computePlanHash()` 重算哈希 —— 版本对、哈希自洽、canonical 也推得出来，三关全过；
 *    然后 `applyReviewDecisions(plan, { decisions: {} })` 原样保留那个 `accepted`
 *    并给它盖上复核签名。最终抓取并写入一条**复核人从没接受过**的页面。
 *
 *    所以这里**从原始 URL 把整份机器候选重新构造一遍，逐字段比对** ——
 *    决策、原因码、归一留痕、撞车指向，一个字段都不放过。
 *
 * 🔴 光比对「计划里现有的候选」还不够 —— 另一条绕过路径是**整条删掉某个主机的候选**：
 *    `discovery` 仍声称 `shop.example.com` 有 1 条，`candidates` 里那条已经被拿掉，
 *    重新构造/逐字段比对只看剩下的候选，看不出「本该有一条却没有」。
 *    `assertDiscoveryConsistent()` 只查主机覆盖（有没有这个主机的发现记录），
 *    不查数量对不对得上 —— 所以这里必须重新跑一遍
 *    `buildInventoryPlan()` 生成时用过的那道计数对账。
 *
 * 🔴 上面那道对账**只覆盖批准主机**——删掉一条 malformed 或未批准主机的候选，
 *    它本来就不进任何主机的逐主机统计，对账天生看不见，逐字段比对也看不见
 *    （比对只看「剩下的候选」，少一条不会让剩下的字段对不上）。这类候选唯一
 *    还留着的痕迹是 `counts.discovered`（`countCandidates()` 在生成时算过一次），
 *    所以最后再补一道：拿现在的 `candidates` 重新数一遍，跟 `counts` 里的数字比对。
 *    这道放在 `assertCandidatesMachineDerived()` **之后**——候选内容被篡改
 *    （决策 / 撞车重复）时，前面那道更具体的错误应该先响，这道只兜「整条消失」。
 */
export function assertPlanIntact(plan: CanonicalInventoryPlan): void {
  assertVersionsAndHash(plan)
  assertDiscoveryConsistent(plan)
  assertDiscoveryMatchesCandidates(
    plan.discovery,
    plan.candidates.map((c) => c.originalUrl),
  )
  assertCandidatesMachineDerived(plan)
  assertCountsMachineDerived(plan)
}

/** `counts` 必须是当前 `candidates` 用 `countCandidates()` 重新数出来的那一份，一个字段都不许对不上。 */
function assertCountsMachineDerived(plan: CanonicalInventoryPlan): void {
  const expected = countCandidates(plan.candidates)
  const actual = plan.counts
  if (
    actual.discovered !== expected.discovered ||
    actual.pending !== expected.pending ||
    actual.accepted !== expected.accepted ||
    actual.rejected !== expected.rejected ||
    actual.deferred !== expected.deferred
  ) {
    throw new InventoryPlanError(
      'counts_not_machine_derived',
      `计划自带的计数（发现 ${actual.discovered} / 待判 ${actual.pending} / 已批 ${actual.accepted} / ` +
        `已拒 ${actual.rejected} / 暂缓 ${actual.deferred}）跟拿当前候选清单重新数出来的` +
        `（发现 ${expected.discovered} / 待判 ${expected.pending} / 已批 ${expected.accepted} / ` +
        `已拒 ${expected.rejected} / 暂缓 ${expected.deferred}）对不上 —— ` +
        '最常见的原因是候选被整条删掉、却没有同步改计数，尤其是 malformed / 未批准主机这类不进逐主机统计的候选',
    )
  }
}

/**
 * ISO 8601 时间戳校验。
 *
 * 🔴 「非空字符串」不够：`reviewedAt: 'not-a-date'` 照样能生成哈希与签名，
 *    留下一条**排不了序、也证明不了复核时间**的授权凭据 —— 而这份凭据正是台账的唯一出处。
 */
export function assertValidIsoTimestamp(value: string): void {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new InventoryPlanError('missing_reviewed_at', '复核必须带时间戳')
  }
  const parsed = Date.parse(trimmed)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== trimmed.slice(0, 10)) {
    throw new InventoryPlanError(
      'invalid_reviewed_at',
      `复核时间「${value}」不是合法的 ISO 8601 时间戳 —— 排不了序也证明不了复核时间`,
    )
  }
}

/**
 * 发现记录与批准主机必须一一对应，且不完整的主机都被认过。
 *
 * 这两条在生成时验过一遍；这里再验一遍，是因为计划会以文件形式在外面转一圈 ——
 * 有人删掉一条 discovery 记录再重算哈希，缺的那个站就又隐形了。
 */
function assertDiscoveryConsistent(plan: CanonicalInventoryPlan): void {
  const hosts = plan.discovery.map((d) => d.host)
  const approved = [...plan.boundary.approvedHosts].sort(compareStrings).join('|')
  if ([...hosts].sort(compareStrings).join('|') !== approved) {
    throw new InventoryPlanError(
      'discovery_coverage_mismatch',
      `发现记录覆盖的主机是 [${hosts.join(', ')}]，批准的是 [${plan.boundary.approvedHosts.join(', ')}] —— 对不上`,
    )
  }
  for (const row of plan.discovery) {
    if ((row.error !== null || row.count === 0) && !row.acknowledged) {
      throw new InventoryPlanError(
        'incomplete_discovery_not_acknowledged',
        `主机 ${row.host} 的发现结果不完整且没人认过`,
      )
    }
  }
}

function assertVersionsAndHash(plan: CanonicalInventoryPlan): void {
  if (plan.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {
    throw new InventoryPlanError(
      'contract_version_mismatch',
      `计划契约版本是 ${plan.contractVersion}，当前代码是 ${INVENTORY_PLAN_CONTRACT_VERSION} —— 重新生成，别在旧结构上盖新章`,
    )
  }
  if (plan.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {
    throw new InventoryPlanError(
      'rule_version_mismatch',
      `计划按 ${plan.normalizationRuleVersion} 归一，当前代码是 ${NORMALIZATION_RULE_VERSION} —— 规则变了必须重新生成并重新复核`,
    )
  }
  if (!verifyPlanHash(plan)) {
    throw new InventoryPlanError('plan_hash_mismatch', '计划内容与它自带的哈希对不上 —— 在外面被改过，不许盖章')
  }
}

/**
 * 拿计划里的原始 URL 重新跑一遍 `buildCandidates()`，结果必须与计划里的候选**逐字段相等**。
 *
 * 顺序也要一致：主候选的选取依赖字典序，顺序被打乱意味着撞车关系可能被换过。
 */
function assertCandidatesMachineDerived(plan: CanonicalInventoryPlan): void {
  const approvedHosts = normaliseApprovedHosts(plan.boundary.approvedHosts)
  const originals = plan.candidates.map((c) => c.originalUrl)
  if (new Set(originals).size !== originals.length) {
    throw new InventoryPlanError('duplicate_original_url', '同一条原始 URL 在计划里出现了多次 —— 机器不会这么生成')
  }
  const rebuilt = buildCandidates([...originals].sort(compareStrings), {
    requestedDomain: plan.boundary.requestedDomain,
    approvedHosts,
  })
  for (let i = 0; i < rebuilt.length; i++) {
    const actual = plan.candidates[i]
    const expected = rebuilt[i]
    const diff = firstFieldDifference(actual, expected)
    if (diff !== null) {
      throw new InventoryPlanError(
        'candidate_not_machine_derived',
        `候选 ${actual.originalUrl} 的「${diff}」跟机器重新生成的结果对不上 —— 这一份不是机器刚产出的那一份`,
      )
    }
  }
}

/** 返回第一个对不上的字段名；全都一致返回 `null`。 */
function firstFieldDifference(actual: InventoryCandidate, expected: InventoryCandidate): string | null {
  if (actual.originalUrl !== expected.originalUrl) return 'originalUrl'
  if (actual.canonicalUrl !== expected.canonicalUrl) return 'canonicalUrl'
  if (actual.decision !== expected.decision) return 'decision'
  if ((actual.duplicateOf ?? null) !== (expected.duplicateOf ?? null)) return 'duplicateOf'
  if (!sameStringList(actual.reasonCodes, expected.reasonCodes)) return 'reasonCodes'
  if (!sameStringList(actual.notes, expected.notes)) return 'notes'
  return null
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** 计划自带的哈希是否与内容一致（篡改检测）。 */
export function verifyPlanHash(plan: CanonicalInventoryPlan): boolean {
  const { planHash: _declared, ...rest } = plan
  return computePlanHash(rest) === plan.planHash
}

export function countCandidates(candidates: readonly InventoryCandidate[]): InventoryPlanCounts {
  return {
    discovered: candidates.length,
    pending: candidates.filter((c) => c.decision === 'pending').length,
    accepted: candidates.filter((c) => c.decision === 'accepted').length,
    rejected: candidates.filter((c) => c.decision === 'rejected').length,
    deferred: candidates.filter((c) => c.decision === 'defer').length,
  }
}

// ---------------------------------------------------------------------------
// 私有
// ---------------------------------------------------------------------------

/**
 * 人工原因码运行时白名单。跟 `RejectionReasonCode` 手动保持同步 ——
 * 联合类型只在编译期挡人，反序列化进来的拼写错误 / 旧枚举值靠这份清单在运行时挡。
 */
const ALLOWED_REASON_CODES: readonly RejectionReasonCode[] = [
  'malformed_url',
  'unsupported_scheme',
  'insecure_scheme',
  'credentials_present',
  'non_default_port',
  'host_not_approved',
  'duplicate_canonical_target',
  'reviewer_rejected',
  'reviewer_deferred',
]

/**
 * 🔴 人工原因码在盖章前必须逐项校验。它跟决策值一样是反序列化进来的：
 *    拼错一个值（如 `reviewr_rejected`）会原样被哈希和签名，激活侧只确认它是数组，
 *    最终进入拒绝 / 暂缓审计，却破坏了「按机器原因码分组统计」这条契约唯一的保证。
 */
function resolveReasonCodes(decision: ReviewDecision): readonly RejectionReasonCode[] {
  if (decision.reasonCodes === undefined) {
    if (decision.decision === 'rejected') return ['reviewer_rejected']
    if (decision.decision === 'defer') return ['reviewer_deferred']
    return []
  }
  for (const code of decision.reasonCodes) {
    if (!ALLOWED_REASON_CODES.includes(code)) {
      throw new InventoryPlanError(
        'invalid_reason_code',
        `原因码「${String(code)}」不认识，只接受 ${ALLOWED_REASON_CODES.join(' / ')} —— ` +
          '认不出来的值必须当场拒，不能带着签名往下走',
      )
    }
  }
  return decision.reasonCodes
}

function finalisePlan(parts: {
  clientId: string
  boundary: HostBoundary
  discovery: readonly HostDiscoverySummary[]
  candidates: readonly InventoryCandidate[]
  review: PlanReview | null
}): CanonicalInventoryPlan {
  const core = {
    contractVersion: INVENTORY_PLAN_CONTRACT_VERSION,
    normalizationRuleVersion: NORMALIZATION_RULE_VERSION,
    clientId: parts.clientId,
    boundary: parts.boundary,
    discovery: parts.discovery,
    candidates: parts.candidates,
    counts: countCandidates(parts.candidates),
    review: parts.review,
  }
  return { ...core, planHash: computePlanHash(core) }
}

/**
 * 稳定序列化：对象键排序。
 *
 * 🔴 没有复用 `@/lib/kernel/idempotency#canonicalJson` —— 那个模块的导出与
 *    `ActionDefinition` / `KernelError` 绑在一起，site-audit 采集层反向依赖执行内核
 *    是错的方向（授权原文：只有依赖方向仍然成立时才复用）。为几行代码引入这条依赖
 *    不划算，也会让架构守卫失效。
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compareStrings(a, b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

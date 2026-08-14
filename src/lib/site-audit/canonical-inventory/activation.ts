/**
 * Magic Engine 2.0 · 台账激活闸（Issue #930 · WP05 前置）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 顺序是这道闸的全部意义
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   校验（全部通过才继续）→ 抓取 + 富集（全部成功才继续）→ 一次性写入 → 精确对账
 *
 * 任何一步没过，**后面一步根本不会发生**：校验没过就一次抓取都不发出去；
 * 富集没全成就一行都不写。现有 `executeJob()` 的做法正相反 —— 边发现边 upsert，
 * 人还没看过就已经落库，失败的页面留下半截行。
 *
 * 🔴 这一层不 import supabase：写入口子从外面注入，所以「只有被接受的 canonical URL
 *    能到达持久化」这条能在内存里测死。
 * 🔴 闸门不过一律返回 `status: 'rejected'` 的审计对象而不是抛错 ——
 *    审计本身就是交付物；抛错会把「为什么没跑」这件事丢掉。
 *    调用方必须看 `status`，`'activated'` 之外都不算完成。
 */

import type {
  ActivationAudit,
  ActivationBlocker,
  ActivationDeps,
  ActivationExpectation,
  AcceptedPageRecord,
  CandidateDecision,
  InventoryCandidate,
  ReviewedInventoryPlan,
} from './types'
import { INVENTORY_PLAN_CONTRACT_VERSION, NORMALIZATION_RULE_VERSION } from './types'
import type { CrawlResult } from '../crawler'
import type { EnrichedPage } from '../page-enrichment'
import { verifyPlanHash } from './plan'
import { deriveCanonicalUrl, normaliseApprovedHosts } from './url-rules'

/** 决策的全集。计划里出现这四个以外的值，就是上游有 bug 或者被人改过。 */
const KNOWN_DECISIONS: readonly CandidateDecision[] = ['pending', 'accepted', 'rejected', 'defer']

export interface ActivateInput {
  readonly plan: ReviewedInventoryPlan
  /** 从当前生产上下文读出来的租户 / 域名 / 批准主机。 */
  readonly expected: ActivationExpectation
  /**
   * 激活模式。目前只有首次激活一种，且**要求台账为空** ——
   * 增量模式涉及「旧行怎么处置」，那是另一份授权，不在这里默认成立。
   */
  readonly mode: 'first_activation'
  readonly deps: ActivationDeps
}

/**
 * 执行一次台账激活。
 *
 * 返回的审计对象逐条列出被接受 / 被拒 / 暂缓 / 失败 / 实际写入的 URL —— 不做汇总即真相，
 * 也不许把部分成功报成完成。
 */
export async function activateReviewedPlan(input: ActivateInput): Promise<ActivationAudit> {
  const { plan, deps } = input

  // 🔴 结构闸必须在**任何解引用之前**。下面这一行 `.filter()` 本身就会在
  //    `candidates` 不是数组时抛出去，而这个模块承诺的是「一定返回一份审计」。
  const shape = checkPlanShape(plan)
  if (shape.length > 0) {
    return buildAudit({ plan, accepted: [], status: 'rejected', blockers: shape, failures: [], written: [], touched: false })
  }

  const accepted = plan.candidates.filter((c) => c.decision === 'accepted')

  const blockers = await collectBlockers(input, accepted)
  if (blockers.length > 0) {
    return buildAudit({ plan, accepted, status: 'rejected', blockers, failures: [], written: [], touched: false })
  }

  // ——— 闸门全过，才开始真的抓 ———
  const acceptedUrls = accepted.map((c) => c.canonicalUrl as string)
  const { records, failures } = await crawlAndEnrich(acceptedUrls, deps)

  if (failures.length > 0) {
    return buildAudit({
      plan,
      accepted,
      status: 'failed',
      blockers: [
        {
          code: 'accepted_page_failed',
          message:
            `${failures.length} 个被接受的页面抓取或分类失败，本次不写入任何一行 —— ` +
            '被批准的是「这一整份清单」，写一半就不是那份清单了。修好之后重跑。',
        },
      ],
      failures,
      written: [],
      touched: false,
    })
  }

  return persistAndReconcile(input, accepted, records)
}

// ---------------------------------------------------------------------------
// 闸门
// ---------------------------------------------------------------------------

async function collectBlockers(
  input: ActivateInput,
  accepted: readonly InventoryCandidate[],
): Promise<ActivationBlocker[]> {
  const { plan, expected, deps } = input
  let blockers: ActivationBlocker[]
  try {
    blockers = [
      ...checkPlanIdentity(plan, expected, deps.verifyReviewSignature),
      ...checkAcceptedSet(plan, accepted),
    ]
  } catch (err) {
    // 🔴 code 跟 `plan_shape_invalid` **故意不同**：那个是结构闸认出来的已知形状，
    //    这个是「闸没覆盖到、靠兜底才没炸出去」—— 出现它就说明 checkPlanShape 有洞，
    //    该去补闸，而不是把两种信号混成一个。
    //    这里还没抓过任何页面、也没写过任何东西，所以是干净的 rejected。
    return [
      {
        code: 'plan_shape_unexpected',
        message:
          `校验计划时出了结构闸没预料到的错：${err instanceof Error ? err.message : String(err)}。` +
          '这说明 checkPlanShape 漏了一种形状，需要补。',
      },
    ]
  }
  if (blockers.length > 0) return blockers

  // 空库闸放在最后：它要打网络/数据库，前面的纯校验能拦下的就别浪费这一次查询。
  return checkInventoryEmpty(deps.store, plan.clientId)
}

/** 首次激活要求台账为空。读不到行数**绝不当成 0** —— 「查不到」和「查炸了」必须是两种结局。 */
async function checkInventoryEmpty(
  store: ActivationDeps['store'],
  clientId: string,
): Promise<ActivationBlocker[]> {
  let existing: number
  try {
    existing = await store.countExistingPages(clientId)
  } catch (err) {
    return [
      {
        code: 'inventory_count_unavailable',
        message: `读不到该租户当前台账行数，无法确认是首次激活：${err instanceof Error ? err.message : String(err)}`,
      },
    ]
  }
  if (existing !== 0) {
    return [
      {
        code: 'inventory_not_empty',
        message:
          `首次激活要求台账为空，实际有 ${existing} 行。这些行的来源与去留需要单独决定，` +
          '不能被这次激活默默覆盖。',
      },
    ]
  }
  return []
}

function checkPlanIdentity(
  plan: ReviewedInventoryPlan,
  expected: ActivationExpectation,
  verifySignature: ActivationDeps['verifyReviewSignature'],
): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = [
    ...checkReviewSignature(plan, verifySignature),
    ...checkPlanVersions(plan),
    ...checkDiscoveryCoverage(plan),
  ]
  if (plan.clientId !== expected.clientId) {
    blockers.push({
      code: 'client_mismatch',
      message: `计划属于租户 ${plan.clientId}，本次激活的是 ${expected.clientId}`,
    })
  }
  if (!sameDomain(plan.boundary.requestedDomain, expected.requestedDomain)) {
    blockers.push({
      code: 'domain_mismatch',
      message: `计划针对域名 ${plan.boundary.requestedDomain}，本次上下文是 ${expected.requestedDomain}`,
    })
  }
  if (!sameHostSet(plan.boundary.approvedHosts, expected.approvedHosts)) {
    blockers.push({
      code: 'approved_hosts_mismatch',
      message:
        `计划批准的主机是 [${[...plan.boundary.approvedHosts].join(', ')}]，` +
        `本次上下文批准的是 [${[...expected.approvedHosts].join(', ')}]`,
    })
  }
  if (plan.review === null || plan.review.reviewedBy.trim().length === 0) {
    blockers.push({ code: 'plan_not_reviewed', message: '这份计划没有复核签名，不能激活' })
  }
  if (!verifyPlanHash(plan)) {
    blockers.push({
      code: 'plan_hash_mismatch',
      message: '计划内容与它自带的哈希对不上 —— 批准之后被改过，不许激活',
    })
  }
  return blockers
}

function checkAcceptedSet(
  plan: ReviewedInventoryPlan,
  accepted: readonly InventoryCandidate[],
): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  // 🔴 认不出来的决策值必须当场拒。它不属于 accepted/rejected/deferred 任何一个集合，
  //    也不算 pending —— 放过去就等于这条候选从每一份账里凭空消失，而整次激活照报「完成」。
  const unknown = plan.candidates.filter((c) => !KNOWN_DECISIONS.includes(c.decision))
  if (unknown.length > 0) {
    blockers.push({
      code: 'unknown_decision',
      message:
        `${unknown.length} 条候选带着认不出来的决策值` +
        `（${unknown.slice(0, 3).map((c) => `${c.originalUrl}=${String(c.decision)}`).join('、')}）`,
    })
  }
  const pending = plan.candidates.filter((c) => c.decision === 'pending')
  if (pending.length > 0) {
    blockers.push({
      code: 'unreviewed_candidates',
      message: `还有 ${pending.length} 条候选没人判（pending）。没判过的不许当成「不要」。`,
    })
  }
  if (accepted.length === 0) {
    blockers.push({ code: 'empty_accepted_set', message: '被接受的页面是 0 条，没有可激活的台账' })
  }

  let approvedHosts: readonly string[]
  try {
    approvedHosts = normaliseApprovedHosts(plan.boundary.approvedHosts)
  } catch (err) {
    return [
      ...blockers,
      { code: 'invalid_host_allowlist', message: err instanceof Error ? err.message : String(err) },
    ]
  }

  const seen = new Set<string>()
  for (const candidate of accepted) {
    const blocker = checkAcceptedCandidate(candidate, approvedHosts, seen)
    if (blocker !== null) blockers.push(blocker)
  }
  return blockers
}

/**
 * 反序列化之后的结构校验 —— 在任何解引用之前跑。
 *
 * 只查「下面真的会去碰」的字段：类型系统对一份 JSON.parse 的结果不提供任何保护。
 */
function checkPlanShape(plan: ReviewedInventoryPlan): ActivationBlocker[] {
  const bad = (message: string): ActivationBlocker[] => [{ code: 'plan_shape_invalid', message }]
  if (typeof plan !== 'object' || plan === null) return bad('计划不是一个对象')
  if (typeof plan.clientId !== 'string' || typeof plan.planHash !== 'string') {
    return bad('计划缺少 clientId / planHash，或者它们不是字符串')
  }
  const boundary = plan.boundary as unknown
  if (typeof boundary !== 'object' || boundary === null) return bad('计划缺少主机边界（boundary）')
  if (typeof plan.boundary.requestedDomain !== 'string' || !Array.isArray(plan.boundary.approvedHosts)) {
    return bad('主机边界的 requestedDomain / approvedHosts 结构不对')
  }
  if (!plan.boundary.approvedHosts.every((h) => typeof h === 'string')) {
    return bad('批准主机清单里有非字符串项')
  }
  if (!Array.isArray(plan.candidates)) return bad('计划的候选清单不是数组')
  // 🔴 只确认「容器是数组」不够：里面塞一个 null，下一行 `.filter(c => c.decision)`
  //    就会直接抛 TypeError，而那一刻还没进兜底 catch —— 调用方拿不到承诺的审计对象。
  const badCandidate = plan.candidates.findIndex((c) => !isCandidateShape(c))
  if (badCandidate >= 0) return bad(`第 ${badCandidate + 1} 条候选的结构不对（不是对象，或关键字段类型不对）`)
  if (!Array.isArray(plan.discovery)) return bad('计划的逐主机发现记录不是数组')
  if (!plan.discovery.every((d) => isDiscoveryShape(d))) return bad('逐主机发现记录里有结构不对的项')
  return checkReviewShape(plan)
}

/** 一条候选必须长成对象，且后面真的会去解引用的字段类型都对。 */
function isCandidateShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.originalUrl === 'string' &&
    (typeof c.canonicalUrl === 'string' || c.canonicalUrl === null) &&
    typeof c.decision === 'string' &&
    Array.isArray(c.reasonCodes) &&
    Array.isArray(c.notes)
  )
}

function isDiscoveryShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const d = value as Record<string, unknown>
  return (
    typeof d.host === 'string' &&
    typeof d.count === 'number' &&
    typeof d.foreignCount === 'number' &&
    (typeof d.error === 'string' || d.error === null) &&
    typeof d.acknowledged === 'boolean'
  )
}

/** 复核信息的结构。缺 `review`、或者署名/时间不是字符串，都在这里变成 blocker 而不是异常。 */
function checkReviewShape(plan: ReviewedInventoryPlan): ActivationBlocker[] {
  const review = plan.review as unknown
  if (typeof review !== 'object' || review === null) {
    return [{ code: 'plan_shape_invalid', message: '计划里没有复核信息（review），不能激活' }]
  }
  if (typeof plan.review.reviewedBy !== 'string' || typeof plan.review.reviewedAt !== 'string') {
    return [{ code: 'plan_shape_invalid', message: '复核信息的 reviewedBy / reviewedAt 不是字符串' }]
  }
  return []
}

/**
 * 逐主机发现记录必须覆盖每一个批准主机，且不完整的主机都被人认过。
 *
 * 🔴 这道闸挡的是**缺整个站**：批准了两个主机、只找了一个，合并后的 URL 清单
 *    看不出任何异常，复核与激活会一路顺畅地产出一份缺页台账 —— 而缺页没人会发现。
 */
function checkDiscoveryCoverage(plan: ReviewedInventoryPlan): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  const covered = new Set(plan.discovery.map((d) => d.host.trim().toLowerCase()))
  const missing = plan.boundary.approvedHosts.filter((h) => !covered.has(h.trim().toLowerCase()))
  if (missing.length > 0) {
    blockers.push({
      code: 'discovery_host_missing',
      message: `批准了主机 [${missing.join(', ')}] 但计划里没有它们的发现记录 —— 那些站根本没被找过`,
    })
  }
  const approved = new Set(plan.boundary.approvedHosts.map((h) => h.trim().toLowerCase()))
  const extra = plan.discovery.filter((d) => !approved.has(d.host.trim().toLowerCase()))
  if (extra.length > 0) {
    blockers.push({
      code: 'discovery_host_unapproved',
      message: `发现记录里有未批准的主机 [${extra.map((d) => d.host).join(', ')}]`,
    })
  }
  const unacknowledged = plan.discovery.filter((d) => (d.error !== null || d.count === 0) && !d.acknowledged)
  if (unacknowledged.length > 0) {
    blockers.push({
      code: 'incomplete_discovery_not_acknowledged',
      message:
        `主机 [${unacknowledged.map((d) => d.host).join(', ')}] 的发现结果为 0 条或出错，且没人认过。` +
        '0 条可能是站是空的、也可能是被挡住了 —— 必须有人先分清楚。',
    })
  }
  return blockers
}

/** 契约版本 / 归一规则版本 —— 版本不对就不能拿旧批准套新语义。 */
function checkPlanVersions(plan: ReviewedInventoryPlan): ActivationBlocker[] {
  const blockers: ActivationBlocker[] = []
  if (plan.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {
    blockers.push({
      code: 'contract_version_mismatch',
      message: `计划契约版本是 ${plan.contractVersion}，当前代码是 ${INVENTORY_PLAN_CONTRACT_VERSION}`,
    })
  }
  if (plan.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {
    blockers.push({
      code: 'rule_version_mismatch',
      message:
        `计划按 ${plan.normalizationRuleVersion} 归一，当前代码是 ${NORMALIZATION_RULE_VERSION} —— ` +
        '规则变了就必须重新生成并重新复核，旧批准不能套新语义',
    })
  }
  return blockers
}

/**
 * 验复核签名。
 *
 * 🔴 自带的 `planHash` 只能证明「内容与同一份文件里的哈希一致」—— 它是用公开函数算的，
 *    谁改了内容都能自己重算一遍。把某条已接受候选的 `originalUrl` 与 `canonicalUrl`
 *    **成对**换成另一个真实页面，哈希闸与推导闸都会放行。
 *    唯一挡得住的是一枚改文件的人算不出来的签名。
 */
function checkReviewSignature(
  plan: ReviewedInventoryPlan,
  verifySignature: ActivationDeps['verifyReviewSignature'],
): ActivationBlocker[] {
  const signature = plan.reviewSignature
  if (typeof signature !== 'string' || signature.trim().length === 0) {
    return [{ code: 'review_signature_missing', message: '这份计划没有复核签名，不能激活' }]
  }
  let ok: boolean
  try {
    ok = verifySignature(plan.planHash, signature)
  } catch (err) {
    return [
      {
        code: 'review_signature_unverifiable',
        message: `验签过程本身出错，不能当成验过：${err instanceof Error ? err.message : String(err)}`,
      },
    ]
  }
  if (!ok) {
    return [
      {
        code: 'review_signature_invalid',
        message:
          '复核签名与计划内容对不上 —— 批准之后内容被改过（自带哈希谁都能重算，签名不能）。',
      },
    ]
  }
  return []
}

/**
 * 逐条验一个被接受的候选。过了就把它的 canonical 记进 `seen`（用于去重）。
 *
 * 🔴 推导校验拿**原始 URL 重新推导**，而不是只验「这个串本身规不规范」。
 *    差别在于：把 canonical 从 /a 改成同一主机下的 /hacked，那个串自己完全规范，
 *    但它不是这条候选推导出来的东西 —— 照批就会写入一个没人复核过的页面。
 *    plan.ts 的 assertPlanIntact 已经验过一遍；这里是纵深防御，
 *    因为没有任何东西能证明一份手写的复核计划真的来自 buildInventoryPlan。
 */
function checkAcceptedCandidate(
  candidate: InventoryCandidate,
  approvedHosts: readonly string[],
  seen: Set<string>,
): ActivationBlocker | null {
  const url = candidate.canonicalUrl
  if (url === null) {
    return {
      code: 'accepted_without_canonical',
      message: `被接受的候选 ${candidate.originalUrl} 没有 canonical URL`,
    }
  }
  const derived = deriveCanonicalUrl(candidate.originalUrl, { approvedHosts })
  if (derived === null || derived !== url) {
    return {
      code: 'accepted_url_not_derived',
      message:
        `被接受的 ${candidate.originalUrl} 记着的 canonical 是 ${url}，` +
        `按当前规则重新推导得到 ${derived ?? 'null'}（主机未批准或该串被改过）`,
    }
  }
  if (seen.has(url)) {
    return { code: 'duplicate_accepted_target', message: `被接受集合里出现重复的 canonical URL：${url}` }
  }
  seen.add(url)
  return null
}

// ---------------------------------------------------------------------------
// 抓取 + 富集（复用现有 site-audit，不另起一套）
// ---------------------------------------------------------------------------

interface CrawlOutcome {
  readonly records: readonly AcceptedPageRecord[]
  readonly failures: readonly { url: string; error: string }[]
}

async function crawlAndEnrich(urls: readonly string[], deps: ActivationDeps): Promise<CrawlOutcome> {
  const records: AcceptedPageRecord[] = []
  const failures: { url: string; error: string }[] = []

  // 抓取结果里 antibot 挑战页也带 `error`（`crawler.ts:439`），所以下面那道 error 判定
  // 同时挡住「WAF 拦截页被当成真页面写进台账」—— 那是 2026-06-20 Oztop 事故的形状。
  let crawled: readonly CrawlResult[]
  try {
    crawled = await deps.crawl(urls)
  } catch (err) {
    return { records: [], failures: urls.map((url) => ({ url, error: crawlErrorText(err) })) }
  }

  const byUrl = new Map(crawled.map((r) => [r.url, r]))
  for (const url of urls) {
    const result = byUrl.get(url)
    if (result === undefined) {
      // 抓取器没返回这一条 —— 不许当成「跳过」，它就是失败。
      failures.push({ url, error: 'crawler returned no result for this accepted URL' })
      continue
    }
    if (result.error !== undefined && result.error.length > 0) {
      failures.push({ url, error: result.error })
      continue
    }
    // 🔴 富集契约上「永不抛」，但注入进来的实现不归我们管。让它把整个
    //    activateReviewedPlan() reject 掉，调用方就既拿不到审计、也没法按 status 判结局
    //    —— 而这个模块对外的承诺正是「一定返回一份审计」。抓成失败，语义跟抓取失败一致。
    let enriched: EnrichedPage
    try {
      enriched = await deps.enrich({ url, title: result.title, markdown: result.markdown })
    } catch (err) {
      failures.push({ url, error: `enrichment threw: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }
    if (!enriched.classified) {
      // 台账要给 WP05 当页面身份用，分类失败的页面不许以 `other` 蒙混进去。
      failures.push({ url, error: `classification failed: ${enriched.classificationError ?? 'unknown'}` })
      continue
    }
    records.push(toPageRecord(url, result, enriched))
  }
  return { records, failures }
}

/** 把一页抓取结果 + 富集结果拼成台账记录。字段只用 `client_site_pages` 已有的列。 */
function toPageRecord(url: string, result: CrawlResult, enriched: EnrichedPage): AcceptedPageRecord {
  return {
    canonicalUrl: url,
    path: new URL(url).pathname,
    title: result.title,
    markdown: result.markdown,
    wordCount: enriched.wordCount,
    pageType: enriched.pageType,
    topics: enriched.topics,
    primaryKeyword: enriched.primaryKeyword,
    classificationConfidence: enriched.classificationConfidence,
    hasGeoBlock: enriched.hasGeoBlock,
    geoDetectionMethod: enriched.geoDetectionMethod,
    geoConfidence: enriched.geoConfidence,
    crawledAt: result.crawledAt.toISOString(),
  }
}

function crawlErrorText(err: unknown): string {
  return `crawl batch failed: ${err instanceof Error ? err.message : String(err)}`
}

// ---------------------------------------------------------------------------
// 写入 + 对账
// ---------------------------------------------------------------------------

async function persistAndReconcile(
  input: ActivateInput,
  accepted: readonly InventoryCandidate[],
  records: readonly AcceptedPageRecord[],
): Promise<ActivationAudit> {
  const { plan, deps } = input
  // 🔴 走到这里页面**已经抓过了**，所以任何收场都是 `failed`，不是 `rejected` ——
  //    `rejected` 的契约是「一次抓取都没发生」。搞混了，读审计的人会以为这次没花过网络成本，
  //    重试与成本判断都会跟着错。`inventoryTouched` 才是「有没有碰过台账」那一维。
  const fail = (blocker: ActivationBlocker, touched: boolean, written: readonly string[] = []): ActivationAudit =>
    buildAudit({ plan, accepted, status: 'failed', blockers: [blocker], failures: [], written, touched })

  const stillEmpty = await recheckInventoryEmpty(input)
  if (stillEmpty !== null) return fail(stillEmpty, false)

  const write = await writeRecords(input, records)
  if (write.blocker !== null) return fail(write.blocker, true)

  const mismatch = reconcileWriteSet(records, write.written)
  if (mismatch !== null) return fail(mismatch, true, write.written)

  return buildAudit({
    plan,
    accepted,
    status: 'activated',
    blockers: [],
    failures: [],
    written: write.written,
    touched: true,
  })
}

/**
 * 写之前再看一眼台账是不是仍然是空的。有问题返回闸门理由，没问题返回 `null`。
 *
 * 🔴 抓取要跑几分钟，激活开头那一眼是几分钟之前看的。这中间可能有另一次激活、
 *    或者旧的 site-audit 任务往同一张表里写过东西。
 *    ⚠️ 这只是把窗口收窄，**不是**原子性：真正的保证必须由 store 在
 *    同一个事务 / 条件写里跟插入一起做（见 `CanonicalInventoryStore` 契约）。
 */
async function recheckInventoryEmpty(input: ActivateInput): Promise<ActivationBlocker | null> {
  let recheck: number
  try {
    recheck = await input.deps.store.countExistingPages(input.plan.clientId)
  } catch (err) {
    return {
      code: 'inventory_count_unavailable',
      message: `写入前复查台账行数失败，不能确认它仍然是空的：${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (recheck !== 0) {
    return {
      code: 'inventory_changed_during_crawl',
      message:
        `抓取期间台账从 0 行变成了 ${recheck} 行 —— 有别的东西在往同一个租户写。` +
        '这次不写，先弄清那些行是谁写的。',
    }
  }
  return null
}

/** 唯一一处真正调用落库口的地方。 */
async function writeRecords(
  input: ActivateInput,
  records: readonly AcceptedPageRecord[],
): Promise<{ written: readonly string[]; blocker: ActivationBlocker | null }> {
  try {
    const written = await input.deps.store.writeAcceptedPages({
      clientId: input.plan.clientId,
      pages: records,
      // 🔴 这个标记不是给日志看的：实现方**必须**在同一个事务 / 条件写里
      //    重新确认台账为空，否则两份不同的计划可以各自对账通过、
      //    最后台账是两份的并集 —— 那已经不是任何一份被批准的清单。
      requireEmptyInventory: true,
    })
    return { written, blocker: null }
  } catch (err) {
    return {
      written: [],
      blocker: {
        code: 'write_failed',
        message:
          `写入台账失败：${err instanceof Error ? err.message : String(err)}。` +
          '⚠️ 失败发生在写入过程中，库里可能已有部分行，先人工核对再重跑。',
      },
    }
  }
}

/**
 * 拿写入方返回的清单跟被接受集合做**精确**比对，不是数个数。
 * 少一条 / 多一条 / 换了一条，都不许报「完成」。
 */
function reconcileWriteSet(
  records: readonly AcceptedPageRecord[],
  written: readonly string[],
): ActivationBlocker | null {
  const expectedSet = new Set(records.map((r) => r.canonicalUrl))
  const writtenSet = new Set(written)
  const missing = Array.from(expectedSet).filter((u) => !writtenSet.has(u))
  const unexpected = Array.from(writtenSet).filter((u) => !expectedSet.has(u))
  if (missing.length === 0 && unexpected.length === 0) return null
  return {
    code: 'write_set_mismatch',
    message:
      `写入结果与被接受集合不一致：缺 ${missing.length} 条 [${missing.join(', ')}]，` +
      `多 ${unexpected.length} 条 [${unexpected.join(', ')}]。⚠️ 台账已被改动，必须人工核对。`,
  }
}

// ---------------------------------------------------------------------------
// 审计对象
// ---------------------------------------------------------------------------

function buildAudit(parts: {
  plan: ReviewedInventoryPlan
  accepted: readonly InventoryCandidate[]
  status: ActivationAudit['status']
  blockers: readonly ActivationBlocker[]
  failures: readonly { url: string; error: string }[]
  written: readonly string[]
  touched: boolean
}): ActivationAudit {
  const { plan } = parts
  // 🔴 审计对象本身**绝不能抛**：它经常是「计划结构不对」时唯一能交出去的东西。
  //    所以这里不只查容器是不是数组，还要把结构不对的项（null、缺字段）滤掉 ——
  //    否则一个 null 候选就能让「交不出账」这件事发生在最需要账的时候。
  const all: readonly InventoryCandidate[] = (Array.isArray(plan.candidates) ? plan.candidates : []).filter(
    (c): c is InventoryCandidate => isCandidateShape(c),
  )
  const rejected = all.filter((c) => c.decision === 'rejected')
  const deferred = all.filter((c) => c.decision === 'defer')
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    status: parts.status,
    clientId: str(plan.clientId),
    planHash: str(plan.planHash),
    normalizationRuleVersion: str(plan.normalizationRuleVersion),
    counts: {
      accepted: parts.accepted.length,
      rejected: rejected.length,
      deferred: deferred.length,
      crawlFailed: parts.failures.length,
      written: parts.written.length,
    },
    acceptedUrls: parts.accepted.map((c) => c.canonicalUrl ?? c.originalUrl),
    rejectedUrls: rejected.map((c) => ({ url: c.canonicalUrl ?? c.originalUrl, reasonCodes: c.reasonCodes })),
    deferredUrls: deferred.map((c) => ({ url: c.canonicalUrl ?? c.originalUrl, reasonCodes: c.reasonCodes })),
    failedUrls: parts.failures,
    writtenUrls: parts.written,
    blockers: parts.blockers,
    inventoryTouched: parts.touched,
    redirectEvidence: 'unavailable',
  }
}

function sameDomain(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function sameHostSet(a: readonly string[], b: readonly string[]): boolean {
  const norm = (hosts: readonly string[]): string =>
    Array.from(new Set(hosts.map((h) => h.trim().toLowerCase())))
      .sort()
      .join('|')
  return norm(a) === norm(b)
}

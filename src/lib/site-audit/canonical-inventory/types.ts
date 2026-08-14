/**
 * Magic Engine 2.0 · 站点页面台账（canonical inventory）的契约（Issue #930 · WP05 前置）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这一层解决什么
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 现有 site-audit 能发现页面、抓取、分类、检测 GEO 块、按租户落库 —— 那些**全部复用**，
 * 这里一行都不重写。缺的是「页面身份」本身：
 *
 *   1. 主机边界不精确 —— crawler 把 `www.` 剥掉再做**字符串前缀**比较
 *      （`crawler.ts:133-135`、`:509-529`）。于是裸域与 `www.` 被当成同一个站；
 *      而 #930 的现场事实是这两个主机下面挂着**不同的站**（一个是现站，一个是旧品牌残留）。
 *      前缀比较还会把 `example.com.evil.com` 判成同源。
 *   2. URL 身份是原始串 —— 片段 / 查询参数 / 尾斜杠 / 端口 / http-https 没有版本化规则，
 *      而唯一约束建在原始 `url` 上，语法变体可以同时存在。
 *   3. 发现即写入 —— `executeJob()` 一边发现一边 upsert，人还没看过就已经落库。
 *   4. 现有「审核」步骤在写入**之后**，只能整体点一个「看起来没问题」，
 *      不能逐条接受/拒绝，也绑不住一份被批准的确切清单。
 *
 * 所以这里只补四样：**精确主机边界、版本化的 URL 归一、可复核的无写入计划（带哈希）、
 * 以及一道 fail-closed 的激活闸**。不新建 crawler，不新建表，不做客户专属能力。
 *
 * 🔴 这一层**不含任何客户常量**。租户、域名、被批准的主机全部从调用方进来。
 */

import type { EnrichedPage } from '../page-enrichment'
import type { CrawlResult } from '../crawler'

// ---------------------------------------------------------------------------
// 版本号 —— 计划一旦被人复核过，规则再改就必须换版本，否则旧批准会被新语义偷偷复用
// ---------------------------------------------------------------------------

/** 计划结构本身的版本。字段增减 / 语义变化都要升。 */
export const INVENTORY_PLAN_CONTRACT_VERSION = 'canonical-inventory-plan@1'

/**
 * URL 归一规则的版本。
 *
 * 🔴 改任何一条归一规则都必须升这个版本 —— 激活闸会拿它跟计划里记录的版本比对，
 *    不一致直接拒。否则「人批准的那份清单」和「代码现在算出来的那份」可以悄悄分叉。
 */
export const NORMALIZATION_RULE_VERSION = 'inventory-url-rules@1'

// ---------------------------------------------------------------------------
// 决策与原因码
// ---------------------------------------------------------------------------

/**
 * 候选页面的处置。
 *
 * - `pending`  规则上过得去，**等人判**。计划刚生成时所有合规候选都是这个状态。
 * - `accepted` 人批准进台账。
 * - `rejected` 不进台账（规则自动拒 或 人拒）。
 * - `defer`    这一轮不判，留到下一轮 —— 与 `rejected` 分开记，免得「暂时不要」被读成「不是他的页面」。
 */
export type CandidateDecision = 'pending' | 'accepted' | 'rejected' | 'defer'

/**
 * 机器可读的原因码。
 *
 * 🔴 只用枚举，不用自由文本 —— 审计要能按原因分组统计，自由文本做不到。
 */
export type RejectionReasonCode =
  /** 连 `new URL()` 都解析不了 */
  | 'malformed_url'
  /** 不是 http/https（mailto:、javascript:、ftp: …） */
  | 'unsupported_scheme'
  /** 是 http —— 被批准的台账只收 https，不替对方假设有跳转 */
  | 'insecure_scheme'
  /** URL 里带用户名/密码 */
  | 'credentials_present'
  /** 带非默认端口 */
  | 'non_default_port'
  /** 主机不在**精确**批准清单里（含 www、子域、前缀混淆） */
  | 'host_not_approved'
  /** 归一之后跟另一条候选撞成同一个 canonical URL */
  | 'duplicate_canonical_target'
  /** 人工拒（复核时给出） */
  | 'reviewer_rejected'
  /** 人工暂缓（复核时给出，配 `defer`） */
  | 'reviewer_deferred'

/** 归一过程中动过什么 —— 留痕，让复核的人知道原始串和 canonical 差在哪。 */
export type NormalisationNote =
  | 'scheme_lowercased'
  | 'host_lowercased'
  | 'fragment_removed'
  | 'default_port_removed'
  | 'trailing_slash_removed'
  | 'tracking_query_removed'
  | 'query_sorted'
  /** 归一之后仍然带查询参数 —— 复核的人必须自己确认这是不是一个独立页面 */
  | 'query_retained'

// ---------------------------------------------------------------------------
// 主机边界
// ---------------------------------------------------------------------------

/**
 * 主机边界。
 *
 * 🔴 `approvedHosts` 是**精确主机名**清单，一个都不推断：不补 www、不补裸域、
 *    不展开子域、不认通配符。#930 的现场事实就是 `www.` 下面挂的是另一个品牌的旧站。
 */
export interface HostBoundary {
  /** 调用方声明的目标域（通常是 `clients.domain`）。只作记录，不参与同源判定。 */
  readonly requestedDomain: string
  /** 被显式批准的精确主机名（小写、无 scheme / 端口 / 路径）。 */
  readonly approvedHosts: readonly string[]
}

// ---------------------------------------------------------------------------
// 计划
// ---------------------------------------------------------------------------

export interface InventoryCandidate {
  /** 发现阶段拿到的原始 URL，原样保留（审计要能追回来源）。 */
  readonly originalUrl: string
  /** 归一后的 canonical URL；规则上就过不去的候选是 `null`。 */
  readonly canonicalUrl: string | null
  readonly decision: CandidateDecision
  readonly reasonCodes: readonly RejectionReasonCode[]
  readonly notes: readonly NormalisationNote[]
  /** 撞车时指向「留下的那一条」的原始 URL。 */
  readonly duplicateOf?: string
}

export interface InventoryPlanCounts {
  readonly discovered: number
  readonly pending: number
  readonly accepted: number
  readonly rejected: number
  readonly deferred: number
}

/** 复核签名。计划哈希把它一起盖进去，改签名就等于换了一份计划。 */
export interface PlanReview {
  readonly reviewedBy: string
  /** ISO 8601。由调用方给，不在这一层取当前时间。 */
  readonly reviewedAt: string
  /** 复核备注，可空。 */
  readonly note?: string
}

/**
 * 逐个批准主机的发现结果。
 *
 * 🔴 **必须进计划、进哈希、进复核内容。** 只在发现阶段返回一份 `perHost` 是不够的：
 *    调用方把 `urls` 喂进计划、`perHost` 丢在一边，就能批准并激活一份
 *    **整个主机静默缺席**的台账 —— 而缺页没有任何人会发现。
 *    所以「某个主机 0 条 / 发现出错」这件事必须跟着计划一路走到复核人面前。
 */
export interface HostDiscoverySummary {
  readonly host: string
  /** **这个主机自己的**页面数（按解析后的 hostname 精确归属）。 */
  readonly count: number
  /** 发现这个主机时返回的、其实属于别的主机的条数。记着不丢，但不算它「有页面」。 */
  readonly foreignCount: number
  readonly error: string | null
  /**
   * 人有没有明确认过「这个主机 0 条 / 出错，我知道，继续」。
   *
   * 0 条可能是站是空的，也可能是被 WAF 挡了 —— 两者长得一模一样，只能由人来分。
   * 没认过的不完整发现，计划根本生不出来（更谈不上激活）。
   */
  readonly acknowledged: boolean
}

export interface CanonicalInventoryPlan {
  readonly contractVersion: string
  readonly normalizationRuleVersion: string
  readonly clientId: string
  readonly boundary: HostBoundary
  /** 逐主机发现结果 —— 与 `boundary.approvedHosts` 一一对应，一个都不能少。 */
  readonly discovery: readonly HostDiscoverySummary[]
  readonly candidates: readonly InventoryCandidate[]
  readonly counts: InventoryPlanCounts
  /**
   * 计划的确定性哈希。覆盖：契约版本 / 规则版本 / 租户 / 边界 / 每条候选的
   * 原始 URL + canonical + 决策 + 原因码 + 备注 + 复核签名。
   *
   * 🔴 同样的输入必须永远得到同一个哈希 —— 激活闸靠它证明「跑的就是人批准的那一份」。
   */
  readonly planHash: string
  /** 未复核的计划是 `null`。 */
  readonly review: PlanReview | null
}

/**
 * 复核过的计划 —— `review` 一定不为空，且带一枚**别人算不出来**的签名。
 *
 * 🔴 为什么光有 `planHash` 不够：那个哈希是拿公开函数算的。计划以文件 / 界面形式
 *    在外面转一圈时，把某条已接受候选的 `originalUrl` 与 `canonicalUrl` **成对**改成
 *    另一个真实页面、保留 accepted 与复核信息，再自己重算一遍哈希 ——
 *    哈希闸与推导闸都会过，激活就会抓取并写入一个从没获批的页面。
 *    自带哈希只能证明「内容与同一份文件里的哈希一致」，不能证明「内容还是当初批的那份」。
 *
 * 所以复核时必须由持密钥的一方对 `planHash` 签名；激活时用注入的验签函数验。
 * 改内容 ⇒ `planHash` 变 ⇒ 旧签名对不上，而改签名需要密钥 —— 改文件的人没有。
 */
export interface ReviewedInventoryPlan extends CanonicalInventoryPlan {
  readonly review: PlanReview
  /** 对 `planHash` 的签名（HMAC 之类）。内容不透明，本层只负责「验得过 / 验不过」。 */
  readonly reviewSignature: string
}

// ---------------------------------------------------------------------------
// 激活
// ---------------------------------------------------------------------------

/**
 * 激活时调用方从**当前生产上下文**读出来的事实。
 *
 * 🔴 它跟计划里记的东西对不上就直接拒 —— 一份给 A 客户批的计划不能拿去激活 B 客户。
 */
export interface ActivationExpectation {
  readonly clientId: string
  readonly requestedDomain: string
  readonly approvedHosts: readonly string[]
}

/**
 * 台账落库口（端口）。
 *
 * 🔴 这一层**不 import supabase**，写入永远从外面注入。所以「只有被接受的 canonical URL
 *    能到达持久化」这条能在内存里直接测出来，不用碰生产库。
 */
export interface CanonicalInventoryStore {
  /**
   * 该租户当前台账里有多少行。
   *
   * 🔴 读失败必须抛，**绝不能返回 0** —— 「查不到」和「查炸了」返回同一个值，
   *    正是这个仓库反复踩的坑；在这里踩会让首次激活的空库闸形同虚设。
   */
  countExistingPages(clientId: string): Promise<number>

  /**
   * 写入被接受的页面，返回**实际写进去**的 canonical URL 清单。
   *
   * 返回值不是回声：激活方会拿它跟被接受集合做精确比对，对不上就不许报「完成」。
   *
   * 🔴 `requireEmptyInventory` 为真时，实现方**必须在同一个事务 / 条件写里**
   *    重新确认该租户台账仍为空，做不到就抛。
   *    「先读一次 count 再写」不算数：抓取要跑几分钟，那一眼早就过期了。
   *    两次首次激活并发跑（或旧的 site-audit 任务在中间写了几行），双方都能读到 0、
   *    各自跟自己的写入结果精确对账、各自报 activated —— 而台账是两份清单的并集，
   *    已经不是任何一份被批准的清单。
   */
  writeAcceptedPages(input: {
    readonly clientId: string
    readonly pages: readonly AcceptedPageRecord[]
    readonly requireEmptyInventory: boolean
  }): Promise<readonly string[]>
}

/**
 * 一条被接受的页面记录。
 *
 * 🔴 字段只用现有 `client_site_pages` 已有的列 —— 本次不加列、不加表、不做 migration。
 * 🔴 **故意不带 `status_code`**：现有抓取链路走 Jina，成功即记 200
 *    （`crawler.ts:437`），那个 200 证明的是「Jina 返回成功」，不是原始 URL 的 HTTP 状态，
 *    更不是重定向证据。把它当状态写进台账就是拿假证据充数。这一列留空 = 诚实的「未知」。
 */
export interface AcceptedPageRecord {
  readonly canonicalUrl: string
  readonly path: string
  readonly title: string
  readonly markdown: string
  readonly wordCount: number
  readonly pageType: string
  readonly topics: readonly string[]
  readonly primaryKeyword: string | null
  readonly classificationConfidence: number
  readonly hasGeoBlock: boolean
  readonly geoDetectionMethod: string | null
  readonly geoConfidence: number
  readonly crawledAt: string
}

export type ActivationStatus =
  /** 全部被接受页面抓取+分类成功、且确切写进台账 */
  | 'activated'
  /**
   * 闸门没过 —— **一次抓取都没发生**，一行都没写。
   *
   * 🔴 这一条是承诺，不是描述：读审计的人（以及重试 / 成本判断）靠它认定「这次没花过网络成本」。
   *    抓取之后才出的问题一律记 `failed`，哪怕一行都没写。
   */
  | 'rejected'
  /** 抓取已经发生，但执行没能满足「被接受集合」契约 —— 不许当成完成。台账碰没碰过看 `inventoryTouched`。 */
  | 'failed'

export interface ActivationBlocker {
  readonly code: string
  readonly message: string
}

export interface ActivationCounts {
  readonly accepted: number
  readonly rejected: number
  readonly deferred: number
  readonly crawlFailed: number
  readonly written: number
}

export interface ActivationAudit {
  readonly status: ActivationStatus
  readonly clientId: string
  readonly planHash: string
  readonly normalizationRuleVersion: string
  readonly counts: ActivationCounts
  readonly acceptedUrls: readonly string[]
  readonly rejectedUrls: readonly { readonly url: string; readonly reasonCodes: readonly RejectionReasonCode[] }[]
  readonly deferredUrls: readonly { readonly url: string; readonly reasonCodes: readonly RejectionReasonCode[] }[]
  readonly failedUrls: readonly { readonly url: string; readonly error: string }[]
  readonly writtenUrls: readonly string[]
  readonly blockers: readonly ActivationBlocker[]
  /**
   * 这次激活**有没有碰过台账**。
   *
   * 🔴 `status === 'failed'` 且这一项为 true = 库里可能已经有行了，必须人工核对，不能直接重跑。
   *    照抄 geo-baseline store 的 `committed` 语义：失败也要说清楚失败在写之前还是写之后。
   */
  readonly inventoryTouched: boolean
  /**
   * 重定向证据的可得性。
   *
   * 现有链路拿不到原始 URL 的真实 HTTP 状态与最终跳转目标，所以这里恒为
   * `'unavailable'`，让读审计的人一眼看见「重定向没被验证过」，而不是以为验过了。
   */
  readonly redirectEvidence: 'unavailable'
}

/**
 * 激活的外部依赖。抓取与富集都注入 —— 默认实现在 `adapters.ts`，直接复用现有 site-audit。
 */
export interface ActivationDeps {
  readonly store: CanonicalInventoryStore
  /**
   * 验签。返回 false 一律拒。
   *
   * 🔴 必须是**调用方无法自助重算**的东西（带密钥的 HMAC / 非对称签名）。
   *    注入一个恒真的实现，这道闸就等于没有 —— 那是注入方的责任，跟 store 一样。
   */
  readonly verifyReviewSignature: (planHash: string, signature: string) => boolean
  readonly crawl: (urls: readonly string[]) => Promise<readonly CrawlResult[]>
  readonly enrich: (page: { url: string; title: string; markdown: string }) => Promise<EnrichedPage>
  /** ISO 8601 时间源，注入以便测试确定性。 */
  readonly now: () => string
}

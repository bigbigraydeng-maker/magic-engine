/**
 * Magic Engine 2.0 · 站点页面台账（canonical inventory）的契约
 * Issue #930（WP05 前置）· Issue #960（生成时可信锚点，本次冻结版）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这一层解决什么
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 现有 site-audit 能发现页面、抓取、分类、检测 GEO 块、按租户落库 —— 那些**全部复用**。
 * 缺的是「页面身份」本身：精确主机边界、版本化 URL 归一、可复核的无写入计划、
 * fail-closed 的激活闸。#930 建成了这四样。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * #960 补的是什么：锚点盖在**生成时**，不是复核时
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * #930 的计划自带一个 `planHash`，但那是**公开函数**算的。计划以文件 / 界面形式
 * 在信任边界外面转一圈时，一个足够细心的编辑者可以：
 *
 *   - 往候选里**插入**一条已批准主机上、discovery 从没发现过的 URL；
 *   - **删掉**一条候选（malformed / 未批准主机的尤其隐蔽）；
 *   - 把某条候选的 `originalUrl` 与 `canonicalUrl` **成对**换成另一个真实页面；
 *
 * 然后同步改 `discovery[].count` 与 `counts`、重算哈希 —— 所有「重新推导再对账」的闸
 * 比对的两边**都来自这同一份可编辑对象**，于是全部通过，服务端照常盖章，
 * 最终抓取并写入一个没人复核过的页面。这是内部自洽性检查方法的结构性上限，
 * 不是漏了某个字段。
 *
 * 所以 #960 引入**两层签名**，且第一层盖在工件离开服务端的那一刻：
 *
 *   L1 `generation envelope`（生成信封）
 *       回答：**这份候选集合就是 discovery 当时产出的那一份。**
 *       服务端持 `K_gen`，编辑者拿不到 ⇒ 改任何一个字段都签不回去。
 *
 *   L2 `review integrity attestation`（复核完整性凭证）
 *       回答：**这份复核决策被服务端签过、之后没被改，且绑定到确切的那一份 L1。**
 *       🔴 它**不**证明 `reviewedBy` 那个人真的批准了 —— `reviewedBy` 仍是调用方
 *          提交的字符串。**不得**把它描述成身份认证 / 不可抵赖 / 法律意义上的签署。
 *          真实的人工授权来自工件之外（Product Owner 对确切客户、主机、写入动作的单独授权）。
 *
 * 🔴 候选数组**不再是复核的输入**。复核只提交 `ReviewSubmission`（决策 + 认账），
 *    机器候选原封不动待在被签过的 `core` 里。编辑者连「改一个字段再重签」的机会都没有。
 *
 * 🔴 这一层**不含任何客户常量**。租户、域名、被批准的主机全部从调用方进来。
 */

import type { EnrichedPage } from '../page-enrichment'
import type { CrawlResult } from '../crawler'
import type { SignatureVerifier } from './signing'

// ---------------------------------------------------------------------------
// 版本号 —— 计划一旦被人复核过，规则再改就必须换版本，否则旧批准会被新语义偷偷复用
// ---------------------------------------------------------------------------

/**
 * 计划结构本身的版本。
 *
 * `@2`：候选携带的是**机器决策**（`pending` / `rejected`），人工决策移到
 * `ReviewSubmission` 里；`acknowledged` 从发现摘要移到复核提交项。
 * 旧的 `@1` 结构没有生产调用方、没有已生成工件，因此**不做降级兼容**。
 */
export const INVENTORY_PLAN_CONTRACT_VERSION = 'canonical-inventory-plan@2'

/**
 * 信封结构与签名原文拼法的版本。
 *
 * 🔴 改 `canonicalJson` 的任何一条规则、改签名原文的拼接方式、改 digest 覆盖面，
 *    都必须升这个版本 —— 它进 digest 也进签名原文，旧信封会立刻验不过。
 */
export const INVENTORY_ENVELOPE_VERSION = 'canonical-inventory-envelope@1'

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
 * 机器在生成阶段能给出的处置。**只有这两个值**。
 *
 * 🔴 `accepted` 不在这里 —— 生成阶段造不出一条 accepted，
 *    所以「计划里预置一条 accepted 再重算哈希」这条路在类型层就没有入口。
 */
export type MachineDecision = 'pending' | 'rejected'

/** 复核人能给出的处置。 */
export type ReviewerDecision = 'accepted' | 'rejected' | 'defer'

/** 审计里出现的完整处置集合（机器的 + 人工的）。 */
export type CandidateDecision = MachineDecision | ReviewerDecision

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
// 发现
// ---------------------------------------------------------------------------

/**
 * 逐个批准主机的发现结果。
 *
 * 🔴 **必须进 core、进 digest。** 只在发现阶段返回一份 `perHost` 是不够的：
 *    调用方把 `urls` 喂进计划、`perHost` 丢在一边，就能批准并激活一份
 *    **整个主机静默缺席**的台账 —— 而缺页没有任何人会发现。
 *
 * 🔴 这里**没有** `acknowledged` 字段（#930 时它在这儿）。原因：它当时是**生成入参**，
 *    自动化调用方可以自己补上，于是「0 条 / 出错必须有人认」那道闸对脚本形同虚设。
 *    #960 把它移到 `ReviewSubmission.acknowledgements`，要求写明**谁**认的、**为什么**认。
 */
export interface HostDiscoverySummary {
  readonly host: string
  /** **这个主机自己的**页面数（按解析后的 hostname 精确归属）。 */
  readonly count: number
  /** 发现这个主机时返回的、其实属于别的主机的条数。记着不丢，但不算它「有页面」。 */
  readonly foreignCount: number
  readonly error: string | null
}

/**
 * 一次逐主机发现的完整结果。
 *
 * 🔴 `urls` 与 `perHost` 打包成**一个**值传给计划构造器，不是两个独立入参 ——
 *    两个入参可以来自两次不同的发现（或者传参时被截断），而合并后的清单看不出这件事。
 */
export interface DiscoveryOutcome {
  /** 所有主机合并去重后的原始 URL。 */
  readonly urls: readonly string[]
  /** 每个主机各自发现了多少 —— 0 条也要看得见，不许被合并结果盖住。 */
  readonly perHost: readonly HostDiscoverySummary[]
}

// ---------------------------------------------------------------------------
// 生成的计划核心（L1 签名覆盖的全部内容）
// ---------------------------------------------------------------------------

export interface MachineCandidate {
  /** 发现阶段拿到的原始 URL，原样保留（审计要能追回来源）。 */
  readonly originalUrl: string
  /** 归一后的 canonical URL；规则上就过不去的候选是 `null`。 */
  readonly canonicalUrl: string | null
  readonly machineDecision: MachineDecision
  readonly reasonCodes: readonly RejectionReasonCode[]
  readonly notes: readonly NormalisationNote[]
  /** 撞车时指向「留下的那一条」的原始 URL。 */
  readonly duplicateOf?: string
}

/** 生成阶段的计数。这里**不可能**有 accepted / deferred —— 那是复核之后才有的东西。 */
export interface GeneratedPlanCounts {
  readonly discovered: number
  readonly pending: number
  readonly rejected: number
}

/**
 * 计划核心。**整份进 digest**，因此每一个字段都是「批准后不能被悄悄改」的东西。
 */
export interface GeneratedPlanCore {
  readonly contractVersion: string
  readonly normalizationRuleVersion: string
  readonly clientId: string
  readonly boundary: HostBoundary
  /** 逐主机发现结果 —— 与 `boundary.approvedHosts` 一一对应，一个都不能少。 */
  readonly discovery: readonly HostDiscoverySummary[]
  readonly candidates: readonly MachineCandidate[]
  readonly counts: GeneratedPlanCounts
}

// ---------------------------------------------------------------------------
// L1：生成信封
// ---------------------------------------------------------------------------

/**
 * 签名覆盖面。
 *
 * 🔴 `planId` 与 `issuedAt` **必须在这里面**。第一版设计把它们放在 core 外面、
 *    只签 `envelopeVersion ‖ keyId ‖ digest(core)` —— 于是编辑者改 `issuedAt` 就能
 *    绕过有效期闸、改 `planId` 就能破坏 L1↔L2 的绑定，而签名照样有效。
 *    「声称受保护、实际不在覆盖面内」正是本 issue 要修的那类错误的另一种形态。
 */
export interface UnsignedEnvelope {
  readonly envelopeVersion: string
  readonly keyId: string
  /** 这一次生成的一次性标识（uuid）。由调用方注入的 id 源提供。 */
  readonly planId: string
  /** 生成时刻，ISO 8601。有效期闸靠它，所以它必须被签。 */
  readonly issuedAt: string
  readonly core: GeneratedPlanCore
}

export interface InventoryPlanEnvelope extends UnsignedEnvelope {
  /** `SHA256(canonicalJson(UnsignedEnvelope))`。验签前必须**重算**再比，不能只信这一栏。 */
  readonly generationDigest: string
  /** `HMAC(K_gen, canonicalJson({envelopeVersion, keyId, generationDigest}))`。 */
  readonly generationSignature: string
}

// ---------------------------------------------------------------------------
// L2：复核完整性凭证
// ---------------------------------------------------------------------------

/**
 * 复核人对某个主机「发现不完整，我知道，继续」的认账。
 *
 * 0 条可能是站是空的，也可能是被 WAF 挡了 —— 两者长得一模一样，只能由人来分。
 * 🔴 必须写明**谁**认的、**为什么**认：一个没署名的 `acknowledged: true` 等于没人认过。
 */
export interface HostAcknowledgement {
  readonly acknowledgedBy: string
  readonly reason: string
}

export interface ReviewDecisionEntry {
  readonly decision: ReviewerDecision
  /** 人工原因码；不给的话按决策自动补 `reviewer_rejected` / `reviewer_deferred`。 */
  readonly reasonCodes?: readonly RejectionReasonCode[]
}

/**
 * 复核人唯一能提交的东西。
 *
 * 🔴 这里**没有候选数组**。人只能对已经被签过的候选说「接受 / 拒绝 / 暂缓」，
 *    不能替换、增加或删除任何一条候选的身份。
 */
export interface ReviewSubmission {
  /** 指回具体那一份信封。两项都必须与信封逐字相等。 */
  readonly planId: string
  readonly generationDigest: string
  readonly reviewedBy: string
  /** ISO 8601。由调用方给，不在这一层取当前时间。 */
  readonly reviewedAt: string
  readonly note?: string
  /**
   * `reviewedBy` 这个名字是怎么来的。
   *
   * 🔴 当前契约里**只有** `'self_reported'` 一个合法值，运行时逐字校验。
   *    不接受 `'authenticated_session'` —— 那个值现在没有任何东西能产生它，
   *    允许调用方填就等于允许 agent 谎称「我是认证会话来的」。
   *    真正接入 Auth / UI 时必须**升契约版本**，并由可信组合根注入这个字段。
   *
   * 🔴 它只有一个合法值，但**不许因此把它删掉**：它进 digest，也进审计输出 ——
   *    读审计的人一眼看见「这个名字是自报的」，将来的契约升级也才检测得出来。
   */
  readonly reviewerIdentitySource: 'self_reported'
  /** 按**原始 URL** 索引的人工决策。 */
  readonly decisions: Readonly<Record<string, ReviewDecisionEntry>>
  /** 按**主机名**索引的不完整发现认账。 */
  readonly acknowledgements: Readonly<Record<string, HostAcknowledgement>>
}

/**
 * 复核完整性凭证。
 *
 * 🔴 措辞纪律：它证明的是「这份 review 内容被持 `K_rev` 的服务签过、之后没被改」。
 *    它**不**证明 `reviewedBy` 那个人真的亲自批准了。
 */
export interface SignedReview {
  readonly envelopeVersion: string
  readonly keyId: string
  readonly submission: ReviewSubmission
  /** `SHA256(canonicalJson(submission))`。验证时**重算**再比。 */
  readonly reviewDigest: string
  /** `HMAC(K_rev, canonicalJson({envelopeVersion, keyId, reviewDigest}))`。 */
  readonly reviewAttestation: string
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
 * 🔴 **故意不带 `status_code`**：现有抓取链路走 Jina，成功即记 200，那个 200 证明的是
 *    「Jina 返回成功」，不是原始 URL 的 HTTP 状态，更不是重定向证据。这一列留空 =
 *    诚实的「未知」。
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
  /** 抓取已经发生，但执行没能满足「被接受集合」契约 —— 不许当成完成。 */
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
  /** 这一次激活跑的是哪一份信封 —— 审计要能唯一定位它。 */
  readonly planId: string
  readonly generationDigest: string
  readonly generationKeyId: string
  readonly reviewKeyId: string
  readonly issuedAt: string
  /** 见 `ReviewSubmission.reviewerIdentitySource`：读审计的人必须看见名字是自报的。 */
  readonly reviewerIdentitySource: string
  /** 凭证模型标识。换签名方案必须换这个值，否则旧审计读起来像新方案跑出来的。 */
  readonly attestationModel: 'server-hmac@1'
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
   * 验 L1 生成签名。
   *
   * 🔴 必须是**调用方无法自助重算**的东西（带密钥的 HMAC）。注入一个恒判 `valid`
   *    的实现，这道闸就等于没有 —— 那是注入方的责任，跟 store 一样，架构测试盯着。
   */
  readonly verifyGenerationSignature: SignatureVerifier
  /** 验 L2 复核凭证。与 L1 用**不同**的密钥。 */
  readonly verifyReviewAttestation: SignatureVerifier
  readonly crawl: (urls: readonly string[]) => Promise<readonly CrawlResult[]>
  readonly enrich: (page: { url: string; title: string; markdown: string }) => Promise<EnrichedPage>
  /** ISO 8601 时间源，注入以便测试确定性。有效期闸也用它。 */
  readonly now: () => string
}

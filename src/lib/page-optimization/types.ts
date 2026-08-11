/**
 * Magic Engine 2.0 · Page Optimization 共享能力 —— 纯类型（Issue #878 / WP06）
 *
 * 覆盖 `resolve → snapshot → draft → diff → validate` 五段里除 snapshot 之外
 * 的所有形状（snapshot 的实现落在 `src/lib/capabilities/page-optimization/`，
 * 因为它要读 provider，但它产出的 `PageSnapshot` 类型定义在这里，供两侧共用）。
 *
 * 🔴 本文件只描述形状，不做任何事——没有网络调用、没有落库、没有 provider
 *    客户端 import。冻结见：
 *    `docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md`
 *    `docs/specs/2026-08-10-me2-page-optimization-capability-v1.0.md`
 *
 * 🔴 v1 冻结的字段集合就是 `PAGE_OPTIMIZATION_FIELDS` 这三个——不许加 slug /
 *    excerpt / schema / focus keyphrase，也不许做成开放注册表
 *    （2026-08-11 Build Control Room 实施指令，第 3 条）。
 *
 * 🔴 `PageOptimizationRequest` / `PreparedPageChange` 系列类型必须是
 *    `GrowthJsonValue` 兼容的（JSON-safe：无 `undefined`、无函数、无 class
 *    实例、无 `Date`）——GEO Module（WP05）会把它们塞进
 *    `GrowthActionCandidate.input: { [key: string]: GrowthJsonValue }`。
 *
 * 🔴 这里没有任何 authorization / approval 字段。授权只能由 Kernel 依客户
 *    政策签发，本模块只产出候选（WP00 §5.4）。
 */

import type { GrowthMaybeUnknown, GrowthVerificationDefinition } from '@/lib/growth'
import type { PageUpgradeExecutionPlan } from '@/lib/cms/page-upgrade-plan'

// ── 共用字段词汇（v1 冻结为恰好三个） ───────────────────────────────────────────

export const PAGE_OPTIMIZATION_FIELDS = ['meta_title', 'meta_description', 'content_html'] as const

export type PageOptimizationField = (typeof PAGE_OPTIMIZATION_FIELDS)[number]

// ── PageOptimizationRequest（Domain Module 产出，WP06 消费） ───────────────────

/**
 * 一条字段级的修改意图。
 *
 * 🔴 `proposedValue` 必须由调用方（Domain Module / WP05）给出——WP06 不调用
 *    模型，不生成任何内容（2026-08-11 实施指令第 4 条）。draft 阶段只做
 *    「拿这个值去核对快照、决定改不改得动」，不做「想一个值出来」。
 */
export interface PageOptimizationIntent {
  readonly field: PageOptimizationField
  readonly proposedValue: string
  /** 为什么要改这个字段——可选的语义说明，供人审阅时看，不参与校验逻辑。 */
  readonly semanticIntent: GrowthMaybeUnknown<string>
}

/**
 * Domain Module 能产出的最强东西：一个请求，不是一次执行（WP00 §5.4）。
 *
 * 三条冻结（Page 契约 §2）：
 *   1. 不含任何 provider 专有字段名；
 *   2. 不携带授权；
 *   3. 同一份请求可以路由到不同 provider。
 */
export interface PageOptimizationRequest {
  readonly clientId: string
  readonly page: { readonly url: string }
  readonly intents: readonly PageOptimizationIntent[]
  /** 指回 Finding，不重复携带 Evidence 全文。 */
  readonly lineage: { readonly findingRefs: readonly string[] }
  /** 在动作发生之前写下的判据——直接复用 WP01 冻结的形状，不重新发明。 */
  readonly verification: GrowthVerificationDefinition
  /** 明确不能碰什么。 */
  readonly constraints: { readonly doNotTouch: readonly PageOptimizationField[] }
  /** 提出请求时看到的页面版本标识；第一次提出通常是 unknown。 */
  readonly basedOnVersion: GrowthMaybeUnknown<string>
}

// ── resolve ─────────────────────────────────────────────────────────────────

/**
 * 规范页面身份——跟路由决策是两件不同的事（Page 契约 §3.1）。
 *
 * Roman 今天没有页面台账，解析不出来就必须显式 unknown，不许猜
 * （2026-08-11 实施指令：「Unknown Roman provider/page identity stays
 * explicitly unknown; never infer it」）。
 */
export type PageCanonicalIdentity = GrowthMaybeUnknown<{
  readonly domain: string
  readonly normalizedPath: string
}>

export interface PageResolution {
  /** 这个 URL 该走哪个 provider——直接复用 `resolvePageUpgradeExecution`。 */
  readonly routing: PageUpgradeExecutionPlan
  readonly canonicalIdentity: PageCanonicalIdentity
}

// ── snapshot（类型定义在这里；实现在 capabilities/page-optimization/snapshot.ts） ─

export interface GithubPageSnapshot {
  readonly ok: true
  readonly provider: 'github'
  readonly fetchedAt: string
  readonly rawContent: string
  /** GitHub blob SHA——乐观并发令牌，`commitFile` 原生按它拒绝过期提交。 */
  readonly versionToken: string
}

export interface WordpressPageSnapshot {
  readonly ok: true
  readonly provider: 'wordpress'
  readonly fetchedAt: string
  readonly rawFields: {
    readonly title: string
    readonly content: string
    readonly seoTitle: string
    readonly seoDescription: string
  }
  /** WP `modified` 时间戳——当前没有任何调用方在写回前用它做过期比对，WP06 开始保留它。 */
  readonly versionToken: string
}

/**
 * Shopify 没有「更新已有页面」的实现（`shopify-client.ts` 只有创建方法）；
 * 未连接同理。两者都必须显式声明不可用，不许伪造一份「看起来存在」的快照
 * （2026-08-11 实施指令：「no fake existing-page snapshot」）。
 */
export interface UnavailablePageSnapshot {
  readonly ok: false
  readonly provider: 'shopify' | 'none'
  readonly reason: string
}

export type PageSnapshot = GithubPageSnapshot | WordpressPageSnapshot | UnavailablePageSnapshot

// ── draft ───────────────────────────────────────────────────────────────────

export interface PageDraftField {
  readonly field: PageOptimizationField
  readonly value: string
}

export type PageDraftResult =
  | { readonly ok: true; readonly fields: readonly PageDraftField[] }
  | { readonly ok: false; readonly reason: string }

// ── diff（字段级，仅此四项：field + before + after + changed） ─────────────────

export interface PageFieldDiff {
  readonly field: PageOptimizationField
  readonly before: string
  readonly after: string
  readonly changed: boolean
}

export type PageDiffResult =
  | { readonly ok: true; readonly changes: readonly PageFieldDiff[] }
  | { readonly ok: false; readonly reason: string }

// ── validate ────────────────────────────────────────────────────────────────

/**
 * 客户红线短语——由调用方显式传入，validate 本身不查 Supabase。
 *
 * 🔴 `available: false` 必须 fail closed，不许被读成「没有红线」
 *    （与 `src/lib/factory/strategist.ts` 的 `gate1` 同一语义：
 *    「查不到红线 ≠ 没有红线」）。
 */
export type RedlineCheckInput =
  | { readonly available: true; readonly phrases: readonly string[] }
  | { readonly available: false; readonly reason: string }

/**
 * provider 侧校验结果——由调用方算好后作为显式结果传入（或用纯函数算好再传），
 * validate 本身不 import 任何 provider 客户端。
 *
 * 🔴 `evaluated: false`（没算过）绝不能被表示成「通过」——这正是
 *    「validation failure/not-evaluated cannot be represented as passed」
 *    这条要求的类型层落地。
 *
 * 🔴 三态判别式联合，不是 `{ evaluated: true; passed: boolean; violations }`——
 *    那个形状允许 `{ evaluated:true, passed:true, violations:['实际失败'] }`
 *    这种自相矛盾的值同时存在，等于把「失败」表示成了「通过」（2026-08-11
 *    Build Control Room PATCH REQUIRED 复审第 1 条）。`passed:true` 分支
 *    干脆没有 `violations` 字段——没有地方能藏一条被判"通过"但列着的失败。
 */
export type ProviderCheckInput =
  | { readonly evaluated: false; readonly reason: string }
  | { readonly evaluated: true; readonly passed: true }
  | { readonly evaluated: true; readonly passed: false; readonly violations: readonly string[] }

export type PageValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly violations: readonly string[] }

/**
 * ME2 Product Map —— GitHub 只读同步层的类型契约(WP: ME2 Product Map v1,PR 2/3)。
 *
 * 与 `src/lib/product-map/`(PR1,纯登记/推导层)是兄弟目录:
 * PR1 那层永远不碰网络和数据库,本层负责把 GitHub 的动态事实抓回来、原子落库,
 * 再经 facts-adapter 转成 PR1 推导要吃的 `ExternalFacts`。
 *
 * 🔴 新鲜度契约(设计定稿第 5 条,PR3 必须遵守):
 *   没有行级 stale 布尔 —— 它盖不住「限流中止根本没轮到」的条目。
 *   每行带 observed_at + sync_run_id;快照的聚合新鲜度取 **min(observed_at)**;
 *   最新 run 的 status(ok|partial|error)与 stats 必须随快照一起暴露,
 *   partial 在控制台上必须可见,不许把半新半旧当成一致快照展示。
 */

export const SYNC_TRIGGER = ['webhook', 'cron', 'manual'] as const
export type SyncTrigger = (typeof SYNC_TRIGGER)[number]

export const SYNC_RUN_STATUS = ['ok', 'partial', 'error'] as const
export type SyncRunStatus = (typeof SYNC_RUN_STATUS)[number]

/** full = 全量对账(允许收编 unclassified);targeted = webhook 触发的单号码刷新。 */
export const SYNC_MODE = ['full', 'targeted'] as const
export type SyncMode = (typeof SYNC_MODE)[number]

export const DELIVERY_STATUS = ['processed', 'skipped_duplicate', 'failed'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUS)[number]

// ---------------------------------------------------------------------------
// Provider 返回的事实形状(未落库)
// ---------------------------------------------------------------------------

export interface CheckFact {
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

export interface PrFactDetail {
  readonly number: number
  readonly state: 'open' | 'merged' | 'closed'
  readonly isDraft: boolean
  readonly baseRef: string
  /** 当前 head SHA —— checks 永远与它绑定,旧 head 的检查不许充新 head 的。 */
  readonly headSha: string
  readonly mergedCommitSha: string | null
  /**
   * GitHub 异步计算,首查常为 'unknown'。落库规则(设计定稿第 8 条):
   * unknown 不覆盖既有的非 unknown 值。
   */
  readonly mergeableState: string
  readonly unresolvedThreads: number | null
  /**
   * unresolvedThreads 抓不到时的原因(抓到 = null)。
   * 🔴 null 计数必须配非空原因 —— 「只剩一个 null,没人说得出为什么」就是静默失败。
   */
  readonly unresolvedThreadsError: string | null
  /** 与 headSha 绑定的检查汇总。 */
  readonly checks: readonly CheckFact[]
  /** checks 只取第一页(100 条),有更多时明说(silent cap 禁令)。 */
  readonly checksTruncated: boolean
  /** 上限 100 条;被截断时 truncated=true(silent cap 禁令)。 */
  readonly changedFiles: readonly string[]
  readonly changedFilesTruncated: boolean
  readonly title: string
  readonly body: string
  readonly updatedAt: string
  readonly observedAt: string
}

export interface IssueFact {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly title: string
  readonly body: string
  readonly updatedAt: string
  readonly observedAt: string
}

export interface RecentWorkItem {
  readonly kind: 'pr' | 'issue'
  readonly number: number
  readonly title: string
  readonly body: string
  readonly url: string
  readonly openedAt: string
}

// ---------------------------------------------------------------------------
// 落库行形状(与 migration 一一对应;fake store 按表建模)
// ---------------------------------------------------------------------------

export interface SyncRunRow {
  readonly id: string
  readonly trigger: SyncTrigger
  readonly mode: SyncMode
  readonly status: SyncRunStatus
  readonly main_head_sha: string | null
  readonly started_at: string
  readonly finished_at: string | null
  readonly stats: SyncStats
  readonly error_message: string | null
}

export interface PrFactRow {
  readonly pr_number: number
  readonly state: 'open' | 'merged' | 'closed'
  readonly is_draft: boolean
  readonly base_ref: string
  readonly head_sha: string
  readonly merged_commit_sha: string | null
  readonly mergeable_state: string
  readonly unresolved_threads: number | null
  /** `{ sha, checks: CheckFact[], truncated }` —— sha 键控。 */
  readonly checks: {
    readonly sha: string
    readonly checks: readonly CheckFact[]
    readonly truncated: boolean
  }
  readonly changed_files: readonly string[]
  readonly changed_files_truncated: boolean
  readonly title: string
  readonly observed_at: string
  readonly sync_run_id: string
}

export interface IssueFactRow {
  readonly issue_number: number
  readonly state: 'open' | 'closed'
  readonly title: string
  readonly updated_at: string
  readonly observed_at: string
  readonly sync_run_id: string
}

export interface UnclassifiedWorkRow {
  readonly kind: 'pr' | 'issue'
  readonly number: number
  readonly title: string
  readonly url: string
  readonly opened_at: string
  readonly first_seen_at: string
  readonly last_seen_at: string
  readonly resolved_at: string | null
}

export interface WebhookDeliveryRow {
  readonly delivery_id: string
  readonly event: string
  readonly action: string | null
  readonly received_at: string
  readonly status: DeliveryStatus
  readonly error_message: string | null
}

export interface SyncStats {
  readonly prsSynced: number
  readonly issuesSynced: number
  readonly unclassifiedSeen: number
  /** 抓取失败、留旧行的号码(last-known-good 语义)。 */
  readonly failedItems: readonly string[]
  /** RPC 单调守卫跳过的旧数据写入(observed_at 早于现有行)。 */
  readonly skippedStale: number
  /** 分页/条数截断记录 —— silent cap 禁令。 */
  readonly truncations: readonly string[]
  /**
   * review threads(GraphQL)抓不到的 PR 及原因,一条一个 `pr#N: 原因`。
   * 它是 partial 的**说明书**:unresolved_threads 为空必然在这里有对应行。
   */
  readonly threadsFailures: readonly string[]
  /** 每日 cron 额外统计:自上一次 full 轮以来 status=error 的 webhook runs 数。 */
  readonly webhookErrorRunsSinceLastFull?: number
  readonly deliveriesPruned?: number
}

export const EMPTY_SYNC_STATS: SyncStats = Object.freeze({
  prsSynced: 0,
  issuesSynced: 0,
  unclassifiedSeen: 0,
  failedItems: [],
  skippedStale: 0,
  truncations: [],
  threadsFailures: [],
})

// ---------------------------------------------------------------------------
// 错误(typed,不吞;调用方按类型分流)
// ---------------------------------------------------------------------------

/** 同步表尚未 apply 到目标数据库(本 PR 不执行 migration,这是合并后的常态)。 */
export class NotProvisionedError extends Error {
  constructor(detail: string) {
    super(`product-map sync 未 provision:${detail}`)
    this.name = 'NotProvisionedError'
  }
}

/** 响应里的仓库与 APPROVED_REPO 不符 —— fail closed,绝不入库。 */
export class RepoBoundaryError extends Error {
  constructor(got: string) {
    super(`仓库越界:收到 '${got}',只接受获准仓库`)
    this.name = 'RepoBoundaryError'
  }
}

/** REST 或 GraphQL 限流(两个独立配额池,GraphQL 打爆常以 200+errors 返回)。 */
export class RateLimitedError extends Error {
  constructor(readonly pool: 'rest' | 'graphql', detail: string) {
    super(`GitHub ${pool} 限流:${detail}`)
    this.name = 'RateLimitedError'
  }
}

export class GithubReadError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    // 🔴 错误信息绝不携带 token(github-client 同约定)
    super(`GitHub 读取失败(HTTP ${status}):${detail}`)
    this.name = 'GithubReadError'
  }
}

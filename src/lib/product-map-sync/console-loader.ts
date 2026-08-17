/**
 * 控制台数据载入 —— 四态判定住在这里(不在 page.tsx),因为它最容易写错
 * 却最没人测(子牙设计审 M7)。page 只负责调它 + 渲染。
 *
 * 四态互斥且穷尽:
 *   ok             同步表在、有数据
 *   not_provisioned 表还没建(合并 ≠ 上线,这是常态,不是故障)
 *   sync_error      读库炸了 —— **不吞**,摘要带出去显示
 *   never_synced    表在但零行(绝不显示成「同步结果为空」)
 *
 * 🔴 位置:住在 **sync(接线层)**而不是 product-map(纯层)——
 *    依赖方向只有一条:product-map(纯) ← product-map-sync(接线) ← page。
 *    反过来放就是目录成环(子牙设计审 M1)。
 */

import { buildProductMapSnapshot, MANUAL_FACTS_SNAPSHOT } from '@/lib/product-map'
import type { ExternalFacts } from '@/lib/product-map'
import { buildPresentation } from '@/lib/product-map/presenter'
import type {
  ConsolePresentation,
  IssueFactView,
  LoadOutcome,
  PrFactView,
  SyncRunView,
  UnclassifiedItemView,
} from '@/lib/product-map/presenter'
import { rowsToExternalFacts } from './facts-adapter'
import { NotProvisionedError } from './types'
import type { ProductMapSyncStore } from './store'

/** 错误摘要上限 —— Supabase 原始报错带 schema 细节,没必要印进 HTML(子牙 S4)。 */
const ERROR_SUMMARY_MAX = 200

export async function loadProductMapConsole(
  store: ProductMapSyncStore,
  now: Date = new Date(),
): Promise<ConsolePresentation> {
  let loadOutcome: LoadOutcome = 'ok'
  let loadErrorSummary: string | undefined
  let facts: ExternalFacts = MANUAL_FACTS_SNAPSHOT
  let latestRun: SyncRunView | null = null
  let lastFullRunAt: string | null = null
  let prFacts: PrFactView[] = []
  let issueFacts: IssueFactView[] = []
  let unclassified: UnclassifiedItemView[] = []
  let oldestObservedAt: string | null = null

  try {
    const [prRows, issueRows, unclassifiedRows, runRow, fullRunAt] = await Promise.all([
      store.readPrFacts(),
      store.readIssueFacts(),
      store.readUnclassified(),
      store.readLatestRun(),
      store.lastFullRunStartedAt(),
    ])

    // 真判据是「有没有跑过轮」:跑过一轮但零 PR ≠ 从没同步过(子牙二轮 9)
    if (runRow === null) {
      loadOutcome = 'never_synced'
    } else {
      const synced = rowsToExternalFacts(prRows, null)
      if (synced) {
        facts = synced.facts
        oldestObservedAt = synced.freshness.oldestObservedAt
      }
      prFacts = prRows.map((r) => ({
        number: r.pr_number,
        state: r.state,
        isDraft: r.is_draft,
        unresolvedThreads: r.unresolved_threads,
        title: r.title,
      }))
    }

    issueFacts = issueRows.map((r) => ({
      number: r.issue_number,
      state: r.state,
      title: r.title,
    }))
    unclassified = unclassifiedRows.map((r) => ({
      kind: r.kind,
      number: r.number,
      title: r.title,
      url: r.url,
      firstSeenAt: r.first_seen_at,
    }))
    latestRun = runRow
      ? {
          status: runRow.status,
          mode: runRow.mode,
          startedAt: runRow.started_at,
          finishedAt: runRow.finished_at,
          errorMessage: runRow.error_message,
          failedItems: runRow.stats?.failedItems ?? [],
          truncations: runRow.stats?.truncations ?? [],
          skippedStale: runRow.stats?.skippedStale ?? 0,
        }
      : null
    lastFullRunAt = fullRunAt
  } catch (err) {
    if (err instanceof NotProvisionedError) {
      loadOutcome = 'not_provisioned'
    } else {
      loadOutcome = 'sync_error'
      const raw = err instanceof Error ? err.message : String(err)
      loadErrorSummary = raw.slice(0, ERROR_SUMMARY_MAX)
    }
  }

  return buildPresentation({
    snapshot: buildProductMapSnapshot(facts),
    loadOutcome,
    loadErrorSummary,
    latestRun,
    lastFullRunAt,
    prFacts,
    issueFacts,
    unclassified,
    oldestObservedAt,
    now,
  })
}

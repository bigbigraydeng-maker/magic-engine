/**
 * 落库快照 → PR1 推导层的 `ExternalFacts`。
 *
 * 新鲜度契约(PR3 必须遵守,不许绕):
 * - freshness.oldestObservedAt 取 **min**(最老那行才是真实鲜度,max 会撒谎);
 * - latestRun 的 status/stats 随快照一起给,partial 必须在控制台可见;
 * - 空快照(未 provision / 从未同步)→ null,调用方降级到 MANUAL_FACTS_SNAPSHOT
 *   并明示来源 —— 不许把「没同步」显示成「同步结果为空」。
 */

import type { ExternalFacts, PullRequestFact } from '@/lib/product-map'
import type { PrFactRow, SyncRunRow } from './types'

export interface SyncedFacts {
  readonly facts: ExternalFacts
  readonly freshness: {
    readonly oldestObservedAt: string
    readonly newestObservedAt: string
  }
  readonly latestRun: SyncRunRow | null
}

export function rowsToExternalFacts(
  rows: readonly PrFactRow[],
  latestRun: SyncRunRow | null,
): SyncedFacts | null {
  if (rows.length === 0) return null
  const map: Record<number, PullRequestFact> = {}
  let oldest = rows[0].observed_at
  let newest = rows[0].observed_at
  for (const row of rows) {
    if (row.observed_at < oldest) oldest = row.observed_at
    if (row.observed_at > newest) newest = row.observed_at
    map[row.pr_number] = {
      number: row.pr_number,
      state: row.state,
      isDraft: row.is_draft,
      observedAt: row.observed_at.slice(0, 10),
      source: 'github_sync',
      // 🔴 base_ref 决定 merged 是否真进了 main —— 不能丢，codeInMain 靠它判 yes。
      baseRef: row.base_ref,
    }
  }
  return {
    facts: { pullRequests: map },
    freshness: { oldestObservedAt: oldest, newestObservedAt: newest },
    latestRun,
  }
}

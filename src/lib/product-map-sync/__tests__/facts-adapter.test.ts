/** 快照 → ExternalFacts:鲜度取 min,空快照 → null(降级路径由调用方走)。 */

import { describe, expect, it } from 'vitest'
import { buildProductMapSnapshot } from '@/lib/product-map'
import { rowsToExternalFacts } from '../facts-adapter'
import type { PrFactRow } from '../types'

function row(number: number, state: PrFactRow['state'], observedAt: string, baseRef = 'main'): PrFactRow {
  return {
    pr_number: number,
    state,
    is_draft: false,
    base_ref: baseRef,
    head_sha: `sha-${number}`,
    merged_commit_sha: state === 'merged' ? `m-${number}` : null,
    mergeable_state: 'clean',
    unresolved_threads: 0,
    checks: { sha: `sha-${number}`, checks: [], truncated: false },
    changed_files: [],
    changed_files_truncated: false,
    title: '',
    observed_at: observedAt,
    sync_run_id: 'run-x',
  }
}

describe('rowsToExternalFacts', () => {
  it('空快照 → null,不许把「没同步」冒充「同步结果为空」', () => {
    expect(rowsToExternalFacts([], null)).toBeNull()
  })

  it('鲜度取 min(最老那行才是真实鲜度,max 会撒谎)', () => {
    const synced = rowsToExternalFacts(
      [row(1, 'merged', '2026-08-10T00:00:00Z'), row(2, 'open', '2026-08-15T00:00:00Z')],
      null,
    )
    expect(synced?.freshness.oldestObservedAt).toBe('2026-08-10T00:00:00Z')
    expect(synced?.freshness.newestObservedAt).toBe('2026-08-15T00:00:00Z')
  })

  it('事实 source=github_sync,接进 PR1 推导后 factsSource=github_sync', () => {
    const synced = rowsToExternalFacts([row(863, 'merged', '2026-08-15T00:00:00Z')], null)
    expect(synced).not.toBeNull()
    const snapshot = buildProductMapSnapshot(synced?.facts)
    expect(snapshot.factsSource).toBe('github_sync')
  })

  it('base_ref 必须原样带到 baseRef —— codeInMain 靠它判 yes,丢了就会误判合到 staging 的 PR', () => {
    const synced = rowsToExternalFacts(
      [row(100, 'merged', '2026-08-15T00:00:00Z', 'main'), row(200, 'merged', '2026-08-15T00:00:00Z', 'staging')],
      null,
    )
    // 变异验证:若 adapter 丢掉 base_ref,两条 baseRef 都会是 undefined,下面第二条断言必红。
    expect(synced?.facts.pullRequests[100].baseRef).toBe('main')
    expect(synced?.facts.pullRequests[200].baseRef).toBe('staging')
  })
})

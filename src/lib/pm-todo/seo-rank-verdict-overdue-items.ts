/**
 * SEO 标题改动的「效果判定」没跑出来 —— 开发侧欠账，不是给人做的活。
 *
 * 标题周期每改一条线上标题就写一行 seo_meta_log。之后每日排名采样器会给
 * 有基线（baseline_rank_status 非空）的行写 rank_verdict：第 18 天起采第一次，
 * 3 个有效样本间隔 ≥2 天，所以到第 26 天左右就该有判定。2026-10-28 我们发现
 * 从来没有任何一条路会告诉人：一条已上线的改动一直没被判定。
 *
 * 两种静默状态：
 *  1) OVERDUE —— 有基线、没判定、上线超过 VERDICT_OVERDUE_DAYS 天。
 *  2) NO BASELINE —— 上线时没记下改前名次（baseline_rank_status 为空），
 *     且上线时间在 RANK_BASELINE_SINCE 之后 —— 这种改动永远判不了效果。
 *     该日期之前的行按设计不追踪，绝不能产出待办。
 *
 * 判据（classifyRankVerdictGap / buildRankVerdictGapItems）是纯函数，单独测；
 * 取数（pushRankVerdictGapItems）只读一张表，读失败由调用方兜底。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'

/** 上线多少天后还没判定就算超期 —— 正常第 26 天左右就该有。 */
export const VERDICT_OVERDUE_DAYS = 35

/** 基线采集上线的那天 —— 之前的行按设计不追踪。 */
export const RANK_BASELINE_SINCE = '2026-10-05T00:00:00Z'

export interface MetaLogRowLite {
  client_id: string
  page_slug: string
  page_url: string | null
  optimised_at: string
  pr_url: string | null
  reverted_at: string | null
  baseline_rank_status: string | null
  rank_verdict: string | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function parseTime(s: string): number {
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : NaN
}

/**
 * 一条 seo_meta_log 行属于哪种静默状态。纯函数。
 *
 * 只认已上线（pr_url 非空）、未回滚（reverted_at 为空）的行。
 * 有判定（rank_verdict 非空）的一律 null。
 */
export function classifyRankVerdictGap(row: MetaLogRowLite, now: Date): 'overdue' | 'no_baseline' | null {
  if (row.pr_url === null) return null
  if (row.reverted_at !== null) return null
  if (row.rank_verdict !== null) return null

  const optimisedAt = parseTime(row.optimised_at)
  if (!Number.isFinite(optimisedAt)) return null

  if (row.baseline_rank_status !== null) {
    // 有基线：上线超过 VERDICT_OVERDUE_DAYS 天还没判定 -> 超期。
    const ageDays = (now.getTime() - optimisedAt) / MS_PER_DAY
    return ageDays > VERDICT_OVERDUE_DAYS ? 'overdue' : null
  }

  // 没基线：只有基线采集上线之后的行才算欠账。
  const since = parseTime(RANK_BASELINE_SINCE)
  if (!Number.isFinite(since)) return null
  return optimisedAt >= since ? 'no_baseline' : null
}

function slugsText(slugs: string[]): string {
  return slugs.slice(0, 3).join('、')
}

/**
 * 把行按 (client, kind) 聚成待办。纯函数。
 *
 * 每个 (client, kind) 一条，列出最多 3 个 page_slug 加总数。
 * 保持首次出现的顺序。
 */
export function buildRankVerdictGapItems(
  rows: MetaLogRowLite[],
  now: Date,
  nameOf: (clientId: string) => string,
): ManualItem[] {
  interface Bucket {
    clientId: string
    kind: 'seo_rank_verdict_overdue' | 'seo_rank_baseline_missing'
    slugs: string[]
    count: number
  }

  const order: string[] = []
  const buckets = new Map<string, Bucket>()

  for (const row of rows) {
    const gap = classifyRankVerdictGap(row, now)
    if (gap === null) continue
    const kind = gap === 'overdue' ? 'seo_rank_verdict_overdue' : 'seo_rank_baseline_missing'
    const key = `${row.client_id}\u0000${kind}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { clientId: row.client_id, kind, slugs: [], count: 0 }
      buckets.set(key, bucket)
      order.push(key)
    }
    bucket.count += 1
    if (bucket.slugs.length < 3) bucket.slugs.push(row.page_slug)
  }

  return order.map((key) => {
    const bucket = buckets.get(key) as Bucket
    const name = nameOf(bucket.clientId)
    const slugs = slugsText(bucket.slugs)
    const what =
      bucket.kind === 'seo_rank_verdict_overdue'
        ? `「${name}」有 ${bucket.count} 条已上线的标题改动超过 ${VERDICT_OVERDUE_DAYS} 天还没有效果判定（例：${slugs}）—— 改了有没有用一直不知道`
        : `「${name}」有 ${bucket.count} 条标题改动上线时没记下改前名次（例：${slugs}）—— 这些改动永远判不了效果`
    return {
      kind: bucket.kind,
      client_id: bucket.clientId,
      client_name: name,
      what,
      how: '这条不用你动手 —— 是我们这边的欠账（排名判定没跑出来）。回我一句「修一下标题效果判定」我去查',
      href: `https://app.magicengine.com.au/dashboard/clients/${bucket.clientId}/seo-intelligence`,
    }
  })
}

/**
 * 读 seo_meta_log 里已上线、未回滚、还没判定的行，下发成待办。
 *
 * 读失败直接抛，由调用方（manual-items.ts）的 .catch 兜住 —— 跟本文件夹
 * 其他通道同一条纪律：一条通道读挂了不拖垮别的待办。
 */
export async function pushRankVerdictGapItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (clientId: string) => string,
): Promise<void> {
  const { data, error } = await supabase
    .from('seo_meta_log')
    .select('client_id, page_slug, page_url, optimised_at, pr_url, reverted_at, baseline_rank_status, rank_verdict')
    .not('pr_url', 'is', null)
    .is('reverted_at', null)
    .is('rank_verdict', null)
    .order('optimised_at', { ascending: true })
    .limit(500)

  if (error) throw new Error(`seo_meta_log query failed: ${error.message}`)

  const rows = (data ?? []) as MetaLogRowLite[]
  items.push(...buildRankVerdictGapItems(rows, now, nameOf))
}

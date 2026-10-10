/**
 * 竞品快照写入 —— `competitor_snapshots` 表的唯一写入口（补回 2026-08-05 被陪葬删掉的
 * 那段逻辑，见 watch.ts 文件头的背景说明）。
 *
 * 客户通用：只吃 clientId，域名清单一律走 resolver（getClientCompetitorDomains），
 * 不接受调用方传域名列表 —— 跟 CompetitorSnapshotAdapter 一样，保证「谁的竞品域名」
 * 只有一个真相源（resolver.ts 文件头的强制约定）。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getKeywordsForSite, type LabsKeyword } from '@/lib/dataforseo/labs'
import { locationCodeFor } from '@/lib/dataforseo/client'
import { getClientCompetitorDomains } from '@/lib/competitors/resolver'
import { MAX_COMPETITOR_DOMAINS } from '@/lib/competitors/watch'
import type { SnapshotOutcome } from '@/lib/competitors/watch'

/** 只算够格的关键词 —— 跟被删的老接口默认值一致，避免长尾噪音把 top_keywords 挤满。 */
const MIN_VOLUME = 100
/** 每个域名最多拉几条关键词 —— 跟老接口默认值一致。 */
const KEYWORDS_PER_DOMAIN_LIMIT = 50
/** `top_keywords` 只存前 N 条摘要（表设计本身如此，见 migration 注释）。 */
const TOP_KEYWORDS_LIMIT = 50

interface ScoredKeyword {
  keyword: string
  volume: number
  kd: number
}

/**
 * 逐域名打 DataForSEO —— 用 allSettled 不用 all：19 个域名里 1 个超时/报错不该把另外
 * 18 个已经成功、已经花了钱的结果一起扔掉。复审揪出来的坑：原来用 Promise.all，
 * 一个域名失败整份快照就抛异常、整周颗粒无收，还没有重试（重试等于重复扣费，见
 * watch.ts 的注释），下周一之前这个客户完全没有竞品数据。
 */
async function fetchAllDomains(domains: readonly string[], locationCode: number): Promise<LabsKeyword[][]> {
  const settled = await Promise.allSettled(
    domains.map((domain) => getKeywordsForSite(domain, locationCode, KEYWORDS_PER_DOMAIN_LIMIT)),
  )
  const ok: LabsKeyword[][] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      ok.push(result.value)
    } else {
      console.error(`[competitor-watch] ${domains[i]} 拉取失败，跳过（不影响其它域名）: ${String(result.reason)}`)
    }
  })
  return ok
}

/** 按 min_volume 过滤、按搜索量排出前 N 条摘要——抽出来只是为了把主函数压回 50 行以内。 */
function aggregateKeywords(perDomain: readonly LabsKeyword[][]): { keywordsCount: number; totalFetched: number; topKeywords: ScoredKeyword[] } {
  let keywordsCount = 0
  let totalFetched = 0
  const scored: ScoredKeyword[] = []

  perDomain.forEach((rawItems) => {
    totalFetched += rawItems.length
    rawItems
      .filter((item) => (item.search_volume ?? 0) >= MIN_VOLUME)
      .forEach((item) => {
        keywordsCount += 1
        scored.push({ keyword: item.keyword, volume: item.search_volume ?? 0, kd: item.keyword_difficulty ?? 0 })
      })
  })

  const topKeywords = scored.sort((a, b) => b.volume - a.volume).slice(0, TOP_KEYWORDS_LIMIT)
  return { keywordsCount, totalFetched, topKeywords }
}

/**
 * 给一个客户拍一次快照：解出竞品域名 → 逐个打 DataForSEO → 汇总写一行 `competitor_snapshots`。
 *
 * 🔴 域名清单为空（客户没配竞品）不算失败 —— 返回 domainsScanned=0，调用方
 *    （runOneClientWatch）会据此出 `no_data` 回执，不抛异常。
 */
export async function takeCompetitorSnapshot(clientId: string, semrushDb: string | null): Promise<SnapshotOutcome> {
  const domains = await getClientCompetitorDomains(clientId, [], MAX_COMPETITOR_DOMAINS)
  if (domains.length === 0) {
    return { domainsScanned: 0, keywordsWritten: 0 }
  }

  const db = semrushDb || 'au'
  const perDomain = await fetchAllDomains(domains, locationCodeFor(db))
  const { keywordsCount, totalFetched, topKeywords } = aggregateKeywords(perDomain)

  const { error } = await supabaseAdmin.from('competitor_snapshots').insert({
    client_id: clientId,
    production_package_id: null,
    competitor_domains: domains,
    semrush_db: db,
    min_volume: MIN_VOLUME,
    keywords_count: keywordsCount,
    units_consumed: totalFetched * 10,
    top_keywords: topKeywords,
  })

  if (error) throw new Error(`competitor_snapshots insert failed: ${error.message}`)

  return { domainsScanned: domains.length, keywordsWritten: keywordsCount }
}

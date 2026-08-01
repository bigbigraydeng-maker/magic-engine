/**
 * Weekly SERP capture (DataForSEO 接入计划 阶段 1).
 *
 * 对客户最新一期 keyword_snapshots 的全部关键词逐词跑一次 SERP
 * (getSerpPage, depth=10)，把结果里本来就自带的三样落库：
 *   1. local_pack_rank      → keyword_snapshots 既有列（5 月建好从没写过）
 *   2. AI Overview 出现/引用 → serp_ai_overview_snapshots
 *   3. SERP 前 10 organic 域名 → serp_ai_overview_snapshots.top_organic_domains
 *
 * 挂在 keyword-snapshots-weekly cron 第二步（同班车，不新建 Render cron ——
 * 新 cron 要手工 link 密钥组，daily-cron-digest 曾因此哑 51 天）。
 * 首版不开 load_async_ai_overview（spec：首月观察同步出现率）。
 *
 * spec: docs/superpowers/specs/2026-08-01-dataforseo-integration-plan.md § 阶段 1
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getSerpPage, type DfseSerpResult } from '@/lib/dataforseo/serp'
import {
  getLatestKeywordSnapshotForClient,
  locationCodeForDb,
  type KeywordSnapshotClient,
} from './keyword-snapshots'

/** 同时在飞的 SERP 请求数 —— DataForSEO live 单请求 1-3s，5 路并发把
 *  200 词/客户压进 ~2 分钟，全部客户仍在 cron 900s 预算内。 */
const SERP_CONCURRENCY = 5

export interface SerpCaptureClient extends KeywordSnapshotClient {
  name: string
  /** clients.brand_aliases — local pack 列表按名字匹配客户时用 */
  brand_aliases: string[] | null
}

export interface SerpSnapshotRow {
  client_id: string
  keyword: string
  location_code: number
  snapshot_date: string
  has_ai_overview: boolean
  client_cited: boolean
  cited_sources: string[]
  top_organic_domains: string[]
  measured_at: string
}

export interface SerpCaptureResult {
  client_id: string
  domain: string
  keywords_captured: number
  serp_rows_written: number
  local_pack_hits: number
  keywords_failed: number
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** "www.ctstours.co.nz/path" → "ctstours.co.nz" */
export function domainRoot(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .trim()
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** 短于此的 needle 只做全等匹配 —— "cts" 子串会命中 "produCTS"（魏征 🟡2）。 */
const MIN_SUBSTRING_LEN = 4

/**
 * 客户在 local pack 里的名次（1-3），不在返回 null。
 * 匹配优先级：listing domain 命中客户 domain 根 → listing 名字含
 * 客户 brand alias / 客户名（归一后子串匹配；短 needle 只全等）。
 */
export function resolveLocalPackRank(
  localPack: DfseSerpResult['local_pack'],
  client: { domain: string; name: string; brand_aliases: string[] | null },
): number | null {
  if (!localPack || localPack.length === 0) return null

  const clientRoot = domainRoot(client.domain)
  const nameNeedles = [client.name, ...(client.brand_aliases ?? [])]
    .map(normalise)
    .filter(n => n.length > 0)

  for (let i = 0; i < localPack.length; i++) {
    const entry = localPack[i]
    const entryRoot = domainRoot(entry.domain)
    if (clientRoot && entryRoot && entryRoot === clientRoot) return i + 1

    const entryName = normalise(entry.name)
    if (
      entryName &&
      nameNeedles.some(n =>
        n.length < MIN_SUBSTRING_LEN ? entryName === n : entryName.includes(n),
      )
    ) {
      return i + 1
    }
  }
  return null
}

/**
 * SERP 结果 → serp_ai_overview_snapshots 一行。
 * snapshot_date 用关键词快照的真实日期（不是"今天"）——步 1 当周瞬时 0 词时
 * 关键词来自上周快照，用今天当键会让 local_pack_rank 回写静默匹配 0 行（魏征 🔴2），
 * 也让本表能按日期与 keyword_snapshots join 对齐。
 */
export function buildSerpSnapshotRow(
  client: SerpCaptureClient,
  keyword: string,
  serp: DfseSerpResult,
  snapshotDate: string,
  measuredAt: Date,
): SerpSnapshotRow {
  const clientRoot = domainRoot(client.domain)

  const citedSources = serp.ai_overview_sources.filter(Boolean)
  const hasAiOverview = serp.ai_overview_text !== null || citedSources.length > 0
  // host 全等或以 ".{clientRoot}" 结尾 —— 裸 includes 会把
  // "myctstours.co.nz.evil.com" 或路径里提到域名的第三方页当成引用（魏征 🟡3）
  const clientCited =
    clientRoot.length > 0 &&
    citedSources.some(url => {
      const host = domainRoot(url)
      return host === clientRoot || host.endsWith(`.${clientRoot}`)
    })

  const topOrganicDomains = Array.from(
    new Set(serp.organic_results.map(r => domainRoot(r.url)).filter(Boolean)),
  ).slice(0, 10)

  return {
    client_id: client.id,
    keyword,
    location_code: locationCodeForDb(client.semrush_db),
    snapshot_date: snapshotDate,
    has_ai_overview: hasAiOverview,
    client_cited: clientCited,
    cited_sources: citedSources,
    top_organic_domains: topOrganicDomains,
    measured_at: measuredAt.toISOString(),
  }
}

/** 按 local pack 名次分组 → 每个名次一次批量 UPDATE（最多 3 发）。 */
export function groupKeywordsByPackRank(
  ranks: Array<{ keyword: string; rank: number | null }>,
): Map<number, string[]> {
  const groups = new Map<number, string[]>()
  for (const { keyword, rank } of ranks) {
    if (rank === null) continue
    const list = groups.get(rank) ?? []
    list.push(keyword)
    groups.set(rank, list)
  }
  return groups
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ item: T; result?: R; error?: string }>> {
  const out: Array<{ item: T; result?: R; error?: string }> = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = { item: items[i], result: await fn(items[i]) }
      } catch (err) {
        out[i] = { item: items[i], error: err instanceof Error ? err.message : String(err) }
      }
    }
  })
  await Promise.all(workers)
  return out
}

// ── Orchestration ───────────────────────────────────────────────────────────────

/**
 * 对一个客户跑完整的每周 SERP 采集。单词失败只计数不中断；
 * 快照表 upsert 与 local_pack_rank 回写失败才抛错（数据没落地必须响）。
 */
export async function captureSerpForClient(
  client: SerpCaptureClient,
): Promise<SerpCaptureResult> {
  const base: SerpCaptureResult = {
    client_id: client.id,
    domain: client.domain,
    keywords_captured: 0,
    serp_rows_written: 0,
    local_pack_hits: 0,
    keywords_failed: 0,
  }

  const snapshot = await getLatestKeywordSnapshotForClient(client)
  const snapshotDate = snapshot.snapshot_date
  const keywords = Array.from(new Set(snapshot.keywords.map(k => k.keyword))).filter(
    k => k.trim().length > 0,
  )
  if (!snapshotDate || keywords.length === 0) return base

  const countryCode = (client.semrush_db === 'nz' ? 'nz' : 'au') as 'au' | 'nz'
  const measuredAt = new Date()

  const serpResults = await mapWithConcurrency(keywords, SERP_CONCURRENCY, kw =>
    getSerpPage(kw, countryCode),
  )

  const rows: SerpSnapshotRow[] = []
  const packRanks: Array<{ keyword: string; rank: number | null }> = []
  for (const r of serpResults) {
    if (!r.result) continue
    rows.push(buildSerpSnapshotRow(client, r.item, r.result, snapshotDate, measuredAt))
    packRanks.push({ keyword: r.item, rank: resolveLocalPackRank(r.result.local_pack, client) })
  }
  base.keywords_captured = rows.length
  base.keywords_failed = serpResults.filter(r => r.error !== undefined).length

  if (rows.length === 0) return base

  const { data: written, error: upsertErr } = await supabaseAdmin
    .from('serp_ai_overview_snapshots')
    .upsert(rows, { onConflict: 'client_id,keyword,location_code,snapshot_date' })
    .select('id')

  if (upsertErr) {
    throw new Error(`serp_ai_overview_snapshots upsert failed: ${upsertErr.message}`)
  }
  base.serp_rows_written = written?.length ?? rows.length

  // local_pack_rank 回写：按名次分组批量 UPDATE（最多 3 发）。
  // 只写命中的词 —— 快照行刚建好，默认已是 null，不用清。
  // 日期键 = 快照真实日期（与上面 rows 同一基准，见 buildSerpSnapshotRow 注释）。
  const locationCode = locationCodeForDb(client.semrush_db)
  const groups = groupKeywordsByPackRank(packRanks)

  for (const [rank, kws] of groups) {
    const { error: updateErr } = await supabaseAdmin
      .from('keyword_snapshots')
      .update({ local_pack_rank: rank })
      .eq('client_id', client.id)
      .eq('location_code', locationCode)
      .eq('snapshot_date', snapshotDate)
      .in('keyword', kws)

    if (updateErr) {
      throw new Error(`keyword_snapshots local_pack_rank update failed: ${updateErr.message}`)
    }
    base.local_pack_hits += kws.length
  }

  return base
}

import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { meMailFrom, ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { MARKET_INTEL_SOURCES } from './sources'
import { fetchFeed, FeedFetchError } from './rss'
import { dedupeHash } from './dedupe'
import { matchCategory } from './categorize'
import { summarizeItem, generateDailyNote } from './summarize'
import { buildDigestEmailHtml, buildDigestEmailSubject, escapeHtml } from './email-template'
import { nzDateString } from './nz-date'
import type { CandidateItem, MarketIntelCategory, SummarizedItem } from './types'

const MAX_PER_CATEGORY = 2
const DEDUPE_WINDOW_DAYS = 7
// §7.6：区分"请求本身失败"和"0 条新条目"——只有前者连续失败才报警。
const SOURCE_FAIL_ALERT_THRESHOLD = 3

interface SourceRow {
  id: string
  feed_url: string
  enabled: boolean
  consecutive_fail_count: number
}

interface PersistedCandidate extends CandidateItem {
  itemId: string
}

export interface PipelineResult {
  sent: boolean
  reason?: string
  itemsConsidered: number
  itemsSelected: number
  itemsSentInEmail: number
  itemsFlaggedForReview: number
  sourceFailures: string[]
}

// ---------------------------------------------------------------------------
// 1. 信源配置 upsert（不覆盖健康度追踪字段——只传 name/feed_url/categories，
//    ON CONFLICT 只更新这几列，enabled/last_fetched_at/consecutive_fail_count
//    在冲突时保留原值）
// ---------------------------------------------------------------------------
async function loadSources(): Promise<Map<string, SourceRow>> {
  const rows = MARKET_INTEL_SOURCES.map((s) => ({
    name: s.name,
    feed_url: s.feedUrl,
    categories: s.categories,
  }))
  const { error: upsertError } = await supabaseAdmin
    .from('market_intel_sources')
    .upsert(rows, { onConflict: 'feed_url' })
  if (upsertError) throw new Error(`loadSources upsert failed: ${upsertError.message}`)

  const { data, error } = await supabaseAdmin
    .from('market_intel_sources')
    .select('id, feed_url, enabled, consecutive_fail_count')
    .in('feed_url', MARKET_INTEL_SOURCES.map((s) => s.feedUrl))
  if (error) throw new Error(`loadSources select failed: ${error.message}`)

  const map = new Map<string, SourceRow>()
  for (const row of (data ?? []) as SourceRow[]) map.set(row.feed_url, row)
  return map
}

// ---------------------------------------------------------------------------
// 2. 逐信源抓取，更新健康度计数，把命中分类的条目收进候选池
// ---------------------------------------------------------------------------
async function collectCandidates(): Promise<{ candidates: CandidateItem[]; sourceFailures: string[] }> {
  const sourceRows = await loadSources()
  const candidates: CandidateItem[] = []
  const sourceFailures: string[] = []
  const nowIso = new Date().toISOString()

  for (const source of MARKET_INTEL_SOURCES) {
    const row = sourceRows.get(source.feedUrl)
    if (!row || row.enabled === false) continue

    try {
      const items = await fetchFeed(source.feedUrl)
      await supabaseAdmin
        .from('market_intel_sources')
        .update({ last_fetched_at: nowIso, last_success_at: nowIso, consecutive_fail_count: 0 })
        .eq('id', row.id)

      for (const raw of items) {
        const category = matchCategory(raw, source.categories)
        if (!category) continue
        candidates.push({
          sourceId: row.id,
          sourceName: source.name,
          title: raw.title,
          url: raw.url,
          publishedAt: raw.publishedAt,
          rawExcerpt: raw.excerpt,
          matchedCategory: category,
          dedupeHash: dedupeHash(raw.title),
        })
      }
    } catch (err) {
      const failCount = row.consecutive_fail_count + 1
      await supabaseAdmin
        .from('market_intel_sources')
        .update({ last_fetched_at: nowIso, consecutive_fail_count: failCount })
        .eq('id', row.id)
      if (failCount >= SOURCE_FAIL_ALERT_THRESHOLD) {
        const reason = err instanceof FeedFetchError ? err.message : String(err)
        sourceFailures.push(`${source.name}：连续 ${failCount} 天请求失败（${reason}）—— 去 market_intel_sources 表核对 feed_url，大概率是信源改版或反爬限流`)
      }
    }
  }

  return { candidates, sourceFailures }
}

// ---------------------------------------------------------------------------
// 3. 落原始条目（同一信源同一 URL 不重复入库，重跑幂等）
// ---------------------------------------------------------------------------
async function persistItems(candidates: CandidateItem[]): Promise<PersistedCandidate[]> {
  if (candidates.length === 0) return []

  const rows = candidates.map((c) => ({
    source_id: c.sourceId,
    title: c.title,
    url: c.url,
    published_at: c.publishedAt,
    raw_excerpt: c.rawExcerpt,
    matched_category: c.matchedCategory,
    dedupe_hash: c.dedupeHash,
  }))

  const { data, error } = await supabaseAdmin
    .from('market_intel_items')
    .upsert(rows, { onConflict: 'source_id,url' })
    .select('id, source_id, url')
  if (error) throw new Error(`persistItems failed: ${error.message}`)

  const idByKey = new Map<string, string>()
  for (const row of (data ?? []) as { id: string; source_id: string; url: string }[]) {
    idByKey.set(`${row.source_id}::${row.url}`, row.id)
  }

  return candidates
    .map((c) => {
      const itemId = idByKey.get(`${c.sourceId}::${c.url}`)
      return itemId ? { ...c, itemId } : null
    })
    .filter((c): c is PersistedCandidate => c !== null)
}

// ---------------------------------------------------------------------------
// 4. 去重（跨过去 7 天真正发过的 digests，不是所有抓到过的 items）+ 分类分桶挑选
// ---------------------------------------------------------------------------
async function selectForDigest(
  persisted: PersistedCandidate[],
  digestDate: string,
): Promise<PersistedCandidate[]> {
  const windowStart = new Date(
    Date.parse(`${digestDate}T00:00:00Z`) - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString().slice(0, 10)

  const { data: recent, error } = await supabaseAdmin
    .from('market_intel_digests')
    .select('dedupe_hash')
    .gte('digest_date', windowStart)
  if (error) throw new Error(`selectForDigest lookup failed: ${error.message}`)

  const alreadySent = new Set((recent ?? []).map((r: { dedupe_hash: string }) => r.dedupe_hash))
  const seenThisRun = new Set<string>()

  const deduped = persisted.filter((c) => {
    if (alreadySent.has(c.dedupeHash) || seenThisRun.has(c.dedupeHash)) return false
    seenThisRun.add(c.dedupeHash)
    return true
  })

  const byCategory = new Map<MarketIntelCategory, PersistedCandidate[]>()
  for (const c of deduped) {
    const list = byCategory.get(c.matchedCategory) ?? []
    list.push(c)
    byCategory.set(c.matchedCategory, list)
  }

  const selected: PersistedCandidate[] = []
  // Array.from 而不是直接 for...of Map.values()——Map 迭代器需要 target es2015+
  // 才能免开 downlevelIteration，这个仓库的 tsconfig 没设；数组本身没有这个限制。
  for (const list of Array.from(byCategory.values())) {
    const newestFirst = [...list].sort(
      (a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0),
    )
    selected.push(...newestFirst.slice(0, MAX_PER_CATEGORY))
  }
  return selected
}

// ---------------------------------------------------------------------------
// 5. 落成品行（核对通过与不通过的都落库，不通过的不进邮件，供人工翻查）
// ---------------------------------------------------------------------------
async function persistDigestRows(digestDate: string, items: (SummarizedItem & { itemId: string })[]) {
  if (items.length === 0) return
  const rows = items.map((item) => ({
    digest_date: digestDate,
    category: item.matchedCategory,
    headline_zh: item.headlineZh,
    summary_zh: item.summaryZh,
    source_item_id: item.itemId,
    dedupe_hash: item.dedupeHash,
    grounding_check: item.groundingCheck,
  }))
  const { error } = await supabaseAdmin
    .from('market_intel_digests')
    .upsert(rows, { onConflict: 'digest_date,category,source_item_id' })
  if (error) throw new Error(`persistDigestRows failed: ${error.message}`)
}

async function markEmailSent(digestDate: string, itemIds: string[]) {
  if (itemIds.length === 0) return
  const { error } = await supabaseAdmin
    .from('market_intel_digests')
    .update({ email_sent_at: new Date().toISOString() })
    .eq('digest_date', digestDate)
    .in('source_item_id', itemIds)
  if (error) throw new Error(`markEmailSent failed: ${error.message}`)
}

async function persistDailyNote(digestDate: string, noteZh: string) {
  const { error } = await supabaseAdmin
    .from('market_intel_daily_notes')
    .upsert({ digest_date: digestDate, note_zh: noteZh }, { onConflict: 'digest_date' })
  if (error) throw new Error(`persistDailyNote failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// 6. 发信
// ---------------------------------------------------------------------------
async function sendDigestEmail(nzDateLabel: string, note: string | null, items: SummarizedItem[]) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: meMailFrom('Magic Insight'),
    to: [ME_MAIL_TO_ADDRESS],
    subject: buildDigestEmailSubject(nzDateLabel),
    html: buildDigestEmailHtml(nzDateLabel, note, items),
  })
  if (error) throw new Error(`sendDigestEmail failed: ${String(error)}`)
}

async function maybeSendHealthAlert(sourceFailures: string[]) {
  if (sourceFailures.length === 0) return

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return // 邮件都发不出去了，cron 日志里的 summary 仍然能看到这些

  const resend = new Resend(apiKey)
  const html = `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 12px;font-size:17px;color:#b45309">⚠ Magic Insight 信源健康度提醒</h2>
      <ul style="font-size:14px;color:#334155;line-height:1.8">
        ${sourceFailures.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}
      </ul>
    </div>`
  await resend.emails.send({
    from: meMailFrom('Magic Insight 健康度'),
    to: [ME_MAIL_TO_ADDRESS],
    subject: `⚠ Magic Insight：${sourceFailures.length} 项需要检查`,
    html,
  })
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
export async function runMarketIntelDaily(now: Date = new Date()): Promise<PipelineResult> {
  const digestDate = nzDateString(now)

  const { candidates, sourceFailures } = await collectCandidates()
  const persisted = await persistItems(candidates)
  const selected = await selectForDigest(persisted, digestDate)

  const summarized = await Promise.all(selected.map((c) => summarizeItem(c)))
  const withItemId = summarized.map((s, i) => ({ ...s, itemId: selected[i].itemId }))

  const passed = withItemId.filter((s) => s.groundingCheck === 'passed')
  const flagged = withItemId.filter((s) => s.groundingCheck === 'failed')

  await persistDigestRows(digestDate, withItemId)

  const note = passed.length > 0 ? await generateDailyNote(passed) : null
  if (note) await persistDailyNote(digestDate, note)

  let sent = false
  if (passed.length > 0) {
    await sendDigestEmail(digestDate, note, passed)
    await markEmailSent(digestDate, passed.map((p) => p.itemId))
    sent = true
  }

  await maybeSendHealthAlert(sourceFailures)

  return {
    sent,
    reason: sent ? undefined : 'no items passed grounding today',
    itemsConsidered: candidates.length,
    itemsSelected: selected.length,
    itemsSentInEmail: passed.length,
    itemsFlaggedForReview: flagged.length,
    sourceFailures,
  }
}

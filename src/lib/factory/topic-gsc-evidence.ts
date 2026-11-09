import { supabaseAdmin } from '@/lib/supabase'
import { addDays, isIsoDay, pacificDay } from '@/lib/gsc/page-daily-plan'
import { fetchAll } from '@/lib/supabase-paginate'
import { gscPageKey } from '@/lib/url/page-key'
import type { SearchEvidence } from './topic-alignment'

interface GscReceipt {
  id: string
  request_start_day: string
  request_end_day: string
  data_from_day: string | null
  data_through_day: string | null
  finished_at: string | null
  skipped_long_urls: number
}

interface GscRow { day: string; page_url: string; clicks: number; impressions: number }

const missing = (finding: string): SearchEvidence => ({ status: 'not_collected', finding })

function receiptWindow(receipt: GscReceipt, today: string): { start: string; end: string } | null {
  if (!isIsoDay(receipt.request_start_day) || !isIsoDay(receipt.request_end_day) ||
      !isIsoDay(receipt.data_from_day) || !isIsoDay(receipt.data_through_day) ||
      receipt.skipped_long_urls !== 0) return null
  const start = [receipt.request_start_day, receipt.data_from_day].sort().at(-1)!
  const end = [receipt.request_end_day, receipt.data_through_day].sort()[0]
  const age = receipt.finished_at ? Date.now() - Date.parse(receipt.finished_at) : NaN
  if (start > end || end < addDays(today, -35) || end > today ||
      !Number.isFinite(age) || age < -300_000 || age > 90 * 86_400_000) return null
  return { start, end }
}

export async function loadStoredGscEvidence(
  clientId: string, keyword: string, websiteUrl: string,
): Promise<SearchEvidence> {
  const pageKey = gscPageKey(websiteUrl)
  if (!pageKey || !keyword.trim()) return missing('Keyword or official landing page is missing')
  try {
    const { data, error } = await supabaseAdmin.from('gsc_query_page_fetch_receipts')
      .select('id, request_start_day, request_end_day, data_from_day, data_through_day, finished_at, skipped_long_urls')
      .eq('client_id', clientId).eq('status', 'complete')
      .order('finished_at', { ascending: false }).limit(30)
    if (error) return missing('Stored GSC fetch receipts are unavailable')
    const today = pacificDay(new Date())
    const match = (data ?? []).map((row) => ({ receipt: row as GscReceipt, window: receiptWindow(row as GscReceipt, today) }))
      .filter((item) => item.window)
      .sort((a, b) => b.window!.end.localeCompare(a.window!.end))[0]
    if (!match?.window) return missing('No recent complete GSC query-page import covers this topic')
    const { start, end } = match.window
    const rows = await fetchAll<GscRow>((from, to) => supabaseAdmin.from('gsc_query_page_daily')
      .select('day, page_url, clicks, impressions')
      .eq('client_id', clientId).eq('query', keyword).eq('page_key', pageKey)
      .gte('day', start).lte('day', end)
      .order('day', { ascending: true }).order('page_url', { ascending: true })
      .range(from, to), 10_000)
    if (rows.length === 0) return missing('No stored GSC rows for this exact keyword and page in the covered window')
    if (rows.some((row) => !Number.isSafeInteger(row.impressions) || row.impressions < 0 ||
        !Number.isSafeInteger(row.clicks) || row.clicks < 0)) return missing('Stored GSC rows contain invalid metrics')
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0)
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
    if (!Number.isSafeInteger(impressions) || !Number.isSafeInteger(clicks)) return missing('GSC metric total is invalid')
    return {
      status: 'observed', source: `ME GSC query-page receipt ${match.receipt.id}`,
      observedAt: new Date().toISOString(), dateRange: `${start} to ${end} (Google Pacific)`,
      market: 'All countries; source has no country dimension',
      finding: `Exact keyword and landing page; ${rows.length} stored rows and ${clicks} clicks. Website impressions only; not YouTube demand.`,
      metricName: 'GSC impressions', value: impressions,
    }
  } catch {
    return missing('Stored GSC query-page evidence could not be read')
  }
}

import { randomUUID } from 'node:crypto'
import { supabaseAdmin as db } from '@/lib/supabase'
import { extractTourLinks } from './profiles/travel'
import { approvedUrl, loadCompetitors } from './targets'
import type { CaptureRequest, Run } from './contracts'

const DETAIL_REFRESH_MS = 7 * 86_400_000
const TERMINAL = new Set(['complete', 'failed', 'reconciliation'])

/** Build bounded detail-page capture requests from one successful listing snapshot. */
export async function discoverTourDetailRequests(parent: Run): Promise<CaptureRequest[]> {
  const [snapshot, competitor] = await Promise.all([
    db.from('market_snapshots').select('content,page_role').eq('client_id', parent.client_id).eq('run_id', parent.id).maybeSingle(),
    loadCompetitors(parent.client_id).then(items => items.find(item => item.domain === parent.domain)),
  ])
  if (snapshot.error || !snapshot.data || snapshot.data.page_role !== 'product_listing' || !competitor || competitor.status === 'archive') return []
  const links = extractTourLinks(String(snapshot.data.content ?? ''), parent.url).slice(0, 10)
  const candidates = await Promise.all(links.map(async (link): Promise<CaptureRequest | null> => {
    const url = approvedUrl(link.url, parent.domain)
    const latest = await db.from('web_intelligence_runs').select('status,created_at').eq('client_id', parent.client_id).eq('domain', parent.domain).eq('url', url).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (latest.error) throw new Error('detail_run_read_failed')
    if (latest.data && (!TERMINAL.has(String(latest.data.status)) || Date.now() - Date.parse(String(latest.data.created_at)) < DETAIL_REFRESH_MS)) return null
    return { client_id: parent.client_id, request_id: randomUUID(), domain: parent.domain, url } satisfies CaptureRequest
  }))
  return candidates.filter((value): value is CaptureRequest => value !== null)
}

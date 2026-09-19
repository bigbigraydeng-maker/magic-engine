import type { SupabaseClient } from '@supabase/supabase-js'
import { normalisePath } from '@/lib/seo-intelligence/page-trends/path-utils'
import type { PageMetrics, PostPublishCheckDue, PostPublishReceipt } from './post-publish-monitor'
import { canonicalPageUrl, normaliseHost, receiptRunId } from './post-publish-monitor'

type GscPage = { page?: string; clicks?: number; impressions?: number; ctr?: number; position?: number }
type Ga4Page = { page?: string; pageviews?: number; sessions?: number }

export async function assertClientOwnsOrigin(db: SupabaseClient, clientId: string, originUrl: string): Promise<void> {
  const { data, error } = await db.from('clients').select('domain').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`client_domain_read_failed:${error.message}`)
  const domain = typeof (data as { domain?: unknown } | null)?.domain === 'string' ? (data as { domain: string }).domain : null
  if (!domain) throw new Error('client_domain_missing')
  const registered = normaliseHost(new URL(domain.includes('://') ? domain : `https://${domain}`).hostname)
  const requested = normaliseHost(new URL(originUrl).hostname)
  if (registered !== requested) throw new Error('client_origin_mismatch')
}

export async function readPageMetrics(db: SupabaseClient, clientId: string, pageUrl: string): Promise<PageMetrics> {
  const [gsc, ga4] = await Promise.all([
    db.from('gsc_performance_snapshots').select('synced_at,top_pages').eq('client_id', clientId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('ga4_traffic_snapshots').select('synced_at,top_pages').eq('client_id', clientId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (gsc.error) throw new Error(`gsc_snapshot_read_failed:${gsc.error.message}`)
  if (ga4.error) throw new Error(`ga4_snapshot_read_failed:${ga4.error.message}`)
  const path = normalisePath(canonicalPageUrl(pageUrl))
  const gscRow = (((gsc.data as { top_pages?: GscPage[] } | null)?.top_pages ?? []).find((row) => normalisePath(row.page ?? '') === path))
  const ga4Row = (((ga4.data as { top_pages?: Ga4Page[] } | null)?.top_pages ?? []).find((row) => normalisePath(row.page ?? '') === path))
  return {
    gsc: {
      synced_at: stringOrNull((gsc.data as { synced_at?: unknown } | null)?.synced_at),
      clicks: numberOrNull(gscRow?.clicks), impressions: numberOrNull(gscRow?.impressions),
      ctr: numberOrNull(gscRow?.ctr), position: numberOrNull(gscRow?.position),
    },
    ga4: {
      synced_at: stringOrNull((ga4.data as { synced_at?: unknown } | null)?.synced_at),
      sessions: numberOrNull(ga4Row?.sessions), pageviews: numberOrNull(ga4Row?.pageviews),
    },
  }
}

function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function stringOrNull(value: unknown): string | null { return typeof value === 'string' ? value : null }

export async function persistReceipt(db: SupabaseClient, due: PostPublishCheckDue, receipt: PostPublishReceipt): Promise<void> {
  const failed = receipt.status === 'failed'
  const { error } = await db.from('cron_run_logs').upsert({
    id: receiptRunId(due), job_name: 'seo-post-publish-monitor',
    status: failed ? 'failed' : 'completed', started_at: receipt.target_at,
    finished_at: receipt.observed_at, duration_ms: 0, processed: 1,
    completed_count: failed ? 0 : 1, failed_count: failed ? 1 : 0,
    summary: receipt, error_message: failed ? receipt.caveats.join(';') || 'monitor_failed' : null,
  }, { onConflict: 'id' })
  if (error) throw new Error(`post_publish_receipt_write_failed:${error.message}`)
}

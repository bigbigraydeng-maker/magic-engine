/**
 * POST /api/clients/[id]/gsc/sync
 *
 * Triggers a Google Search Console data pullback for the client.
 * Fetches the last 28 days of search analytics (queries + pages) and stores
 * a snapshot in gsc_performance_snapshots.
 *
 * Requirements:
 *   - client must have gsc connector in 'connected' state (site_url in config)
 *   - client must have a valid google_oauth_token (or shared service account)
 *
 * Body: { period_days?: number }  (default 28, max 90)
 *
 * Returns: { success, snapshot_id, site_url, period_start, period_end,
 *             total_clicks, total_impressions }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P17.A.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { fetchGscSnapshot, GscApiError } from '@/lib/gsc/client'

export const dynamic = 'force-dynamic'

const MAX_PERIOD_DAYS = 90

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Parse optional body
  let periodDays = 28
  try {
    const body = await req.json() as { period_days?: unknown }
    if (typeof body.period_days === 'number' && body.period_days > 0) {
      periodDays = Math.min(Math.round(body.period_days), MAX_PERIOD_DAYS)
    }
  } catch {
    // default stays 28
  }

  // Resolve site_url from connector config
  const { data: connector, error: connErr } = await supabaseAdmin
    .from('client_connectors')
    .select('status, config')
    .eq('client_id', clientId)
    .eq('anchor', 'gsc')
    .maybeSingle()

  if (connErr) {
    return NextResponse.json({ success: false, error: connErr.message }, { status: 500 })
  }

  if (!connector || connector.status !== 'connected') {
    return NextResponse.json(
      { success: false, error: 'GSC connector not connected. Complete OAuth + site URL setup first.' },
      { status: 422 },
    )
  }

  const siteUrl = (connector.config as Record<string, unknown> | null)?.site_url
  if (typeof siteUrl !== 'string' || !siteUrl) {
    return NextResponse.json(
      { success: false, error: 'GSC connector is missing site_url. Update connector config.' },
      { status: 422 },
    )
  }

  // Fetch snapshot from GSC API
  let snapshot
  try {
    snapshot = await fetchGscSnapshot(siteUrl, clientId, periodDays)
  } catch (err) {
    if (err instanceof GscApiError) {
      return NextResponse.json(
        { success: false, error: translateGscError(err) },
        { status: 422 },
      )
    }
    throw err
  }

  if (!snapshot) {
    return NextResponse.json(
      { success: false, error: 'Google OAuth token 未找到，请先在连接页面完成 Google 授权' },
      { status: 422 },
    )
  }

  // Upsert into gsc_performance_snapshots (idempotent by period)
  const { data: inserted, error: upsertErr } = await supabaseAdmin
    .from('gsc_performance_snapshots')
    .upsert(
      {
        client_id:         clientId,
        site_url:          snapshot.site_url,
        period_start:      snapshot.period_start,
        period_end:        snapshot.period_end,
        total_clicks:      snapshot.total_clicks,
        total_impressions: snapshot.total_impressions,
        avg_ctr:           snapshot.avg_ctr,
        avg_position:      snapshot.avg_position,
        top_queries:       snapshot.top_queries,
        top_pages:         snapshot.top_pages,
        synced_at:         snapshot.synced_at,
      },
      { onConflict: 'client_id,period_start,period_end' },
    )
    .select('id')
    .single()

  if (upsertErr) {
    return NextResponse.json({ success: false, error: upsertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success:           true,
    snapshot_id:       (inserted as { id: string }).id,
    site_url:          snapshot.site_url,
    period_start:      snapshot.period_start,
    period_end:        snapshot.period_end,
    total_clicks:      snapshot.total_clicks,
    total_impressions: snapshot.total_impressions,
    avg_ctr:           snapshot.avg_ctr,
    avg_position:      snapshot.avg_position,
    query_count:       snapshot.top_queries.length,
    page_count:        snapshot.top_pages.length,
  })
}

function translateGscError(err: GscApiError): string {
  const { httpStatus, googleStatus, googleReason, message } = err

  if (
    googleReason === 'accessNotConfigured' ||
    googleStatus === 'SERVICE_DISABLED' ||
    message.toLowerCase().includes('has not been used') ||
    message.toLowerCase().includes('not been used in project')
  ) {
    return 'Google Cloud Search Console API 未启用，请联系管理员在 Google Cloud Console 中启用 Search Console API'
  }

  if (
    httpStatus === 403 &&
    (message.toLowerCase().includes('insufficient authentication scopes') ||
     googleReason === 'insufficientPermissions')
  ) {
    return 'Google 授权缺少 Search Console 权限，请在连接页面重新授权，并在授权时勾选「查看 Search Console 数据」'
  }

  if (httpStatus === 403) {
    return 'Google 账号没有该 Property 的访问权限，请确认已在 Google Search Console 中验证该网站'
  }

  if (httpStatus === 401) {
    return 'Google OAuth token 已过期或无效，请在连接页面重新授权'
  }

  if (httpStatus === 404) {
    return 'GSC Property 不存在，请检查 site_url 格式（URL 前缀：https://example.com/ 或 Domain 属性：sc-domain:example.com）'
  }

  if (httpStatus === 0) {
    return 'Google Search Console API 请求失败（网络错误），请稍后重试'
  }

  return `Google Search Console API 错误 (${httpStatus})：${message.slice(0, 200)}`
}

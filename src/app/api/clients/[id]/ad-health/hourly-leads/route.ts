/**
 * GET /api/clients/[id]/ad-health/hourly-leads
 *
 * 只读：今天每小时 Meta 表单进线（contact_touchpoints / meta_lead_form），新西兰钟点。
 * 不调 Meta。读失败返回 unreadable，不伪造 0。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { endOfNzDayMs, nzToday } from '@/lib/ads-strategy/promo-window'
import { buildHourlyLeadChart, isoDayMinus } from '@/lib/ads-strategy/hourly-meta-leads'
import { toClientHourlyLeadsView } from '@/lib/ads-strategy/agents/hourly-leads-client-view'

export const dynamic = 'force-dynamic'

const META_LEADS_SYNC_JOB = 'meta-leads-sync'

function startOfNzDayMs(day: string): number {
  return endOfNzDayMs(day) - 86_400_000 + 1000
}

async function loadTouchpoints(clientId: string, sinceIso: string): Promise<
  | { ok: true; rows: Array<{ occurred_at: string }> }
  | { ok: false; error: string }
> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('occurred_at')
    .eq('client_id', clientId)
    .eq('channel', 'meta_lead_form')
    .gte('occurred_at', sinceIso)
    .order('occurred_at', { ascending: true })
    .limit(20_000)
  if (error) return { ok: false, error: error.message }
  return { ok: true, rows: (data ?? []) as Array<{ occurred_at: string }> }
}

async function lastMetaLeadsSyncFinishedAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('finished_at')
    .eq('job_name', META_LEADS_SYNC_JOB)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn('[hourly-leads] cron_run_logs read failed', error.message)
    return null
  }
  return typeof data?.finished_at === 'string' ? data.finished_at : null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const fullView = access.tier === 'admin' && access.allowedClientId === null

  const now = new Date()
  const today = nzToday(now.getTime())
  const sinceDay = isoDayMinus(today, 8)
  const sinceIso = new Date(startOfNzDayMs(sinceDay)).toISOString()

  const [touchRes, lastSyncAt] = await Promise.all([
    loadTouchpoints(clientId, sinceIso),
    lastMetaLeadsSyncFinishedAt(),
  ])

  if (!touchRes.ok) {
    const body = {
      success: true,
      unreadable: true,
      message: '读不到',
      lastSyncAt: fullView ? lastSyncAt : null,
    }
    return NextResponse.json(fullView ? body : toClientHourlyLeadsView(body))
  }

  const built = buildHourlyLeadChart(touchRes.rows, now)
  if (!built.ok) {
    const body = {
      success: true,
      unreadable: true,
      message: '读不到',
      lastSyncAt: fullView ? lastSyncAt : null,
    }
    return NextResponse.json(fullView ? body : toClientHourlyLeadsView(body))
  }

  const payload = {
    success: true,
    unreadable: false,
    chart: built.chart,
    lastSyncAt,
    jobName: META_LEADS_SYNC_JOB,
  }

  return NextResponse.json(fullView ? payload : toClientHourlyLeadsView(payload))
}

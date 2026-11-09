/**
 * GET /api/clients/[id]/ad-health/live
 *
 * "今日实时": today's spend / impressions / daily budget / status of the client's OFFICIAL
 * (non-hidden) Meta ad account(s), read live from Meta (heartbeat read layer), cached 60s per
 * client in memory (see live-view.ts for why that is acceptable).
 *
 * 🔴 Internal staff only (unscoped admin), same gate as war-map. Read-only: no writes anywhere.
 * 🔴 A failed read is reported per account as readState 'unreadable' / 'partial' — never as "fine".
 * 🔴 Hidden accounts are not read here; their money risk stays with the tracking check.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { readHeartbeatAccount } from '@/lib/ads-strategy/heartbeat/read'
import { createSupabaseStore } from '@/lib/ads-strategy/heartbeat/store'
import { getLiveToday, type LiveDeps } from '@/lib/ads-strategy/heartbeat/live-view'

export const dynamic = 'force-dynamic'

function actId(raw: string): string {
  return `act_${raw.replace(/^act_/i, '').trim()}`
}

/** Non-hidden registered accounts; falls back to clients.meta_ad_account_id when none are registered. */
async function listOfficialAccountIds(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id, hidden_from_ad_health')
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Array<{ ad_account_id: string; hidden_from_ad_health: boolean | null }>
  if (rows.length > 0) {
    return rows.filter(r => r.hidden_from_ad_health !== true).map(r => actId(r.ad_account_id))
  }
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) throw new Error(clientError.message)
  const primary = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
  return primary ? [actId(primary)] : []
}

function productionDeps(): LiveDeps {
  return {
    listOfficialAccountIds,
    getToken: getMetaTokenForClient,
    hasActiveCampaigns: (clientId, adAccountId) => createSupabaseStore(supabaseAdmin).hasActiveCampaigns(clientId, adAccountId),
    read: readHeartbeatAccount,
    now: () => new Date(),
  }
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
  if (!fullView) {
    return NextResponse.json({ error: '今日实时暂只对内部员工开放' }, { status: 403 })
  }

  try {
    const view = await getLiveToday(clientId, productionDeps())
    return NextResponse.json({ success: true, view })
  } catch (e) {
    console.warn('[api/ad-health/live] 读取失败', { clientId, error: e instanceof Error ? e.message : String(e) })
    return NextResponse.json({ error: '读不到今日实时数据，稍后再试；持续读不出来找开发' }, { status: 500 })
  }
}

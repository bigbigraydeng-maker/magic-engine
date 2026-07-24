/**
 * POST /api/clients/[id]/ad-health/execute-prescription
 *
 * DAPE E for the ads-health dashboard: execute the one-click prescription on a
 * campaign card. Currently one executable kind:
 *
 *   refresh_creatives — trigger the winner-reel-sync engine for this client.
 *     It scans the client's organic winners and adds the best into the paid
 *     pool as NEW ads, DEFAULT PAUSED (no spend until a human activates them).
 *     Called as a direct library import — never an internal HTTP self-call
 *     (zhangqian lesson, PR #297).
 *
 * Non-executable kinds (rotate_audience / review_offer) return 422 — they are
 * FDE-judgement calls by design, the UI shouldn't offer a button for them.
 *
 * Body: { kind: 'refresh_creatives' }
 * 200 → { success, adsAdded: [{name, score}], guardsHit, status }
 * 409 → winner-sync not configured/enabled for this client
 * 422 → kind not executable
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { syncWinnerReels } from '@/lib/winner-reel-sync/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface RouteParams {
  params: { id: string }
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const clientId = params.id

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { kind?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.kind !== 'refresh_creatives') {
    return NextResponse.json(
      { error: `处方「${body.kind ?? ''}」需要人工判断,系统不自动执行` },
      { status: 422 },
    )
  }

  // The creative supply line is the winner-sync engine; it must be configured
  // (target pool ad set etc.) before this button can do anything real.
  const { data: cfg } = await supabaseAdmin
    .from('winner_reel_sync_config')
    .select('enabled')
    .eq('client_id', clientId)
    .maybeSingle()

  if (!cfg?.enabled) {
    return NextResponse.json(
      { error: '该客户还没接通爆款素材池,暂时无法一键补素材。请先在设置里配置 winner 池。' },
      { status: 409 },
    )
  }

  // skipFatiguePause: a button labelled "补新素材" must ONLY add — pausing other
  // ads here would be an action beyond what the user consented to.
  // newAdStatusOverride: the confirm dialog promises "暂停、不花钱" — hold that
  // promise even if the client's winner-sync config defaults new ads to ACTIVE.
  const result = await syncWinnerReels(clientId, {
    skipFatiguePause: true,
    newAdStatusOverride: 'PAUSED',
  })

  if (result.status === 'error') {
    return NextResponse.json(
      { error: result.errorMessage ?? '补素材失败,请稍后重试', status: result.status },
      { status: 502 },
    )
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    postsScanned: result.postsScanned,
    adsAdded: result.adsAdded.map(a => ({ name: a.name, score: a.score })),
    guardsHit: result.guardsHit,
  })
}

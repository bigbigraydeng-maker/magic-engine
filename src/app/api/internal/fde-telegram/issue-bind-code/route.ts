import { NextRequest, NextResponse } from 'next/server'
import { createFdeTelegramBindCode } from '@/lib/ads-strategy/monitoring/predictive-early-warning/fde-telegram-bind'
import { storeClientIdFromEnv } from '@/lib/ads-strategy/monitoring/predictive-early-warning/fde-telegram-store'
import { supabaseAdmin } from '@/lib/supabase'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/internal/fde-telegram/issue-bind-code
 * Body: { "portal_user_id": "<client_portal_users.id>" }
 * Auth: Bearer ${CRON_SECRET}
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!storeClientIdFromEnv()) {
    return NextResponse.json({ error: 'ME_FDE_TELEGRAM_STORE_CLIENT_ID not set' }, { status: 503 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const portalUserId =
    typeof body === 'object' && body !== null && 'portal_user_id' in body
      ? String((body as { portal_user_id: unknown }).portal_user_id)
      : ''
  if (!UUID.test(portalUserId)) {
    return NextResponse.json({ error: 'portal_user_id (UUID) required' }, { status: 400 })
  }
  try {
    const { code, expiresAt } = await createFdeTelegramBindCode(supabaseAdmin, portalUserId)
    return NextResponse.json({
      ok: true,
      code,
      expires_at: expiresAt,
      bot_start: `/start ${code}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bind code failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
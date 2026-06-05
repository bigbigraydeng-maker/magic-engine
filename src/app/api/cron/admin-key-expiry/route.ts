/**
 * Cron — admin MCP key expiry warning (Phase 34 / P34-P3.8).
 *
 * Daily. Finds active admin keys expiring within 7 days and logs a warning.
 * Email delivery is deferred to P2 (notifications/email.ts + SendGrid not yet
 * built); when that lands, wire sendEmail() here to ADMIN_EMAILS. The admin
 * UI already shows a per-key expiry countdown, so PM (single key, MVP) is
 * covered in the meantime.
 *
 * Auth: CRON_SECRET bearer (same as all ME crons).
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('admin_api_keys')
    .select('id, name, owner_email, expires_at, ip_allowlist')
    .is('revoked_at', null)
    .gte('expires_at', nowIso)
    .lte('expires_at', soon)
    .order('expires_at', { ascending: true })

  if (error) {
    console.error('[cron admin-key-expiry] query failed:', error)
    return NextResponse.json({ error: 'query failed' }, { status: 500 })
  }

  const expiring = data ?? []
  if (expiring.length > 0) {
    console.warn(
      `[cron admin-key-expiry] ${expiring.length} admin key(s) expiring within 7 days:`,
      expiring.map((k) => ({ name: k.name, owner: k.owner_email, expires_at: k.expires_at })),
    )
    // TODO(P2): when notifications/email.ts ships, send to ADMIN_EMAILS here.
  }

  // Also surface keys with empty ip_allowlist (soft-launch debt, 魏征 Y1).
  const { data: noIp } = await supabaseAdmin
    .from('admin_api_keys')
    .select('id, name, owner_email')
    .is('revoked_at', null)
    .eq('ip_allowlist', '{}')

  return NextResponse.json({
    ok: true,
    expiring_within_7d: expiring.length,
    keys: expiring.map((k) => ({ name: k.name, owner_email: k.owner_email, expires_at: k.expires_at })),
    empty_ip_allowlist: (noIp ?? []).length,
    email_delivery: 'deferred_to_P2',
  })
}

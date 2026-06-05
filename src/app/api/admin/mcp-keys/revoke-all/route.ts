/**
 * Admin MCP keys — EMERGENCY KILL-SWITCH (Phase 34 / P34-P3.3 layer 1+3).
 *
 * POST → sets api_key_settings.admin_revoke_all_before = now() so EVERY admin
 * key created before now is treated as revoked by verifyApiKey (no per-row
 * update needed, no Render restart). Also stamps revoked_at on every active
 * admin key so the audit list reads clean. Body: { confirm: "REVOKE-ALL" }.
 *
 * Auth: requireAdmin (session). This is the "5-minutes-to-fully-disable"
 * incident response per docs/sops/admin-mcp-key-internal.md.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth/require-admin'

function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    const selfHost = req.headers.get('x-forwarded-host') ?? new URL(req.url).host
    return new URL(origin).host !== selfHost
  } catch {
    return true
  }
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  }
  const access = await requireAdmin()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { confirm?: unknown }
  try {
    body = (await req.json()) as { confirm?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (body.confirm !== 'REVOKE-ALL') {
    return NextResponse.json({ error: 'confirm must equal "REVOKE-ALL"', code: 'CONFIRM_REQUIRED' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const email = access.user.email ?? null

  // Layer 1: global metadata — the authoritative kill (verifyApiKey reads this).
  const { error: settingsErr } = await supabaseAdmin
    .from('api_key_settings')
    .update({ admin_revoke_all_before: now, updated_at: now, updated_by_email: email })
    .eq('id', 1)
  if (settingsErr) {
    console.error('[admin-mcp-keys] revoke-all settings update failed:', settingsErr)
    return NextResponse.json({ error: 'Kill-switch failed' }, { status: 500 })
  }

  // Row-level stamp so the audit list shows them revoked (best-effort).
  const { count } = await supabaseAdmin
    .from('admin_api_keys')
    .update({ revoked_at: now, revoked_by_email: email, revoked_reason: 'kill_switch' }, { count: 'exact' })
    .is('revoked_at', null)

  return NextResponse.json({ success: true, killed_at: now, rows_stamped: count ?? 0 })
}

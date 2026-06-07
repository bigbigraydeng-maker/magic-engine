/**
 * MCP API key — revoke (soft delete) — Phase 34 / P34.2.
 *
 * DELETE → sets revoked_at = now() (true idempotent: if already revoked,
 * we DON'T overwrite the original revocation timestamp — 魏征 Y1).
 *
 * SECURITY (子牙 B5 spirit + 魏征 R2/Y6):
 *   - Both `id = keyId` AND `client_id = $id` filters in the UPDATE.
 *     Knowing another tenant's keyId can't revoke it through your own URL.
 *   - Admin-only role check. Client-viewer must NOT revoke (MVP scope:
 *     FDE-issued / FDE-revoked).
 *   - Same-origin Origin/Referer check on this state-changing write.
 *
 * Auth: requireDashboardClientAccess (browser session).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return true
  }
  // Behind Render's reverse proxy, req.url is an internal address — trust
  // X-Forwarded-Host (the real public host the browser hit), fall back to
  // req.url host only when absent (unit tests). Without this, every real
  // same-origin browser request false-positives as cross-origin.
  const forwardedHost = req.headers.get('x-forwarded-host')
  let selfHost = forwardedHost ?? ''
  if (!selfHost) {
    try {
      selfHost = new URL(req.url).host
    } catch {
      return true
    }
  }
  return originHost !== selfHost
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  }
  const { id: clientId, keyId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  // True idempotent revoke: only update rows that are still active. If the
  // row is already revoked we preserve the original revoked_at and return
  // success with `already_revoked: true` — so the audit log of "first
  // revoked at" is never overwritten by a double-click.
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('client_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .select('id, revoked_at')
    .maybeSingle()

  if (updateErr) {
    console.error('[api-keys] DELETE update failed:', updateErr)
    return NextResponse.json(
      { error: 'Failed to revoke API key' },
      { status: 500 },
    )
  }
  if (updated) {
    return NextResponse.json({ success: true, id: updated.id, revoked_at: updated.revoked_at })
  }

  // Updated nothing: either the key was already revoked (idempotent success)
  // or doesn't exist for this client (404). Disambiguate by looking up the
  // key with the two-key filter only (no revoked_at filter).
  const { data: existing, error: lookupErr } = await supabaseAdmin
    .from('client_api_keys')
    .select('id, revoked_at')
    .eq('id', keyId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (lookupErr) {
    console.error('[api-keys] DELETE lookup failed:', lookupErr)
    return NextResponse.json(
      { error: 'Failed to revoke API key' },
      { status: 500 },
    )
  }
  if (!existing) {
    return NextResponse.json(
      { error: 'API key not found for this client', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }
  // Idempotent: row exists and was already revoked. Return the ORIGINAL
  // revoked_at, never the current timestamp.
  return NextResponse.json({
    success: true,
    id: existing.id,
    revoked_at: existing.revoked_at,
    already_revoked: true,
  })
}

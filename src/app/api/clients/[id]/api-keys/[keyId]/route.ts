/**
 * MCP API key — revoke (soft delete) — Phase 34 / P34.2.
 *
 * DELETE → sets revoked_at = now(). Row is kept (mcp_access_log FK + audit).
 *
 * SECURITY (子牙 B5 spirit): the UPDATE filters by BOTH `id = keyId` AND
 * `client_id = $id` from the URL. requireDashboardClientAccess has already
 * confirmed the caller may act on `$id`, but matching client_id again here
 * means a caller who knows another tenant's keyId cannot revoke it through
 * their own client URL. Defence in depth.
 *
 * Idempotent: revoking an already-revoked key returns success (no surprise
 * 409 for double-clicks).
 *
 * Auth: requireDashboardClientAccess (browser session).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; keyId: string }> },
) {
  const { id: clientId, keyId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Two-key filter is the anti-cross-tenant defence. Do not relax to id-only.
  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('client_id', clientId)
    .select('id, revoked_at')
    .maybeSingle()

  if (error) {
    return NextResponse.json(
      { error: `Failed to revoke API key: ${error.message}` },
      { status: 500 },
    )
  }
  if (!data) {
    return NextResponse.json(
      { error: 'API key not found for this client', code: 'NOT_FOUND' },
      { status: 404 },
    )
  }

  return NextResponse.json({ success: true, id: data.id, revoked_at: data.revoked_at })
}

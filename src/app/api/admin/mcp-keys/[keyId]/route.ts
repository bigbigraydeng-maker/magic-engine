/**
 * Admin MCP key — revoke single (Phase 34 / P34-P3.7). Soft delete.
 * Auth: requireAdmin (session). Idempotent.
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ keyId: string }> }) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  }
  const access = await requireAdmin()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { keyId } = await params
  const { data, error } = await supabaseAdmin
    .from('admin_api_keys')
    .update({ revoked_at: new Date().toISOString(), revoked_by_email: access.user.email ?? null, revoked_reason: 'manual' })
    .eq('id', keyId)
    .is('revoked_at', null)
    .select('id, revoked_at')
    .maybeSingle()

  if (error) {
    console.error('[admin-mcp-keys] DELETE failed:', error)
    return NextResponse.json({ error: 'Failed to revoke admin key' }, { status: 500 })
  }
  if (data) return NextResponse.json({ success: true, id: data.id, revoked_at: data.revoked_at })

  // idempotent: already revoked or not found
  const { data: existing } = await supabaseAdmin
    .from('admin_api_keys').select('id, revoked_at').eq('id', keyId).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Admin key not found', code: 'NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ success: true, id: existing.id, revoked_at: existing.revoked_at, already_revoked: true })
}

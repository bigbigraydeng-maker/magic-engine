/**
 * GET   /api/clients/[id]/reels/[draftId]  — get a single draft
 * PATCH /api/clients/[id]/reels/[draftId]  — update editable fields directly
 *
 * Reference: ROADMAP.md P8.R.5
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

type RouteContext = { params: { id: string; draftId: string } }

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: RouteContext
) {
  const { id: clientId, draftId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('reels_drafts')
    .select('*')
    .eq('id', draftId)
    .eq('client_id', clientId)
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 404 })
  }

  return NextResponse.json({ success: true, draft: data })
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

const PATCHABLE_FIELDS = new Set([
  'opening_frame_prompt',
  'closing_frame_prompt',
  'i2v_video_prompt',
  'fb_caption',
  'campaign_brief_id',
])

export async function PATCH(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id: clientId, draftId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  // Only allow whitelisted fields
  const updates: Record<string, unknown> = {}
  for (const key of Object.keys(body)) {
    if (PATCHABLE_FIELDS.has(key)) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, error: 'No patchable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('reels_drafts')
    .update(updates)
    .eq('id', draftId)
    .eq('client_id', clientId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, draft: data })
}

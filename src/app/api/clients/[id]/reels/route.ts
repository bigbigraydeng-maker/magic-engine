/**
 * GET  /api/clients/[id]/reels  — list reels drafts for a client
 * POST /api/clients/[id]/reels  — create new draft (optionally with campaign_brief_id)
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  const { data, error } = await supabaseAdmin
    .from('reels_drafts')
    .select('id, status, fb_caption, created_at, updated_at, campaign_brief_id, video_url, source_storyboard_id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, drafts: data ?? [] })
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const clientId = params.id

  let body: { campaign_brief_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // Empty body is fine — just create a blank draft
  }

  const { data: draft, error } = await supabaseAdmin
    .from('reels_drafts')
    .insert({
      client_id: clientId,
      campaign_brief_id: body.campaign_brief_id ?? null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, draft }, { status: 201 })
}

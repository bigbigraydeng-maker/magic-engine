/**
 * GET  /api/admin/viral-references          — list all references (newest first)
 * POST /api/admin/viral-references          — batch import URLs for analysis
 *
 * POST body:
 *   { videos: Array<{ url: string, industry: string, client_id?: string, notes?: string }> }
 *
 * Each video is inserted as 'pending', then analyzed asynchronously.
 * Analysis results are written back to the same row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { detectPlatform, analyzeViralReference } from '@/lib/reels/viral-analyzer'

interface VideoInput {
  url: string
  industry: string
  content_goal?: 'brand' | 'sales' | 'ugc' | 'education'
  client_id?: string
  notes?: string
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, references: data })
}

export async function POST(req: NextRequest) {
  let body: { videos?: VideoInput[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const videos = body.videos
  if (!Array.isArray(videos) || videos.length === 0) {
    return NextResponse.json({ success: false, error: 'videos array is required' }, { status: 400 })
  }
  if (videos.length > 30) {
    return NextResponse.json({ success: false, error: 'Maximum 30 videos per batch' }, { status: 400 })
  }

  // Validate each entry
  for (const v of videos) {
    if (!v.url || !v.industry) {
      return NextResponse.json(
        { success: false, error: 'Each video must have url and industry' },
        { status: 400 }
      )
    }
  }

  // Insert all as 'pending'
  const rows = videos.map(v => ({
    source_url: v.url,
    industry: v.industry,
    content_goal: v.content_goal ?? 'brand',
    client_id: v.client_id ?? null,
    platform: detectPlatform(v.url),
    notes: v.notes ?? null,
    analysis_status: 'pending',
  }))

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('viral_reference_library')
    .insert(rows)
    .select('id, source_url, industry, analysis_status')

  if (insertErr) return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 })

  // Kick off analysis for each (non-blocking — runs in background)
  for (const ref of inserted ?? []) {
    analyzeViralReference(ref.id, ref.source_url).catch(err => {
      console.error(`[viral-references] analysis failed for ${ref.id}:`, err)
    })
  }

  return NextResponse.json({
    success: true,
    queued: inserted?.length ?? 0,
    references: inserted,
  })
}

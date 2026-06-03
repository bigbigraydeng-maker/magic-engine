/**
 * GET  /api/admin/viral-references          — paginated list
 * POST /api/admin/viral-references          — batch import URLs for analysis
 *
 * GET query params:
 *   page      number   page number, 1-based (default 1)
 *   pageSize  number   rows per page (default 50, max 200)
 *   status    string   filter by analysis_status, 'all' = no filter (default 'all')
 *   sort      string   'newest' | 'views' | 'industry' (default 'newest')
 *   summary   boolean  if '1', returns lightweight insight fields only (for InsightsPanel)
 *
 * GET response:
 *   { success, references, total, page, pageSize }
 *
 * POST body:
 *   { videos: Array<{ url: string, industry: string, client_id?: string, notes?: string }> }
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { detectPlatform, analyzeViralReference } from '@/lib/reels/viral-analyzer'

// Fields needed for InsightsPanel only (lightweight)
const INSIGHT_FIELDS = [
  'id', 'industry', 'content_goal', 'is_our_video', 'is_learnable',
  'analysis_status', 'style_scores', 'style_tags', 'style_description',
  'persona_fit', 'key_techniques', 'opening_hook', 'view_count', 'video_title',
].join(',')

// Full fields for the card grid
const FULL_FIELDS = '*'

interface VideoInput {
  url: string
  industry: string
  content_goal?: 'brand' | 'sales' | 'ugc' | 'education'
  is_our_video?: boolean
  client_id?: string
  notes?: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const isSummary = searchParams.get('summary') === '1'
  const page      = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const pageSize  = Math.min(200, Math.max(1, Number(searchParams.get('pageSize') ?? '50')))
  const status    = searchParams.get('status') ?? 'all'
  const sort      = searchParams.get('sort') ?? 'newest'

  // ── Summary mode: return all done+learnable records with insight fields only ──
  if (isSummary) {
    let q = supabaseAdmin
      .from('viral_reference_library')
      .select(INSIGHT_FIELDS)
      .eq('analysis_status', 'done')

    const { data, error } = await q
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, references: data ?? [] })
  }

  // ── Paginated list mode ───────────────────────────────────────────────────────

  // Count total (respecting status filter)
  let countQ = supabaseAdmin
    .from('viral_reference_library')
    .select('id', { count: 'exact', head: true })

  if (status !== 'all') countQ = countQ.eq('analysis_status', status)
  const { count, error: countErr } = await countQ
  if (countErr) return NextResponse.json({ success: false, error: countErr.message }, { status: 500 })

  // Fetch page
  let q = supabaseAdmin
    .from('viral_reference_library')
    .select(FULL_FIELDS)

  if (status !== 'all') q = q.eq('analysis_status', status)

  // Sorting
  if (sort === 'views') {
    q = q.order('view_count', { ascending: false, nullsFirst: false })
  } else if (sort === 'industry') {
    q = q.order('industry', { ascending: true }).order('created_at', { ascending: false })
  } else {
    q = q.order('created_at', { ascending: false })
  }

  const from = (page - 1) * pageSize
  const to   = from + pageSize - 1
  q = q.range(from, to)

  const { data, error } = await q
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json({
    success:    true,
    references: data ?? [],
    total:      count ?? 0,
    page,
    pageSize,
  })
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

  for (const v of videos) {
    if (!v.url || !v.industry) {
      return NextResponse.json(
        { success: false, error: 'Each video must have url and industry' },
        { status: 400 }
      )
    }
  }

  const rows = videos.map(v => ({
    source_url:      v.url,
    industry:        v.industry,
    content_goal:    v.content_goal ?? 'brand',
    is_our_video:    v.is_our_video ?? false,
    client_id:       v.client_id ?? null,
    platform:        detectPlatform(v.url),
    notes:           v.notes ?? null,
    analysis_status: 'pending',
  }))

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('viral_reference_library')
    .insert(rows)
    .select('id, source_url, industry, analysis_status')

  if (insertErr) return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 })

  for (const ref of inserted ?? []) {
    analyzeViralReference(ref.id, ref.source_url).catch(err => {
      console.error(`[viral-references] analysis failed for ${ref.id}:`, err)
    })
  }

  return NextResponse.json({
    success:    true,
    queued:     inserted?.length ?? 0,
    references: inserted,
  })
}

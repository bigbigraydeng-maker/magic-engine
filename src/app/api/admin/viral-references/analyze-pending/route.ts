/**
 * POST /api/admin/viral-references/analyze-pending
 *
 * Picks up all 'pending' viral references and kicks off Gemini analysis
 * for each one asynchronously. Safe to call multiple times (skips non-pending).
 *
 * Returns immediately with the list of IDs queued.
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyzeViralReference } from '@/lib/reels/viral-analyzer'

export async function POST() {
  const { data: pending, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select('id, source_url')
    .eq('analysis_status', 'pending')

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!pending || pending.length === 0) {
    return NextResponse.json({ success: true, queued: 0, message: 'No pending references found' })
  }

  for (const ref of pending) {
    analyzeViralReference(ref.id, ref.source_url).catch(err => {
      console.error(`[analyze-pending] failed for ${ref.id}:`, err)
    })
  }

  return NextResponse.json({
    success: true,
    queued: pending.length,
    ids: pending.map(r => r.id),
  })
}

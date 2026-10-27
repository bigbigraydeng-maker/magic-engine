/**
 * POST /api/admin/viral-references/[id]/retry
 *
 * Resets a single reference back to 'pending' and immediately kicks off analysis.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { analyzeViralReference } from '@/lib/reels/viral-analyzer'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const { id } = params

  const { data: ref, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select('id, source_url')
    .eq('id', id)
    .maybeSingle()

  if (error || !ref) {
    return NextResponse.json({ success: false, error: 'Reference not found' }, { status: 404 })
  }

  await supabaseAdmin
    .from('viral_reference_library')
    .update({
      analysis_status: 'pending',
      analysis_error: null,
      analysis_attempts: 0,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  analyzeViralReference(ref.id, ref.source_url).catch(err => {
    console.error(`[retry] failed for ${id}:`, err)
  })

  return NextResponse.json({ success: true })
}

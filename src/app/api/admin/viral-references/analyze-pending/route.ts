/**
 * POST /api/admin/viral-references/analyze-pending
 *
 * Counts pending viral references. Does NOT trigger analysis directly —
 * the dedicated /api/cron/viral-analyzer-worker drains the queue every 2 min
 * with throttling (8 videos, 5s delay) to stay within Gemini TPM limits.
 *
 * Manual fire-and-forget was removed because bursting hundreds of concurrent
 * Gemini calls exceeded the paid-tier TPM cap and produced 429 errors.
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'

export async function POST() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const { data: pending, error } = await supabaseAdmin
    .from('viral_reference_library')
    .select('id', { count: 'exact', head: false })
    .eq('analysis_status', 'pending')

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  const count = pending?.length ?? 0
  return NextResponse.json({
    success: true,
    queued:  count,
    message: count > 0
      ? `${count} 条 pending — 节流 worker 每 2 分钟处理 8 条，预计 ${Math.ceil(count / 4)} 分钟内分析完`
      : 'No pending references found',
  })
}

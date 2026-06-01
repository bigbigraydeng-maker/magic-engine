/**
 * POST /api/cron/vision-analyzer
 *
 * Phase 21.B.3 — Vision Analysis Engine
 *
 * Picks up to BATCH_SIZE client_assets with status='pending',
 * analyses each via GPT-4o-mini Vision, writes vision_metadata +
 * Hook/Middle/CTA scores back to the row.
 *
 * Auth:     Authorization: Bearer ${CRON_SECRET}
 * Schedule: every 2 minutes (render.yaml)
 * Batch:    10 assets per run (keeps run time < 60s)
 *
 * Idempotency: sets status='analyzing' before calling Vision API,
 * so a second concurrent run won't double-process the same asset.
 *
 * Reference: ROADMAP.md P21.B.3
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { analyseImage, computeScores } from '@/lib/assets/vision-analyzer'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH_SIZE = 10

export async function POST(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 1. Claim a batch: PostgREST UPDATE does not support .order().limit(),
  //    so we SELECT the IDs first, then UPDATE by ID.
  const { data: pending, error: selectErr } = await supabaseAdmin
    .from('client_assets')
    .select('id, storage_url, original_filename')
    .eq('status', 'pending')
    .is('archived_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (selectErr) {
    console.error('[vision-analyzer] select error:', selectErr.message)
    return NextResponse.json({ error: selectErr.message }, { status: 500 })
  }

  const batch = pending ?? []
  if (batch.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'No pending assets' })
  }

  // Mark as 'analyzing' so a concurrent run won't double-process
  const { error: claimErr } = await supabaseAdmin
    .from('client_assets')
    .update({ status: 'analyzing' })
    .in('id', batch.map(a => a.id))

  if (claimErr) {
    console.error('[vision-analyzer] claim error:', claimErr.message)
    return NextResponse.json({ error: claimErr.message }, { status: 500 })
  }

  let succeeded = 0
  let failed    = 0
  const errors: string[] = []

  for (const asset of batch) {
    try {
      const metadata = await analyseImage(asset.storage_url)
      const scores   = computeScores(metadata)

      const { error: updateErr } = await supabaseAdmin
        .from('client_assets')
        .update({
          status:           'analyzed',
          vision_metadata:  metadata,
          hook_score:       scores.hook_score,
          middle_score:     scores.middle_score,
          cta_score:        scores.cta_score,
          recommended_use:  scores.recommended_use,
          error_message:    null,
        })
        .eq('id', asset.id)

      if (updateErr) throw new Error(updateErr.message)

      console.log(
        `[vision-analyzer] ✓ ${asset.original_filename ?? asset.id} ` +
        `hook=${scores.hook_score} mid=${scores.middle_score} cta=${scores.cta_score} → ${scores.recommended_use}`,
      )
      succeeded++

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[vision-analyzer] ✗ ${asset.id}: ${msg}`)
      errors.push(`${asset.original_filename ?? asset.id}: ${msg}`)
      failed++

      // Mark as error so it doesn't stay stuck at 'analyzing'
      try {
        await supabaseAdmin
          .from('client_assets')
          .update({ status: 'error', error_message: msg })
          .eq('id', asset.id)
      } catch {
        // best-effort status update
      }
    }
  }

  return NextResponse.json({
    ok:        true,
    timestamp: new Date().toISOString(),
    batch:     batch.length,
    succeeded,
    failed,
    errors,
  })
}

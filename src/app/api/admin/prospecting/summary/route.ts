/**
 * GET /api/admin/prospecting/summary
 *
 * Admin-only. Aggregate counts for the Prospecting CRM (Phase 35): one number
 * per pipeline status for the funnel, plus a `parked` count (analyzed rows that
 * failed analysis or drafting and are stuck) for the "needs attention" bar.
 * Cheap head-count queries, no row payloads.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

const STATUSES = [
  'discovered', 'audited', 'qualified', 'analyzed',
  'outreach_ready', 'contacted', 'replied', 'converted', 'archived', 'opted_out',
] as const

async function countStatus(status: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('outbound_prospects').select('id', { count: 'exact', head: true }).eq('status', status)
  return count ?? 0
}

export async function GET(): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const entries = await Promise.all(STATUSES.map(async s => [s, await countStatus(s)] as const))
  const counts = Object.fromEntries(entries) as Record<(typeof STATUSES)[number], number>

  // Parked = analyzed but stuck (analysis error or draft retries exhausted).
  const { count: parked } = await supabaseAdmin
    .from('outbound_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'analyzed')
    .or('ai_report->error.not.is.null,ai_report->draft_error.not.is.null')

  return NextResponse.json({ counts, parked: parked ?? 0 })
}

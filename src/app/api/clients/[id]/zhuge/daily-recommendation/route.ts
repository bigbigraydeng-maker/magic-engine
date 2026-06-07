/**
 * GET /api/clients/[id]/zhuge/daily-recommendation
 *
 * DAPE W5 (spec §2.4.5) — "AI 推荐今天做 3 件"
 *
 * Returns up to 3 daily recommendations for a client's Kanban from
 * execution_items (status IN pending/in_progress). Short-mode ranker:
 * pure rule-based, no LLM, no MTC cost — equivalent to the "短 prompt"
 * mode described in spec §2.4.6.
 *
 * Response:
 *   200 { success: true, recommendations: DailyRecommendation[], generated_at: ISO }
 *   404 client not found
 *   500 DB error
 *
 * Security: Bearer token (INTERNAL_API_KEY) via requirePaidClientAccess
 * Reference: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §2.4
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import {
  fetchDailyRecommendations,
  type DailyRecommendation,
} from '@/lib/zhuge/daily-recommendation'

export const dynamic = 'force-dynamic'

export interface DailyRecommendationResponse {
  success: true
  recommendations: DailyRecommendation[]
  generated_at: string
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // Verify client exists
  const { data: clientRow, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError) {
    console.error('[zhuge/daily-recommendation] client lookup error:', clientError.message)
    return NextResponse.json(
      { success: false, error: 'Failed to verify client' },
      { status: 500 },
    )
  }
  if (!clientRow) {
    return NextResponse.json(
      { success: false, error: `Client ${clientId} not found.` },
      { status: 404 },
    )
  }

  try {
    const recommendations = await fetchDailyRecommendations(supabaseAdmin, clientId)
    return NextResponse.json({
      success: true,
      recommendations,
      generated_at: new Date().toISOString(),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[zhuge/daily-recommendation] error:', msg)
    return NextResponse.json(
      { success: false, error: msg },
      { status: 500 },
    )
  }
}

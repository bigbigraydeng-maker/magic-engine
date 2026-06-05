import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { assembleSeoAgentInput } from '@/lib/seo-agent/assembler'
import { runSeoAgent } from '@/lib/seo-agent/conductor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const limit = clampLimit(Number(req.nextUrl.searchParams.get('limit') ?? '5'))

  try {
    const input = await assembleSeoAgentInput(supabaseAdmin, clientId)
    const result = await runSeoAgent(input, limit)

    return NextResponse.json({
      success: true,
      output: result.output,
      meta: {
        candidate_count: input.candidates.length,
        rankings_count: input.rankings_count,
        gap_count: input.gap_count,
        position_change_count: input.position_change_count,
        used_fallback: result.used_fallback,
        cost_usd: result.cost_usd,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SEO agent failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.min(8, Math.max(1, Math.round(value)))
}

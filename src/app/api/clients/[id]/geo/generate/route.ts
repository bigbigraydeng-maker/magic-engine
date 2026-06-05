import { NextRequest, NextResponse } from 'next/server'
import { generateGeoDirective } from '@/lib/geo/composer'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * POST /api/clients/[id]/geo/generate
 *
 * Generates a new GEO directive (as draft) from Master Brief + Tracker data.
 * Does NOT auto-activate — user must explicitly activate via the UI.
 *
 * Body (all optional):
 * {
 *   use_tracker?: boolean      // default true — include Tracker weak spots
 *   context_hint?: string      // extra steering context
 * }
 *
 * Reference: ROADMAP.md P7.2.5, ARCHITECTURE.md §11.4
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const clientId = params.id
    const body = (await req.json().catch(() => ({}))) as {
      use_tracker?: boolean
      context_hint?: string
    }

    // Determine next version number for this client
    const { data: existing } = await supabaseAdmin
      .from('geo_directives')
      .select('version')
      .eq('client_id', clientId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersion = ((existing as { version: number } | null)?.version ?? 0) + 1

    // Generate via GPT-4o-mini
    const result = await generateGeoDirective({
      client_id: clientId,
      use_tracker: body.use_tracker ?? true,
      context_hint: body.context_hint,
    })

    // Persist as draft
    const { data: directive, error } = await supabaseAdmin
      .from('geo_directives')
      .insert({
        client_id: clientId,
        version: nextVersion,
        status: 'draft',
        primary_recommendation: result.primary_recommendation,
        scenarios: result.scenarios,
        audience_signals: result.audience_signals,
        competitive_positioning: result.competitive_positioning,
        source_brief_id: result.source_brief_id,
        source_tracker_snapshot_id: result.source_tracker_snapshot_id,
        deployed_pages: [],
      })
      .select('*')
      .single<GeoDirective>()

    if (error || !directive) {
      return NextResponse.json(
        { success: false, error: `DB insert failed: ${error?.message ?? 'no row'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      directive,
      cost_usd: result.cost_usd,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

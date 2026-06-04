import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective, GeoScenario, GeoAudienceSignals } from '@/types/magic-engine'
import { requirePaidClientAccess } from '@/lib/auth/client-access'

/**
 * PATCH /api/clients/[id]/geo/[directiveId]
 *
 * Edit fields of a GEO directive. Only draft directives can be edited
 * (active directives should be archived first or a new draft created).
 *
 * Body (all optional):
 * {
 *   primary_recommendation?: string
 *   scenarios?: GeoScenario[]
 *   audience_signals?: GeoAudienceSignals
 *   competitive_positioning?: string
 * }
 *
 * Reference: ROADMAP.md P7.2.7, ARCHITECTURE.md §11.4
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; directiveId: string } }
) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error, reason: access.reason }, { status: access.status })
  }

  try {
    const { directiveId } = params
    const body = (await req.json()) as {
      primary_recommendation?: string
      scenarios?: GeoScenario[]
      audience_signals?: GeoAudienceSignals
      competitive_positioning?: string
    }

    const update: Record<string, unknown> = {}
    if (typeof body.primary_recommendation === 'string') {
      update.primary_recommendation = body.primary_recommendation
    }
    if (Array.isArray(body.scenarios)) {
      update.scenarios = body.scenarios
    }
    if (body.audience_signals && typeof body.audience_signals === 'object') {
      update.audience_signals = body.audience_signals
    }
    if (typeof body.competitive_positioning === 'string') {
      update.competitive_positioning = body.competitive_positioning
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('geo_directives')
      .update(update)
      .eq('id', directiveId)
      .select('*')
      .single<GeoDirective>()

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, directive: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

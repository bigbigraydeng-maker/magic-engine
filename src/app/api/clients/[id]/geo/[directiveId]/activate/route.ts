import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { GeoDirective } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/geo/[directiveId]/activate
 *
 * Activates a draft directive atomically via the activate_geo_directive RPC:
 *   1. Archives the current active directive (if any)
 *   2. Archives all OTHER draft directives for this client (PM 2026-06-04
 *      decision — keep history recoverable via `archived`, not hard delete)
 *   3. Promotes the target directive to active
 *
 * All 3 steps run inside a single Postgres transaction. If any step fails the
 * whole thing rolls back — no more "step 1 archived, step 2 crashed, client
 * has zero active directives" scenario.
 *
 * Response:
 *   { success: true, directive: GeoDirective, drafts_archived: number,
 *     former_active_id: string | null }
 *
 * Reference: ROADMAP.md P7.2.8 + 2026-06-04 atomicity hardening
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; directiveId: string } }
) {
  try {
    const { id: clientId, directiveId } = params

    // Call the atomic RPC. Returns one row { activated_id, activated_version,
    // drafts_archived, former_active_id } or an error.
    const { data: rpcResult, error: rpcError } = await supabaseAdmin
      .rpc('activate_geo_directive', {
        p_client_id:    clientId,
        p_directive_id: directiveId,
      })
      .single<{
        activated_id: string
        activated_version: number
        drafts_archived: number
        former_active_id: string | null
      }>()

    if (rpcError || !rpcResult) {
      // P0002 = our raise exception inside the RPC ("directive not found")
      const status = rpcError?.code === 'P0002' ? 404 : 500
      return NextResponse.json(
        { success: false, error: rpcError?.message ?? 'Activation failed' },
        { status }
      )
    }

    // Hydrate the full directive row for the response (the RPC only returns
    // a summary tuple; the UI wants the same shape as before).
    const { data: directive, error: fetchError } = await supabaseAdmin
      .from('geo_directives')
      .select('*')
      .eq('id', rpcResult.activated_id)
      .single<GeoDirective>()

    if (fetchError || !directive) {
      return NextResponse.json(
        { success: false, error: fetchError?.message ?? 'Activated directive missing' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      directive,
      drafts_archived: rpcResult.drafts_archived,
      former_active_id: rpcResult.former_active_id,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

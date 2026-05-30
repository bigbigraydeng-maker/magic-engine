/**
 * POST /api/clients/[id]/assets/storyboard
 *
 * Phase 21.B.5+6 — Theme-based selection + Storyboard generation
 *
 * Body:
 *   theme            string   required — campaign theme / angle
 *   hook_asset_id    string?  optional — override auto-selection
 *   middle_asset_ids string[] optional — override auto-selection
 *   cta_asset_id     string?  optional — override auto-selection
 *
 * Returns the saved asset_storyboards row.
 * Reference: ROADMAP.md P21.B.5, P21.B.6
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { selectAssetsForTheme, generateStoryboard } from '@/lib/assets/storyboard-generator'

type RouteContext = { params: { id: string } }

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: {
    theme?: string
    hook_asset_id?: string
    middle_asset_ids?: string[]
    cta_asset_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const theme = body.theme?.trim()
  if (!theme) {
    return NextResponse.json({ success: false, error: 'theme is required' }, { status: 400 })
  }

  try {
    // P21.B.5 — Select best assets (auto or manual override)
    const selection = await selectAssetsForTheme(clientId, {
      hook_asset_id:   body.hook_asset_id,
      middle_asset_ids: body.middle_asset_ids,
      cta_asset_id:    body.cta_asset_id,
    })

    // P21.B.6 — Generate storyboard + prompts via Claude Sonnet
    const storyboard = await generateStoryboard({ clientId, theme, selection })

    // Persist to asset_storyboards
    const { data: saved, error: dbErr } = await supabaseAdmin
      .from('asset_storyboards')
      .insert({
        client_id:       clientId,
        theme,
        hook_asset_id:   selection.hook.id,
        middle_asset_ids: selection.middle.map(a => a.id),
        cta_asset_id:    selection.cta.id,
        storyboard_json: {
          scenes:         storyboard.scenes,
          market_context: storyboard.market_context,
          brand_voice:    storyboard.brand_voice,
        },
        seedance_prompt: storyboard.seedance_prompt,
        kling_prompt:    storyboard.kling_prompt,
        runway_prompt:   storyboard.runway_prompt,
      })
      .select('*')
      .single()

    if (dbErr) throw new Error(dbErr.message)

    return NextResponse.json({
      success: true,
      storyboard: saved,
      selection: {
        hook:   { id: selection.hook.id,   url: selection.hook.storage_url },
        middle: selection.middle.map(a => ({ id: a.id, url: a.storage_url })),
        cta:    { id: selection.cta.id,    url: selection.cta.storage_url },
      },
    }, { status: 201 })

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[assets/storyboard] error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

// GET — list storyboards for client
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('asset_storyboards')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, storyboards: data ?? [] })
}

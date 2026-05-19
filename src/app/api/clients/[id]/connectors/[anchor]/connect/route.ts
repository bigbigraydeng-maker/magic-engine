/**
 * POST /api/clients/[id]/connectors/[anchor]/connect
 *
 * Mark a connector as authorised and optionally save config (e.g. a Facebook
 * page URL). For meta-ads and gbp connectors, also auto-triggers an advanced
 * discovery job if the client already has a basic discovery on record.
 *
 * Body: { config?: { page_url?: string } }
 * Returns: { success, advanced_job_id? }
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S0.22
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'

// Anchors that unlock advanced discovery when connected.
const ADVANCED_DISCOVERY_TRIGGERS = new Set(['meta-ads', 'gbp', 'gsc', 'google-ads'])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; anchor: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const { id: clientId, anchor } = params

  // Parse optional config from request body
  let config: Record<string, unknown> | null = null
  try {
    const body = await req.json() as { config?: Record<string, unknown> }
    config = body.config ?? null
  } catch {
    // No body or non-JSON — fine, config stays null
  }

  // Upsert connector status
  const now = new Date().toISOString()
  const { error: upsertError } = await supabaseAdmin
    .from('client_connectors')
    .upsert(
      {
        client_id: clientId,
        anchor,
        status: 'connected',
        config,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: 'client_id,anchor' },
    )

  if (upsertError) {
    return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 })
  }

  // Trigger advanced discovery for supported connectors
  if (!ADVANCED_DISCOVERY_TRIGGERS.has(anchor)) {
    return NextResponse.json({ success: true })
  }

  // Check if basic discovery exists
  const existing = await getLatestDiscovery(supabaseAdmin, clientId).catch(() => null)
  if (!existing) {
    // No basic discovery yet — advanced will run after basic completes
    return NextResponse.json({
      success: true,
      advanced_job_id: null,
      note: 'No basic discovery found; advanced discovery will auto-trigger after basic completes.',
    })
  }

  // For gsc, forward site_url from config so the agent can call the correct property
  const extraConfig: Record<string, unknown> = {}
  if (anchor === 'gsc' && typeof config?.site_url === 'string' && config.site_url) {
    extraConfig.site_url = config.site_url
  }

  // Fire-and-forget: POST to the advanced-discover endpoint internally
  const advancedJobId = await enqueueAdvancedDiscovery(clientId, anchor, extraConfig)

  return NextResponse.json({ success: true, advanced_job_id: advancedJobId })
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function enqueueAdvancedDiscovery(
  clientId: string,
  triggeredBy: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  try {
    // Use the advanced-discover route for job creation + execution
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3001'

    const res = await fetch(
      `${baseUrl}/api/clients/${clientId}/zhangqian/advanced-discover`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_KEY ?? ''}`,
        },
        body: JSON.stringify({ triggered_by: triggeredBy, ...extra }),
      },
    )

    if (!res.ok) {
      console.error(`[connectors/connect] advanced-discover returned ${res.status}`)
      return null
    }

    const data = await res.json() as { job_id?: string }
    return data.job_id ?? null
  } catch (err) {
    console.error('[connectors/connect] failed to enqueue advanced discovery:', err)
    return null
  }
}

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
 * Security: session-cookie via requireOnboardingClientAccess — self-serve
 * clients must be able to connect their OWN accounts during onboarding.
 * Isolation is unchanged (caller can only touch their own client).
 * Reference: ROADMAP.md P8.10.S0.22 · Phase B $990 self-serve onboarding
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getLatestDiscovery } from '@/lib/zhangqian/persistor'
import { startAdvancedDiscovery } from '@/lib/zhangqian/start-advanced-discovery'

// Valid connector anchors. MUST stay in sync with CONNECTOR_CATALOGUE in
// ../../status/route.ts. `anchor` is a path param written straight into
// client_connectors, so it is whitelisted here to keep junk rows out of the
// table (the DB column has no CHECK constraint).
const VALID_ANCHORS = new Set(['gsc', 'google-ads', 'gbp', 'meta-ads', 'reviews', 'ga4', 'publer', 'social'])

// Anchors that unlock advanced discovery when connected.
const ADVANCED_DISCOVERY_TRIGGERS = new Set(['meta-ads', 'gbp', 'gsc', 'google-ads'])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; anchor: string } },
): Promise<NextResponse> {
  const { id: clientId, anchor } = params
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  if (!VALID_ANCHORS.has(anchor)) {
    return NextResponse.json({ success: false, error: `Unknown connector: ${anchor}` }, { status: 400 })
  }

  // Parse optional config from request body
  let config: Record<string, unknown> | null = null
  try {
    const body = await req.json() as { config?: Record<string, unknown> }
    config = body.config ?? null
  } catch {
    // No body or non-JSON; config stays null.
  }

  // Was this connector ALREADY connected before this request? Advanced
  // discovery is expensive (external API + LLM); it must fire only on the
  // first connect of an anchor, never on every re-POST. Without this gate a
  // self_serve client could loop "connect → wait for completion → connect
  // again" to keep re-triggering full-price discovery runs (魏征/狄仁杰 D1
  // re-review). The in-flight dedup in startAdvancedDiscovery only covers
  // concurrent clicks; this covers the complete-then-retrigger loop.
  const { data: prior } = await supabaseAdmin
    .from('client_connectors')
    .select('status')
    .eq('client_id', clientId)
    .eq('anchor', anchor)
    .maybeSingle<{ status: string }>()
  const wasConnected = prior?.status === 'connected'

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

  // Trigger advanced discovery for supported connectors — first connect only.
  if (!ADVANCED_DISCOVERY_TRIGGERS.has(anchor) || wasConnected) {
    return NextResponse.json({ success: true })
  }

  // Check if basic discovery exists
  const existing = await getLatestDiscovery(supabaseAdmin, clientId).catch(() => null)
  if (!existing) {
    // No basic discovery yet; advanced will run after basic completes.
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

  const advancedJobId = await enqueueAdvancedDiscovery(clientId, anchor, extraConfig)

  return NextResponse.json({ success: true, advanced_job_id: advancedJobId })
}

async function enqueueAdvancedDiscovery(
  clientId: string,
  triggeredBy: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  try {
    const siteUrl = typeof extra.site_url === 'string' ? extra.site_url : undefined
    const result = await startAdvancedDiscovery(supabaseAdmin, clientId, {
      triggeredBy,
      siteUrl,
    })
    return result.jobId
  } catch (err) {
    console.error('[connectors/connect] failed to enqueue advanced discovery:', err)
    return null
  }
}

/**
 * GET /api/clients/[id]/onboarding/status
 *
 * Powers the self-serve onboarding wizard's resumable progress. Progress is
 * INFERRED from existing fields (zero new table — spec §4 / decision D2), so a
 * client can leave and come back and each step shows done/not-done from real
 * data:
 *   - profile   → clients.brief_completed_at
 *   - website   → clients.domain
 *   - connectors→ client_connectors rows with status='connected' (per anchor)
 *   - assets    → any client_assets row
 *   - completed → clients.onboarding_completed_at
 *
 * Security: requireOnboardingClientAccess (own client only).
 * Reference: Phase B $990 self-serve onboarding wizard spec.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

const TRACKED_CONNECTORS = ['gbp', 'ga4', 'gsc', 'meta-ads'] as const

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireOnboardingClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const [clientRes, connectorsRes, assetsRes] = await Promise.all([
    supabaseAdmin.from('clients').select('brief_completed_at, domain, onboarding_completed_at').eq('id', clientId).maybeSingle(),
    supabaseAdmin.from('client_connectors').select('anchor, status').eq('client_id', clientId).eq('status', 'connected'),
    supabaseAdmin.from('client_assets').select('id').eq('client_id', clientId).limit(1),
  ])

  const client = clientRes.data as { brief_completed_at: string | null; domain: string | null; onboarding_completed_at: string | null } | null
  const connected = new Set((connectorsRes.data as { anchor: string }[] | null)?.map(r => r.anchor) ?? [])
  const hasAssets = ((assetsRes.data as unknown[] | null)?.length ?? 0) > 0

  const connectors: Record<string, boolean> = {}
  for (const a of TRACKED_CONNECTORS) connectors[a] = connected.has(a)

  return NextResponse.json({
    steps: {
      profile:    Boolean(client?.brief_completed_at),
      website:    Boolean(client?.domain),
      connectors,
      assets:     hasAssets,
    },
    completed: Boolean(client?.onboarding_completed_at),
  })
}

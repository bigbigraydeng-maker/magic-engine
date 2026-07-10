/**
 * POST /api/unsubscribe/[id]
 *
 * Public (no auth): the one-click opt-out behind the unsubscribe link in every
 * outreach email (Phase 35). The prospect UUID in the URL is the token — the
 * same unguessable-id model the report page already uses. A POST (not a GET on
 * page load) so email security scanners that prefetch links can't fire a false
 * opt-out.
 *
 * Effect: flips the prospect to the terminal `opted_out` status (permanent
 * do-not-contact — those rows never re-enter the review queue and discover-
 * dedup blocks any re-import) and records when/how the opt-out happened in the
 * existing ai_report jsonb (no migration). Honouring it immediately satisfies
 * the AU Spam Act's 5-business-day rule.
 *
 * Idempotent: an already-opted-out prospect returns ok, so a second click (or
 * a scanner that does follow through) is harmless.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { ProspectAnalysis } from '@/lib/prospecting/analyze'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Statuses from which an opt-out flips the row to the terminal `opted_out`.
// Mirrors the admin opt_out allowlist — deliberately excludes `converted`
// (paying client) and `archived`, whose business markers must not be lost.
const OPT_OUT_FROM = new Set([
  'discovered', 'audited', 'qualified', 'analyzed', 'outreach_ready', 'contacted', 'replied',
])

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { data: prospect, error: readErr } = await supabaseAdmin
    .from('outbound_prospects')
    .select('business_name, status, ai_report')
    .eq('id', params.id)
    .maybeSingle<{ business_name: string; status: string; ai_report: ProspectAnalysis | null }>()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!prospect) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Already suppressed → no-op success (idempotent).
  if (prospect.status === 'opted_out') {
    return NextResponse.json({ ok: true, business_name: prospect.business_name })
  }

  // Record the opt-out request on the existing analysis jsonb (extra key is
  // ignored by the report renderer) regardless of status, so we always honour
  // "don't email me" and keep an audit trail.
  const mergedReport = {
    ...(prospect.ai_report ?? {}),
    opt_out: { at: new Date().toISOString(), via: 'unsubscribe_link' },
  }
  // Flip to the terminal opted_out status ONLY from a pre-conversion state —
  // the SAME allowlist the admin opt_out path uses
  // (api/admin/prospecting/[id]/route.ts). A `converted` (paying client) or
  // `archived` prospect keeps its status, so a late click on an old email
  // can't silently destroy that business marker; the request is still recorded
  // above and neither status re-enters outreach anyway.
  const nextStatus = OPT_OUT_FROM.has(prospect.status) ? 'opted_out' : prospect.status

  const { error: writeErr } = await supabaseAdmin
    .from('outbound_prospects')
    .update({ status: nextStatus, ai_report: mergedReport, updated_at: new Date().toISOString() })
    .eq('id', params.id)
  if (writeErr) return NextResponse.json({ error: writeErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, business_name: prospect.business_name })
}

import { supabaseAdmin } from '@/lib/supabase'

/**
 * Tools Lab lead events (docs/specs/2026-09-27-tools-lab-step1-ads-check-design.md §5 PR-A 4).
 * One `tool_signup` row per client and tool, written only after the person has a verified session
 * (called from the post-login landing), so unverified or scripted registrations never count.
 * Stored in the existing `website_lead_events` table; contact details stay in the clients table.
 * Best effort: a failed write never blocks the sign-in.
 */
export type LabTool = 'ads-check'

const TOOL_ENTRY: Record<LabTool, string> = { 'ads-check': '/meta-ads-ai/mine' }

export async function recordToolSignupOnce(clientId: string, tool: LabTool): Promise<void> {
  try {
    const { data: existing, error: readError } = await supabaseAdmin
      .from('website_lead_events')
      .select('id')
      .eq('cta_key', 'tool_signup')
      .eq('destination', tool)
      .contains('metadata', { client_id: clientId })
      .limit(1)
    if (readError || (existing && existing.length > 0)) return
    const { error } = await supabaseAdmin.from('website_lead_events').insert({
      page_path: TOOL_ENTRY[tool],
      cta_key: 'tool_signup',
      destination: tool,
      target_href: TOOL_ENTRY[tool],
      source: 'tools_lab',
      metadata: { client_id: clientId },
    })
    if (error) console.warn('[tools-lab] tool_signup not recorded', { tool, reason: error.message })
  } catch (err) {
    console.warn('[tools-lab] tool_signup not recorded', { tool, reason: err instanceof Error ? err.message : String(err) })
  }
}

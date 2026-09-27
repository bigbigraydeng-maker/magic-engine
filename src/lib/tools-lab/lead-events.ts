import { supabaseAdmin } from '@/lib/supabase'
import { inngest } from '@/lib/inngest/client'
import { TOOLS_LAB_LEAD_CAPTURED_EVENT } from '@/lib/inngest/functions/tools-lab-lead-followup'

/**
 * Tools Lab lead events — the ONE place every tool writes "someone showed real interest" to.
 * Originally ads-check-only (`recordToolSignupOnce`, docs/specs/2026-09-27-tools-lab-step1-ads-check-design.md
 * §5 PR-A 4); generalised so site-check's report-email submissions write here too, instead of that
 * signal only ever landing in `discovery_leads` where nothing downstream ever reads it.
 *
 * Stored in the existing `website_lead_events` table (cta_key: 'tool_signup'). Best effort: a failed
 * write never blocks the caller's own flow (sign-in / report send).
 *
 * Downstream: `src/lib/pm-todo/tool-lead-items.ts` surfaces recent rows as a "需要你动手" item so a
 * human actually sees the lead (this table used to be write-only — nobody consumed it). A NEW lead
 * (not a duplicate) also emits `tools_lab/lead.captured` for `src/lib/inngest/functions/tools-lab-lead-followup.ts`.
 */
export type LabTool = 'ads-check' | 'site-check'

export interface RecordToolLeadInput {
  tool: LabTool
  pagePath: string
  targetHref: string
  /**
   * Identifies this lead for the duplicate check (`.contains('metadata', dedupeKey)`) — keep this to
   * stable identifiers only (e.g. `{ client_id }` or `{ lead_id }`), never anything that varies between
   * retries of the same real-world event, or every retry would count as a new lead.
   */
  dedupeKey: Record<string, string>
  /** Extra fields stored alongside `dedupeKey` for the todo item / receipt, not used for the duplicate check. */
  extraMetadata?: Record<string, unknown>
  /** A real prospect's own email (site-check). Omit for an existing client's own activation (ads-check) — there's no separate CRM contact to create for a row that's already a `clients` record. */
  email?: string
}

export async function recordToolLead(input: RecordToolLeadInput): Promise<void> {
  const { tool, pagePath, targetHref, dedupeKey, extraMetadata, email } = input
  // `email` is stored too (not just used for the Inngest payload) — the pm-todo item needs it to tell
  // a human who to actually follow up with.
  const metadata = { ...dedupeKey, ...extraMetadata, ...(email ? { email } : {}) }
  try {
    const { data: existing, error: readError } = await supabaseAdmin
      .from('website_lead_events')
      .select('id')
      .eq('cta_key', 'tool_signup')
      .eq('destination', tool)
      .contains('metadata', dedupeKey)
      .limit(1)
    if (readError || (existing && existing.length > 0)) return
    const { data: inserted, error } = await supabaseAdmin
      .from('website_lead_events')
      .insert({ page_path: pagePath, cta_key: 'tool_signup', destination: tool, target_href: targetHref, source: 'tools_lab', metadata })
      .select('id')
      .single()
    if (error || !inserted) {
      console.warn('[tools-lab] lead not recorded', { tool, reason: error?.message })
      return
    }
    // Best effort — a failed emit just means this lead surfaces one digest cycle later via the
    // pm-todo pusher (which reads website_lead_events directly, not via this event).
    await inngest
      .send({ name: TOOLS_LAB_LEAD_CAPTURED_EVENT, data: { leadEventId: inserted.id as string, tool, dedupeKey, email: email ?? null, created_at: new Date().toISOString() } })
      .catch((err) => console.warn('[tools-lab] lead.captured emit failed', { tool, reason: err instanceof Error ? err.message : String(err) }))
  } catch (err) {
    console.warn('[tools-lab] lead not recorded', { tool, reason: err instanceof Error ? err.message : String(err) })
  }
}

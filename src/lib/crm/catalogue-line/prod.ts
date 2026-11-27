/** The real data behind sendCatalogueEmail, scoped to one client. No mail channel here: sending is sendTemplateEmail's. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createPreviewData } from '@/lib/crm/email-templates/preview-prod'
import { sendTemplateEmail } from '@/lib/crm/email-templates/send-template-email'
import { findSentTemplateReceiptsSince } from '@/lib/crm/email-templates/receipt-store'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { fetchAll } from '@/lib/supabase-paginate'
import { previewTemplate } from '@/lib/crm/email-templates/template-preview'
import { loadClientTimeZone } from '@/lib/crm/email-templates/time-zone'
import { supabaseAdmin } from '@/lib/supabase'
import type { EligibilityContact, EligibilityData, EligibilityStage } from './eligibility'
import type { CatalogueDeps } from './send-catalogue'

const MAX_STAGES = 200

export function createEligibilityData(db: SupabaseClient): EligibilityData {
  return {
    async loadContact(clientId, contactId): Promise<EligibilityContact | null> {
      const { data, error } = await db
        .from('contacts')
        .select('do_not_contact, stage, snooze_until')
        .eq('client_id', clientId)
        .eq('id', contactId)
        .maybeSingle()
      if (error) throw new Error(`contacts: ${error.message}`)
      if (data === null) return null
      const row = data as { do_not_contact: unknown; stage: unknown; snooze_until: unknown }
      // Only a definite false is "may be contacted": anything else is read as do-not-contact.
      return {
        doNotContact: row.do_not_contact !== false,
        stage: typeof row.stage === 'string' && row.stage !== '' ? row.stage : null,
        snoozeUntil: typeof row.snooze_until === 'string' ? row.snooze_until : null,
      }
    },
    async loadStages(clientId): Promise<EligibilityStage[]> {
      const { data, error } = await db
        .from('client_pipeline_stages')
        .select('stage_key, marketing_action, is_terminal')
        .eq('client_id', clientId)
        .limit(MAX_STAGES + 1)
      if (error) throw new Error(`client_pipeline_stages: ${error.message}`)
      const rows = (data as Array<{ stage_key: unknown; marketing_action: unknown; is_terminal: unknown }> | null) ?? []
      // More rows than one page: we cannot vouch that the guest's stage is not among the unread ones.
      if (rows.length > MAX_STAGES) throw new Error('client_pipeline_stages: too many stages to read them all')
      return rows.map((r) => ({
        stageKey: String(r.stage_key),
        marketingAction: typeof r.marketing_action === 'string' ? r.marketing_action : null,
        isTerminal: r.is_terminal === true,
      }))
    },
  }
}

/**
 * When this guest was last sent this catalogue template by another request (sent, or outcome still unknown); null = none.
 * An `unknown` send later settled as `failed` never went out and does not count (findSentTemplateReceiptsSince).
 */
export async function catalogueSentAt(
  db: SupabaseClient,
  q: { clientId: string; contactId: string; templateKey: string; exceptRequestId: string; sinceIso: string },
): Promise<string | null> {
  const rows = await findSentTemplateReceiptsSince(db, q.clientId, q.contactId, q.sinceIso)
  let latest: string | null = null
  for (const r of rows) {
    if (r.templateKey !== q.templateKey || r.requestId === q.exceptRequestId) continue
    if (latest === null || Date.parse(r.createdAt) > Date.parse(latest)) latest = r.createdAt
  }
  return latest
}

const ID_CHUNK = 100

/**
 * Of these guests, the ones who already have this catalogue template (sent, or outcome still unknown and not settled
 * as failed) since `sinceIso` — the same rule as the send's own gate, read in bulk for the lists. Throws on a read error.
 */
export async function guestsWithCatalogue(
  db: SupabaseClient,
  q: { clientId: string; templateKey: string; sinceIso: string; contactIds: readonly string[] },
): Promise<Set<string>> {
  type R = { id: string; contact_id: string; request_id: string; outcome: string; created_at: string }
  const rows: R[] = []
  for (let i = 0; i < q.contactIds.length; i += ID_CHUNK) {
    rows.push(...await fetchAll<R>((from, to) =>
      db.from('crm_email_send_receipts').select('id, contact_id, request_id, outcome, created_at')
        .eq('client_id', q.clientId).eq('template_key', q.templateKey).in('outcome', ['sent', 'unknown', 'failed'])
        .gte('created_at', q.sinceIso).in('contact_id', q.contactIds.slice(i, i + ID_CHUNK))
        .order('id', { ascending: true }).range(from, to)))
  }
  const failedAt = new Map<string, number>()
  for (const r of rows) {
    if (r.outcome !== 'failed') continue
    const at = Date.parse(r.created_at)
    if (Number.isFinite(at) && at > (failedAt.get(r.request_id) ?? -Infinity)) failedAt.set(r.request_id, at)
  }
  const out = new Set<string>()
  for (const r of rows) {
    if (r.outcome === 'failed') continue
    const settled = failedAt.get(r.request_id)
    const at = Date.parse(r.created_at)
    if (r.outcome === 'unknown' && settled !== undefined && Number.isFinite(at) && settled >= at) continue
    out.add(r.contact_id)
  }
  return out
}

export function createCatalogueDeps(clientId: string): CatalogueDeps {
  return {
    catalogueSentAt: (q) => catalogueSentAt(supabaseAdmin, q),
    loadSettings: (id) => loadEmailSettings(supabaseAdmin, id),
    loadTimeZone: (id) => loadClientTimeZone(supabaseAdmin, id),
    eligibility: createEligibilityData(supabaseAdmin),
    preview: (args) => previewTemplate(args, createPreviewData(clientId)),
    send: sendTemplateEmail,
    now: () => new Date(),
  }
}

/** The real data behind sendCatalogueEmail, scoped to one client. No mail channel here: sending is sendTemplateEmail's. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createPreviewData } from '@/lib/crm/email-templates/preview-prod'
import { sendTemplateEmail } from '@/lib/crm/email-templates/send-template-email'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
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

export function createCatalogueDeps(clientId: string): CatalogueDeps {
  return {
    loadSettings: (id) => loadEmailSettings(supabaseAdmin, id),
    loadTimeZone: (id) => loadClientTimeZone(supabaseAdmin, id),
    eligibility: createEligibilityData(supabaseAdmin),
    preview: (args) => previewTemplate(args, createPreviewData(clientId)),
    send: sendTemplateEmail,
    now: () => new Date(),
  }
}

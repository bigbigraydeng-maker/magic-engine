/**
 * Production wiring of the authorization commands: the authorization table, 127's template store and settings, the
 * rehearsal's shadow rows, the event sender and the clock. Read failures are passed on as failures, never as "none".
 * Design: docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §4.3 (plan: §17).
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { getCurrentTemplate } from '@/lib/crm/email-templates/template-store'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import type { CommandDeps, SalesCapRead, TemplateRead } from './authorization-commands'
import type { StatusDeps } from './authorization-status'
import {
  activateAuthorization,
  authorizeProposal,
  insertProposal,
  loadAuthorization,
  loadOpenAuthorizations,
  revokeAuthorization,
} from './authorization-store'
import { loadRehearsalEvidence } from './rehearsal-evidence'

async function readTemplate(db: SupabaseClient, clientId: string, key: string): Promise<TemplateRead> {
  try {
    return { ok: true, template: await getCurrentTemplate(db, clientId, key) }
  } catch {
    return { ok: false }
  }
}

async function readSalesCap(db: SupabaseClient, clientId: string): Promise<SalesCapRead> {
  try {
    const settings = await loadEmailSettings(db, clientId)
    // 'none' = the client still runs on the old settings (no versioned cap to compare); 'invalid' = unreadable.
    return settings.kind === 'ok' ? { kind: 'cap', cap: settings.settings.frequencyCap } : { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

export function createAuthorizationDeps(db: SupabaseClient): CommandDeps {
  const key = { triggerKey: 'welcome' as const, channel: 'email' as const }
  return {
    store: {
      loadOpen: (clientId) => loadOpenAuthorizations(db, { clientId, ...key }),
      load: (id) => loadAuthorization(db, id),
      insertProposal: (p) => insertProposal(db, p),
      revoke: (input) => revokeAuthorization(db, input),
      authorize: (input) => authorizeProposal(db, input),
      activate: (id) => activateAuthorization(db, id),
    },
    loadTemplate: (clientId, templateKey) => readTemplate(db, clientId, templateKey),
    loadSalesFrequencyCap: (clientId) => readSalesCap(db, clientId),
    loadRehearsal: (clientId, rule) => loadRehearsalEvidence(db, clientId, rule),
    emit: async (event) => {
      await sendInngestEvent(event)
    },
    // The same key `sendInngestEvent` reads; its value is never looked at here, only whether it is set.
    canEmit: () => (process.env.INNGEST_EVENT_KEY ?? '').trim().length > 0,
    now: () => new Date(),
    newRequestId: () => randomUUID(),
  }
}

export function createAuthorizationStatusDeps(db: SupabaseClient): StatusDeps {
  return { ...createAuthorizationDeps(db), env: (name) => process.env[name] }
}

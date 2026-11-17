/**
 * The real store for call-back requests (callback-request.ts). Token and "was the mail sent" checks are the click
 * tracker's own (one rule for both); the touch goes into contact_touchpoints with the same idempotency key every
 * touch writer uses (client_id, source, source_ref).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClickStore, type PriorSendLookup } from '../email-templates/link-tracking/click-store-prod'
import { loadPageLabelFacts } from '../email-templates/link-tracking/page-label-facts-prod'
import { classifyTourLink } from '../email-templates/facts/published-tours'
import { loadClientTimeZone } from '../email-templates/time-zone'
import { SOURCE, type CallbackStore, type CallbackTouchRow } from './callback-request'

export function createCallbackStore(db: SupabaseClient, mail: PriorSendLookup, now: () => Date = () => new Date()): CallbackStore {
  const clicks = createClickStore(db, mail)
  return {
    findToken: (token) => clicks.findToken(token),
    mailWasSent: (info) => clicks.mailWasSent(info),
    timeZone: (clientId) => loadClientTimeZone(db, clientId),
    async requestsSince(clientId, contactId, sinceIso) {
      const { count, error } = await db
        .from('contact_touchpoints')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .eq('contact_id', contactId)
        .eq('source', SOURCE)
        .gte('occurred_at', sinceIso)
      if (error) throw new Error(`contact_touchpoints: ${error.message}`)
      return count ?? 0
    },
    async tourNames(clientId, paths) {
      const names = new Map<string, string>()
      // A name is a nicety: if the published tours cannot be read, staff see the page path instead.
      const page = await loadPageLabelFacts(db, clientId, now()).catch(() => null)
      const host = page?.hosts[0] ?? null
      if (page === null || host === null) return names
      for (const path of paths) {
        const hit = classifyTourLink(`https://${host}${path}`, page.facts)
        if (hit?.kind === 'tour') names.set(path, hit.tour.name)
      }
      return names
    },
    async insertTouch(row: CallbackTouchRow) {
      const { data, error } = await db
        .from('contact_touchpoints')
        .upsert(row, { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(`contact_touchpoints insert: ${error.message}`)
      return ((data as unknown[] | null) ?? []).length > 0 ? 'inserted' : 'duplicate'
    },
  }
}

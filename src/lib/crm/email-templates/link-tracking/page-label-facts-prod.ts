/**
 * The client's tour address rule and published tours, for naming the pages a guest read (click-summary.ts) and the tour
 * a guest asked to be called about (site-actions/callback-request-prod.ts). The one link-tracking file that reads the
 * tour-catalog provider: registered in the email-template boundary test.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveFromSettings } from '../effective-config'
import { loadEmailSettings } from '../settings-store'
import { loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import type { PageLabelFacts } from './click-summary'

export async function loadPageLabelFacts(db: SupabaseClient, clientId: string, now: Date): Promise<PageLabelFacts> {
  const none: PageLabelFacts = { urlPattern: null, hosts: [], facts: null }
  const settings = await loadEmailSettings(db, clientId)
  if (settings.kind !== 'ok') return none
  const config = effectiveFromSettings(settings.settings, settings.version)
  const provider = config.providers.publishedTours ?? null
  const read = await loadPublishedTourFacts(db, clientId, now.toISOString().slice(0, 10))
  return {
    urlPattern: provider?.urlPattern ?? null,
    hosts: config.guardrails.allowedLinkHosts,
    facts: { tours: read.published ? read.tours : [], picks: [], settings: provider, linkHosts: config.guardrails.allowedLinkHosts },
  }
}

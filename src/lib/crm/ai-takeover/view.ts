/**
 * What the person drawer shows for the catalogue line: takeover state, "came back", and who the catalogue would go to.
 * Read-only. The pure part (takeoverView) is tested; loadTakeoverView wires the real reads.
 */

import { effectiveFromSettings } from '@/lib/crm/email-templates/effective-config'
import { loadEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { previewCompose, type ComposePreview } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { supabaseAdmin } from '@/lib/supabase'
import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import { takeoverView, toReengageTouchRow, type CameBack, type CameBackRow } from './came-back'
import { createTakeoverStore } from './prod'
import { takeoverState, type TakeoverState } from './state'

export interface CatalogueInfo {
  templateKey: string
  versionLabel: string
  validUntil: string
}

export interface TakeoverView {
  takeover: TakeoverState
  cameBack: CameBack | null
  catalogue: CatalogueInfo | null
  compose: ComposePreview
}

async function loadTouchesSince(clientId: string, contactId: string, since: string): Promise<ReengageTouch[]> {
  const { data, error } = await supabaseAdmin
    .from('contact_touchpoints')
    .select('channel, direction, occurred_at, summary, raw, metadata, source')
    .eq('client_id', clientId)
    .eq('contact_id', contactId)
    .eq('direction', 'inbound')
    .gt('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(200)
  if (error) throw new Error(`contact_touchpoints: ${error.message}`)
  return ((data as CameBackRow[] | null) ?? []).map(toReengageTouchRow)
}

async function loadCatalogue(clientId: string): Promise<CatalogueInfo | null> {
  const settings = await loadEmailSettings(supabaseAdmin, clientId)
  if (settings.kind !== 'ok') return null
  const c = effectiveFromSettings(settings.settings, settings.version).providers.catalogue
  return c === undefined ? null : { templateKey: c.templateKey, versionLabel: c.versionLabel, validUntil: c.validUntil }
}

/** Throws when something cannot be read; the route turns that into a plain "try again". */
export async function loadTakeoverView(clientId: string, contactId: string, now: Date): Promise<TakeoverView> {
  const events = await createTakeoverStore().loadEvents(clientId, contactId)
  const state = takeoverState(events)
  const touches = state.on ? await loadTouchesSince(clientId, contactId, state.since) : []
  const [catalogue, compose] = await Promise.all([
    loadCatalogue(clientId),
    previewCompose({ clientId, contactId }, createMailNewDeps(clientId)),
  ])
  return { ...takeoverView(events, touches, now), catalogue, compose }
}

/**
 * Tour catalog — access list, page settings, publish requests and assistant usage.
 * Data-access layer for tour_catalog_members, tour_catalog_settings,
 * tour_catalog_publish_requests and tour_catalog_assistant_usage (via RPCs).
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.10.1
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { asRecord, asString, rowsOf } from './store'
import type { CatalogMemberView, CatalogSettings, PublishRequestView } from './catalog-contract'

export const EMPTY_SETTINGS: CatalogSettings = {
  logoUrl: null,
  brandPrimary: null,
  brandSecondary: null,
  channelsConnected: false,
}

function normalizeEmail(value: unknown): string {
  return asString(value).trim().toLowerCase()
}

function asNullableString(value: unknown): string | null {
  const text = asString(value)
  return text === '' ? null : text
}

export async function listMemberEmails(db: SupabaseClient, clientId: string): Promise<Set<string>> {
  const res = await db.from('tour_catalog_members').select('email').eq('client_id', clientId)
  if (res.error) {
    throw new Error(res.error.message)
  }
  const emails = new Set<string>()
  for (const row of rowsOf(res.data)) {
    emails.add(normalizeEmail(asRecord(row).email))
  }
  return emails
}

export async function listMembers(db: SupabaseClient, clientId: string): Promise<CatalogMemberView[]> {
  const res = await db
    .from('tour_catalog_members')
    .select('email, granted_by, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (res.error) {
    throw new Error(res.error.message)
  }

  const loginRes = await db.from('client_portal_users').select('email').eq('client_id', clientId)
  let loginEmails = new Set<string>()
  if (loginRes.error) {
    console.error('tour_catalog_members_login_lookup_failed', loginRes.error.message)
  } else {
    loginEmails = new Set<string>()
    for (const row of rowsOf(loginRes.data)) {
      loginEmails.add(normalizeEmail(asRecord(row).email))
    }
  }

  return rowsOf(res.data).map((row) => {
    const record = asRecord(row)
    const email = normalizeEmail(record.email)
    return {
      email,
      grantedBy: asString(record.granted_by),
      createdAt: asString(record.created_at),
      hasLogin: loginEmails.has(email),
    }
  })
}

export async function addMember(
  db: SupabaseClient,
  clientId: string,
  email: string,
  grantedBy: string,
): Promise<void> {
  const res = await db
    .from('tour_catalog_members')
    .upsert(
      { client_id: clientId, email, granted_by: grantedBy },
      { onConflict: 'client_id,email', ignoreDuplicates: true },
    )
  if (res.error) {
    throw new Error(res.error.message)
  }
}

export async function removeMember(db: SupabaseClient, clientId: string, email: string): Promise<void> {
  const res = await db
    .from('tour_catalog_members')
    .delete()
    .eq('client_id', clientId)
    .eq('email', email)
  if (res.error) {
    throw new Error(res.error.message)
  }
}

export async function getSettings(db: SupabaseClient, clientId: string): Promise<CatalogSettings> {
  const res = await db
    .from('tour_catalog_settings')
    .select('logo_url, brand_primary, brand_secondary, channels_connected')
    .eq('client_id', clientId)
    .maybeSingle()
  if (res.error) {
    throw new Error(res.error.message)
  }
  if (res.data === null || res.data === undefined) {
    return { ...EMPTY_SETTINGS }
  }
  const row = asRecord(res.data)
  return {
    logoUrl: asNullableString(row.logo_url),
    brandPrimary: asNullableString(row.brand_primary),
    brandSecondary: asNullableString(row.brand_secondary),
    channelsConnected: row.channels_connected === true,
  }
}

export async function saveSettings(
  db: SupabaseClient,
  clientId: string,
  settings: CatalogSettings,
  actor: string,
): Promise<CatalogSettings> {
  const res = await db.from('tour_catalog_settings').upsert(
    {
      client_id: clientId,
      logo_url: settings.logoUrl,
      brand_primary: settings.brandPrimary,
      brand_secondary: settings.brandSecondary,
      channels_connected: settings.channelsConnected,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  )
  if (res.error) {
    throw new Error(res.error.message)
  }
  return getSettings(db, clientId)
}

function mapPublishRequestRow(row: Record<string, unknown>): PublishRequestView {
  const draftVersion = Number(row.draft_version)
  return {
    id: asString(row.id),
    requestedBy: asString(row.requested_by),
    note: asString(row.note),
    createdAt: asString(row.created_at),
    draftVersion: Number.isFinite(draftVersion) ? draftVersion : 0,
  }
}

export async function getPendingPublishRequest(
  db: SupabaseClient,
  clientId: string,
): Promise<PublishRequestView | null> {
  const res = await db
    .from('tour_catalog_publish_requests')
    .select('id, requested_by, note, created_at, draft_version')
    .eq('client_id', clientId)
    .is('handled_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (res.error) {
    throw new Error(res.error.message)
  }
  const rows = rowsOf(res.data)
  if (rows.length === 0) {
    return null
  }
  return mapPublishRequestRow(asRecord(rows[0]))
}

export async function upsertPublishRequest(
  db: SupabaseClient,
  clientId: string,
  requestedBy: string,
  draftVersion: number,
  note: string,
): Promise<PublishRequestView> {
  const pending = await getPendingPublishRequest(db, clientId)
  if (pending !== null) {
    const res = await db
      .from('tour_catalog_publish_requests')
      .update({
        requested_by: requestedBy,
        draft_version: draftVersion,
        note,
        created_at: new Date().toISOString(),
      })
      .eq('id', pending.id)
      .eq('client_id', clientId)
      .is('handled_at', null)
    if (res.error) {
      throw new Error(res.error.message)
    }
  } else {
    const res = await db.from('tour_catalog_publish_requests').insert({
      client_id: clientId,
      requested_by: requestedBy,
      draft_version: draftVersion,
      note,
    })
    if (res.error) {
      throw new Error(res.error.message)
    }
  }

  const saved = await getPendingPublishRequest(db, clientId)
  if (saved === null) {
    throw new Error('publish_request_not_saved')
  }
  return saved
}

export async function markPublishRequestsHandled(
  db: SupabaseClient,
  clientId: string,
  version: number,
): Promise<void> {
  const res = await db
    .from('tour_catalog_publish_requests')
    .update({ handled_at: new Date().toISOString(), handled_version: version })
    .eq('client_id', clientId)
    .is('handled_at', null)
  if (res.error) {
    throw new Error(res.error.message)
  }
}

export async function getClientName(db: SupabaseClient, clientId: string): Promise<string> {
  try {
    const res = await db.from('clients').select('name').eq('id', clientId).maybeSingle()
    if (res.error) {
      console.warn('tour_catalog_client_name_failed', res.error.message)
      return ''
    }
    if (res.data === null || res.data === undefined) {
      return ''
    }
    const name = asRecord(res.data).name
    return typeof name === 'string' ? name : ''
  } catch (err) {
    console.warn('tour_catalog_client_name_failed', err instanceof Error ? err.message : String(err))
    return ''
  }
}

export type AssistantReservation = 'ok' | 'limit' | 'error'

export interface AssistantLimits {
  userDaily: number
  clientDaily: number
  clientDailyCostUsd: number
}

export async function reserveAssistantCall(
  db: SupabaseClient,
  clientId: string,
  day: string,
  email: string,
  limits: AssistantLimits,
): Promise<AssistantReservation> {
  try {
    const res = await db.rpc('tour_catalog_assistant_reserve', {
      p_client_id: clientId,
      p_day: day,
      p_email: email,
      p_user_limit: limits.userDaily,
      p_client_limit: limits.clientDaily,
      p_cost_limit: limits.clientDailyCostUsd,
    })
    if (res.error) {
      console.error('tour_catalog_assistant_reserve_failed', res.error.message)
      return 'error'
    }
    return res.data === true ? 'ok' : 'limit'
  } catch (err) {
    console.error(
      'tour_catalog_assistant_reserve_failed',
      err instanceof Error ? err.message : String(err),
    )
    return 'error'
  }
}

export async function recordAssistantCost(
  db: SupabaseClient,
  clientId: string,
  day: string,
  email: string,
  costUsd: number,
): Promise<void> {
  try {
    const res = await db.rpc('tour_catalog_assistant_record_cost', {
      p_client_id: clientId,
      p_day: day,
      p_email: email,
      p_cost: Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0,
    })
    if (res.error) {
      console.error('tour_catalog_assistant_record_cost_failed', res.error.message)
    }
  } catch (err) {
    console.error(
      'tour_catalog_assistant_record_cost_failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}

export async function listChangeActorsSince(
  db: SupabaseClient,
  clientId: string,
  since: string | null,
  limit = 5000,
): Promise<string[]> {
  let query = db.from('tour_catalog_change_log').select('actor').eq('client_id', clientId)
  if (since !== null) {
    query = query.gt('created_at', since)
  }
  const res = await query.order('created_at', { ascending: false }).limit(limit)
  if (res.error) {
    throw new Error(res.error.message)
  }
  return rowsOf(res.data).map((row) => asString(asRecord(row).actor))
}

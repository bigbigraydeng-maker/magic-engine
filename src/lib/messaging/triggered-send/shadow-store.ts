import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ShadowRowInput {
  clientId: string
  authorizationId: string
  contactId: string
  status: 'shadow' | 'skipped'
  reasonCode: string | null
  annotations: Record<string, unknown>
  consentBasis: string | null
  sourceRef: string | null
  toAddressSha256: string | null
  localDay: string
}

const CHUNK_SIZE = 100
const MAX_REASON_CODE_LENGTH = 60
const MAX_TEXT_LENGTH = 200
const LOCAL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const UPSERT_ON_CONFLICT =
  'client_id,trigger_key,channel,contact_id,dedupe_scope'

interface ShadowRowColumns {
  client_id: string
  trigger_key: 'welcome'
  channel: 'email'
  contact_id: string
  dedupe_scope: 'shadow'
  status: 'shadow' | 'skipped'
  reason_code: string | null
  authorization_id: string
  to_address_sha256: string | null
  consent_basis: string | null
  source_ref: string | null
  annotations: Record<string, unknown>
  local_day: string
  provider_impact: 'NONE'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableText(value: unknown): boolean {
  if (value === null) {
    return true
  }
  return isNonEmptyString(value) && value.length <= MAX_TEXT_LENGTH
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

export function addressSha256(email: string): string {
  return createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex')
}

export function validateShadowRow(row: ShadowRowInput): string | null {
  if (!isNonEmptyString(row.clientId)) {
    return 'clientId must be a non-empty string'
  }
  if (!isNonEmptyString(row.authorizationId)) {
    return 'authorizationId must be a non-empty string'
  }
  if (!isNonEmptyString(row.contactId)) {
    return 'contactId must be a non-empty string'
  }

  if (row.status === 'shadow') {
    if (row.reasonCode !== null) {
      return 'reasonCode must be null when status is shadow'
    }
  } else if (row.status === 'skipped') {
    if (!isNonEmptyString(row.reasonCode)) {
      return 'reasonCode must be a non-empty string when status is skipped'
    }
    if (row.reasonCode.length > MAX_REASON_CODE_LENGTH) {
      return `reasonCode must be at most ${MAX_REASON_CODE_LENGTH} characters`
    }
  } else {
    return 'status must be shadow or skipped'
  }

  if (typeof row.localDay !== 'string' || !LOCAL_DAY_PATTERN.test(row.localDay)) {
    return 'localDay must match YYYY-MM-DD'
  }

  if (
    row.toAddressSha256 !== null &&
    (typeof row.toAddressSha256 !== 'string' ||
      !SHA256_HEX_PATTERN.test(row.toAddressSha256))
  ) {
    return 'toAddressSha256 must be null or 64 lower-case hex characters'
  }

  if (!isPlainObject(row.annotations)) {
    return 'annotations must be a plain object'
  }

  if (!isNullableText(row.consentBasis)) {
    return `consentBasis must be null or a non-empty string of at most ${MAX_TEXT_LENGTH} characters`
  }

  if (!isNullableText(row.sourceRef)) {
    return `sourceRef must be null or a non-empty string of at most ${MAX_TEXT_LENGTH} characters`
  }

  return null
}

export async function findContactsWithShadowRows(
  db: SupabaseClient,
  clientId: string,
  contactIds: readonly string[],
): Promise<{ ok: true; contactIds: Set<string> } | { ok: false; error: string }> {
  const found = new Set<string>()
  if (contactIds.length === 0) {
    return { ok: true, contactIds: found }
  }

  try {
    for (const ids of chunk(contactIds, CHUNK_SIZE)) {
      const { data, error } = await db
        .from('triggered_sends')
        .select('contact_id')
        .eq('client_id', clientId)
        .eq('trigger_key', 'welcome')
        .eq('channel', 'email')
        .eq('dedupe_scope', 'shadow')
        .in('contact_id', ids)

      if (error) {
        return { ok: false, error: error.message }
      }

      const rows = (data ?? []) as Array<{ contact_id: string }>
      for (const row of rows) {
        found.add(row.contact_id)
      }
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }

  return { ok: true, contactIds: found }
}

function toColumns(row: ShadowRowInput): ShadowRowColumns {
  return {
    client_id: row.clientId,
    trigger_key: 'welcome',
    channel: 'email',
    contact_id: row.contactId,
    dedupe_scope: 'shadow',
    status: row.status,
    reason_code: row.reasonCode,
    authorization_id: row.authorizationId,
    to_address_sha256: row.toAddressSha256,
    consent_basis: row.consentBasis,
    source_ref: row.sourceRef,
    annotations: row.annotations,
    local_day: row.localDay,
    provider_impact: 'NONE',
  }
}

export async function insertShadowRows(
  db: SupabaseClient,
  rows: readonly ShadowRowInput[],
): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  for (let index = 0; index < rows.length; index += 1) {
    const message = validateShadowRow(rows[index])
    if (message !== null) {
      return { ok: false, error: `row ${index}: ${message}` }
    }
  }

  if (rows.length === 0) {
    return { ok: true, inserted: 0 }
  }

  let inserted = 0
  try {
    for (const chunkRows of chunk(rows, CHUNK_SIZE)) {
      const { data, error } = await db
        .from('triggered_sends')
        .upsert(chunkRows.map(toColumns), {
          onConflict: UPSERT_ON_CONFLICT,
          ignoreDuplicates: true,
        })
        .select('id')

      if (error) {
        return { ok: false, error: error.message }
      }

      inserted += (data ?? []).length
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }

  return { ok: true, inserted }
}

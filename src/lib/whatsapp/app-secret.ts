import { supabaseAdmin } from '@/lib/supabase'
import { decryptToken } from '@/lib/platform-oauth/vocabulary'

export const MAX_WEBHOOK_BODY_BYTES = 5_000_000
export const MAX_WEBHOOK_PHONE_NUMBER_IDS = 20

export type ExtractedNumbers =
  | { ok: true; ids: string[] }
  | { ok: false; reason: 'malformed_number' | 'too_many_numbers' }

export type WebhookSecretChoice =
  | { kind: 'env' }
  | { kind: 'route'; secret: string }
  | { kind: 'lookup_failed'; tableMissing: boolean }
  | { kind: 'reject'; reason: 'mixed_apps' | 'decrypt_failed' | 'disabled_number' }

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,32}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectFromChange(
  change: unknown,
  seen: Set<string>,
  ids: string[],
): 'ok' | 'malformed_number' | 'too_many_numbers' {
  if (!isPlainObject(change)) return 'ok'
  const value = change.value
  if (!isPlainObject(value)) return 'ok'
  const metadata = value.metadata
  if (!isPlainObject(metadata)) return 'ok'
  if (!('phone_number_id' in metadata)) return 'ok'

  const raw = metadata.phone_number_id
  if (raw === undefined) return 'ok'
  if (typeof raw !== 'string' || !PHONE_NUMBER_ID_PATTERN.test(raw)) {
    return 'malformed_number'
  }
  if (!seen.has(raw)) {
    seen.add(raw)
    ids.push(raw)
    if (ids.length > MAX_WEBHOOK_PHONE_NUMBER_IDS) return 'too_many_numbers'
  }
  return 'ok'
}

export function extractWebhookPhoneNumberIds(rawBody: string): ExtractedNumbers {
  let root: unknown
  try {
    root = JSON.parse(rawBody)
  } catch {
    return { ok: true, ids: [] }
  }
  if (!isPlainObject(root)) return { ok: true, ids: [] }

  const entry = root.entry
  if (!Array.isArray(entry)) return { ok: true, ids: [] }

  const seen = new Set<string>()
  const ids: string[] = []

  for (const entryItem of entry) {
    if (!isPlainObject(entryItem)) continue
    const changes = entryItem.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const result = collectFromChange(change, seen, ids)
      if (result === 'malformed_number') {
        return { ok: false, reason: 'malformed_number' }
      }
      if (result === 'too_many_numbers') {
        return { ok: false, reason: 'too_many_numbers' }
      }
    }
  }

  return { ok: true, ids }
}

type CredentialRow = {
  phone_number_id: unknown
  app_secret_enc: unknown
  status?: unknown
}

/** Postgres undefined_table / PostgREST schema-cache miss: the table is not deployed yet. */
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205'])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export async function chooseWebhookSecret(
  ids: string[],
): Promise<WebhookSecretChoice> {
  if (ids.length === 0) return { kind: 'env' }

  let rows: CredentialRow[]
  try {
    const { data, error } = await supabaseAdmin
      .from('whatsapp_app_credentials')
      .select('phone_number_id, app_secret_enc, status')
      .in('phone_number_id', ids)

    if (error) {
      console.error('[whatsapp/app-secret] credential lookup failed')
      const code = (error as { code?: unknown }).code
      return { kind: 'lookup_failed', tableMissing: typeof code === 'string' && TABLE_MISSING_CODES.has(code) }
    }
    rows = Array.isArray(data) ? (data as CredentialRow[]) : []
  } catch {
    console.error('[whatsapp/app-secret] credential lookup failed')
    return { kind: 'lookup_failed', tableMissing: false }
  }

  // A disabled number must be refused, not quietly handed to the env secret.
  if (rows.some((row) => row.status === 'disabled')) {
    return { kind: 'reject', reason: 'disabled_number' }
  }

  const matched = new Set<string>()
  const ciphertexts: string[] = []
  for (const row of rows) {
    if (!isNonEmptyString(row.app_secret_enc)) continue
    if (!isNonEmptyString(row.phone_number_id)) continue
    matched.add(row.phone_number_id)
    ciphertexts.push(row.app_secret_enc)
  }

  if (matched.size === 0) return { kind: 'env' }
  if (matched.size < ids.length) return { kind: 'reject', reason: 'mixed_apps' }

  const secrets: string[] = []
  try {
    for (const ciphertext of ciphertexts) {
      const plain = decryptToken(ciphertext)
      // An empty secret would make HMAC verification trivially forgeable.
      if (!plain) throw new Error('empty secret')
      secrets.push(plain)
    }
  } catch {
    console.error('[whatsapp/app-secret] secret decrypt failed')
    return { kind: 'reject', reason: 'decrypt_failed' }
  }

  const distinct = new Set(secrets)
  if (distinct.size > 1) return { kind: 'reject', reason: 'mixed_apps' }

  const secret = secrets[0]
  if (secret === undefined) return { kind: 'env' }
  return { kind: 'route', secret }
}

/**
 * Phase 34 / P34.1 — MCP per-client API key auth.
 *
 * Parallel auth path to `requireDashboardClientAccess()` (session cookie).
 * MCP is machine-to-machine, can't carry cookies — clients present a
 * Bearer token (`me_live_<base62>`); we sha256 it and look up
 * `client_api_keys` to derive the locked `client_id`.
 *
 * Security invariants (design doc §6.1, §2 — outer layer of the two-layer
 * isolation model; inner layer = scoped-queries lives in P34.4):
 *   - Plaintext keys are NEVER stored. Only sha256(plaintext).
 *   - Plaintext is returned exactly once at creation.
 *   - `client_id` is derived from the key — never accepted as caller input.
 *   - Revoked keys are kept (soft delete) for audit; lookup filters them out.
 */
import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const KEY_PREFIX = 'me_live_'
const PREFIX_DISPLAY_LEN = 12

/**
 * Crockford-style base32 alphabet (no I/L/O/U to avoid OCR/typo confusion).
 * Plenty of entropy: 32 random bytes → ~51 chars → 160 bits.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeBase32(buf: Buffer): string {
  let out = ''
  for (const byte of buf) {
    out += ALPHABET[byte & 0x1f]
    out += ALPHABET[(byte >> 5) & 0x07]
  }
  return out.toLowerCase()
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export interface GeneratedKey {
  plaintext: string
  hash: string
  prefix: string
}

/** Generate a fresh API key. Plaintext must be persisted at the caller exactly once. */
export function generateApiKey(): GeneratedKey {
  const random = encodeBase32(randomBytes(32))
  const plaintext = `${KEY_PREFIX}${random}`
  return {
    plaintext,
    hash: sha256Hex(plaintext),
    prefix: plaintext.slice(0, PREFIX_DISPLAY_LEN),
  }
}

export interface ApiKeyAuth {
  keyId: string
  clientId: string
  scopes: string[]
}

export type ApiKeyAuthFailure =
  | 'missing'
  | 'malformed'
  | 'not_found_or_revoked'
  | 'lookup_error'

export type VerifyResult =
  | { ok: true; auth: ApiKeyAuth }
  | { ok: false; reason: ApiKeyAuthFailure }

/** Extract the Bearer token from an Authorization header. */
export function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : null
}

/**
 * Verify a plaintext API key. Returns the locked client_id on success.
 *
 * Side effects:
 *   - On success, fire-and-forget update of `last_used_at` (non-blocking).
 *   - Does NOT write to `mcp_access_log` — that's the caller's job (we don't
 *     know the tool name here; callers wrap with logMcpAccess after dispatch).
 */
export async function verifyApiKey(rawKey: string | null | undefined): Promise<VerifyResult> {
  if (!rawKey) return { ok: false, reason: 'missing' }
  if (!rawKey.startsWith(KEY_PREFIX)) return { ok: false, reason: 'malformed' }

  const hash = sha256Hex(rawKey)
  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .select('id, client_id, scopes, revoked_at')
    .eq('key_hash', hash)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) {
    console.error('[api-key-access] lookup failed:', error)
    return { ok: false, reason: 'lookup_error' }
  }
  if (!data) return { ok: false, reason: 'not_found_or_revoked' }

  void touchLastUsed(data.id)
  return {
    ok: true,
    auth: {
      keyId: data.id as string,
      clientId: data.client_id as string,
      scopes: (data.scopes as string[]) ?? ['read:all'],
    },
  }
}

async function touchLastUsed(keyId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('client_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyId)
  if (error) console.error('[api-key-access] touchLastUsed failed:', error)
}

/**
 * Append one row to mcp_access_log. Drives audit + rate-limit + future billing.
 * Fire-and-forget; never blocks the response.
 */
export function logMcpAccess(params: {
  keyId: string
  clientId: string
  tool: string
  ok: boolean
  errorCode?: string
}): void {
  void supabaseAdmin
    .from('mcp_access_log')
    .insert({
      key_id: params.keyId,
      client_id: params.clientId,
      tool: params.tool,
      ok: params.ok,
      error_code: params.errorCode ?? null,
    })
    .then(({ error }) => {
      if (error) console.error('[api-key-access] logMcpAccess failed:', error)
    })
}

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
 *
 * Timing: lookup is a hash-equality index query. There is NO usable timing
 * side-channel — sha256 is one-way, so DB B-tree timing cannot be reverted to
 * plaintext (one char change avalanches the whole hash). Hence we deliberately
 * do NOT use crypto.timingSafeEqual; it would add complexity for no gain.
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

  // Fire-and-forget; .catch covers the case where the supabase builder
  // rejects (network / fetch abort) rather than resolving with { error }.
  void touchLastUsed(data.id).catch((e) =>
    console.error('[api-key-access] touchLastUsed rejected:', e),
  )
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
    // Second arg / .catch covers a rejected builder (network / fetch abort);
    // without it this fire-and-forget would be an unhandled rejection.
    .catch((e) => console.error('[api-key-access] logMcpAccess rejected:', e))
}

/**
 * The locked MCP context for a request: the ME client_id (NOT OAuth clientId)
 * and the issuing key id, both stashed in AuthInfo.extra by the route's
 * withMcpAuth verifyToken callback.
 */
export interface McpContext {
  meClientId: string
  keyId: string
}

/**
 * Extract the locked MCP context from an MCP tool callback's authInfo.
 *
 * SECURITY (魏征 review): tools MUST call this instead of reading
 * `authInfo.extra.meClientId` ad hoc. If the context is missing it THROWS —
 * never silently continues — so a real client-data tool (P34.4) can never
 * run a query without a client_id and leak across tenants. The `me_ping`
 * stub's "skip logging if extra missing" pattern must NOT be copied into
 * data tools; this guard is the single chokepoint that enforces it.
 *
 * @param authInfo - the `authInfo` passed to an MCP tool callback by mcp-handler
 */
export function requireMeClientId(authInfo: unknown): McpContext {
  const extra = (authInfo as { extra?: Record<string, unknown> } | undefined)?.extra
  const meClientId = extra?.meClientId
  const keyId = extra?.keyId
  if (typeof meClientId !== 'string' || meClientId.length === 0) {
    throw new Error('MCP auth context missing meClientId — refusing to run tool')
  }
  if (typeof keyId !== 'string' || keyId.length === 0) {
    throw new Error('MCP auth context missing keyId — refusing to run tool')
  }
  return { meClientId, keyId }
}

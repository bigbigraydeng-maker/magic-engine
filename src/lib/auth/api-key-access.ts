/**
 * Phase 34 — MCP API key auth.
 *
 * Two key kinds, physically separated (子牙 P3 架构 + 魏征 2 审):
 *   - client key  `me_live_<base32>`  → client_api_keys, locked to one client_id
 *   - admin  key  `me_admin_<base32>` → admin_api_keys, cross-client (FDE only)
 *
 * Security invariants:
 *   - Plaintext keys NEVER stored. Only sha256(plaintext).
 *   - `verifyApiKey` forks by prefix (XOR assertion). A caller can pass
 *     expectedKind so a wrong-kind key at the wrong endpoint is rejected
 *     (`wrong_endpoint`) — defence-in-depth beyond the endpoint-layer check [Z1].
 *   - admin keys: env kill-switch [R3 L2] + DB kill-switch via
 *     api_key_settings.admin_revoke_all_before [R3 L1] + forced expiry [Y2] +
 *     optional IP allowlist [Y1].
 *   - client path behaviour is unchanged from P34.1 (no kill-switch / IP — keeps
 *     the live client surface stable; client kill-switch field reserved).
 */
import { createHash, randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

export const KEY_PREFIX_CLIENT = 'me_live_'
export const KEY_PREFIX_ADMIN = 'me_admin_'
/** @deprecated use KEY_PREFIX_CLIENT — kept for back-compat with existing imports/tests */
export const KEY_PREFIX = KEY_PREFIX_CLIENT
const PREFIX_DISPLAY_LEN = 12

// Crockford-style base32 (no I/L/O/U). 32 random bytes → ~160 bits.
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

function generate(prefix: string): GeneratedKey {
  const plaintext = `${prefix}${encodeBase32(randomBytes(32))}`
  return { plaintext, hash: sha256Hex(plaintext), prefix: plaintext.slice(0, PREFIX_DISPLAY_LEN) }
}

/** Generate a client key (`me_live_…`). Plaintext persisted by caller exactly once. */
export function generateApiKey(): GeneratedKey {
  return generate(KEY_PREFIX_CLIENT)
}

/** Generate an admin key (`me_admin_…`). Cross-client; persisted exactly once. */
export function generateAdminApiKey(): GeneratedKey {
  return generate(KEY_PREFIX_ADMIN)
}

export type KeyKind = 'client' | 'admin'

export type ApiKeyAuth =
  | { kind: 'client'; keyId: string; clientId: string; scopes: string[] }
  | { kind: 'admin'; keyId: string; ownerEmail: string; scopes: string[]; ipAllowlist: string[] }

export type ApiKeyAuthFailure =
  | 'missing'
  | 'malformed'
  | 'not_found_or_revoked'
  | 'lookup_error'
  | 'kill_switched'
  | 'expired'
  | 'ip_blocked'
  | 'wrong_endpoint'

export type VerifyResult =
  | { ok: true; auth: ApiKeyAuth }
  | { ok: false; reason: ApiKeyAuthFailure }

export interface VerifyOpts {
  /** Source IP (first X-Forwarded-For segment) — used for admin IP allowlist + audit. */
  sourceIp?: string
  /** The kind this endpoint expects; mismatch → wrong_endpoint (Z1). */
  expectedKind?: KeyKind
}

/** Extract the Bearer token from an Authorization header. */
export function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  return m ? m[1].trim() : null
}

// ── IPv4 CIDR matching (IPv6 falls back to exact string match) ──────────────
function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const o = Number(p)
    if (!Number.isInteger(o) || o < 0 || o > 255) return null
    n = (n << 8) | o
  }
  return n >>> 0
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  const ipInt = ipv4ToInt(ip)
  const rangeInt = ipv4ToInt(range)
  if (ipInt === null || rangeInt === null) {
    return ip.trim() === range.trim() // non-IPv4 → exact match (covers IPv6 literals)
  }
  const bits = bitsStr === undefined ? 32 : Number(bitsStr)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (rangeInt & mask)
}

export function ipInCidrList(ip: string, list: string[]): boolean {
  return list.some((c) => ipInCidr(ip, c))
}

// ── lookup ──────────────────────────────────────────────────────────────────
interface LookupRow {
  keyId: string
  clientId: string | null
  ownerEmail: string | null
  scopes: string[]
  ipAllowlist: string[]
}

/**
 * R1: the ONLY place that queries a key table. Takes an explicit `kind` and
 * queries exactly one table — never a UNION / wildcard. This prevents a future
 * refactor from accidentally cross-matching an admin key against client_api_keys.
 */
async function lookupByKind(kind: KeyKind, hash: string): Promise<LookupRow | null | 'error'> {
  if (kind === 'client') {
    const { data, error } = await supabaseAdmin
      .from('client_api_keys')
      .select('id, client_id, scopes')
      .eq('key_hash', hash)
      .is('revoked_at', null)
      .maybeSingle()
    if (error) {
      console.error('[api-key-access] client lookup failed:', error)
      return 'error'
    }
    if (!data) return null
    return {
      keyId: data.id as string,
      clientId: data.client_id as string,
      ownerEmail: null,
      scopes: (data.scopes as string[]) ?? ['read:all'],
      ipAllowlist: [],
    }
  }

  // admin: filter expired at SQL layer (Y2 — app forgetting to check = 0 rows)
  const { data, error } = await supabaseAdmin
    .from('admin_api_keys')
    .select('id, owner_email, scopes, ip_allowlist, created_at')
    .eq('key_hash', hash)
    .is('revoked_at', null)
    .gte('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error) {
    console.error('[api-key-access] admin lookup failed:', error)
    return 'error'
  }
  if (!data) return null

  // R3 layer 1: DB kill-switch — any admin key created before
  // admin_revoke_all_before is treated as revoked, no per-row update needed.
  const { data: settings } = await supabaseAdmin
    .from('api_key_settings')
    .select('admin_revoke_all_before')
    .eq('id', 1)
    .maybeSingle()
  if (
    settings?.admin_revoke_all_before &&
    new Date(data.created_at as string) < new Date(settings.admin_revoke_all_before as string)
  ) {
    return null
  }

  return {
    keyId: data.id as string,
    clientId: null,
    ownerEmail: data.owner_email as string,
    scopes: (data.scopes as string[]) ?? ['admin:read:all'],
    ipAllowlist: (data.ip_allowlist as string[]) ?? [],
  }
}

/**
 * Verify a plaintext API key. Forks by prefix (XOR), enforces expectedKind,
 * kill-switch, expiry (SQL layer), and admin IP allowlist.
 *
 * Timing: hash-equality index lookup; sha256 is one-way so no plaintext-
 * recoverable timing side-channel. crypto.timingSafeEqual intentionally unused.
 */
export async function verifyApiKey(
  rawKey: string | null | undefined,
  opts: VerifyOpts = {},
): Promise<VerifyResult> {
  if (!rawKey) return { ok: false, reason: 'missing' }

  const isClient = rawKey.startsWith(KEY_PREFIX_CLIENT)
  const isAdmin = rawKey.startsWith(KEY_PREFIX_ADMIN)
  if (isClient === isAdmin) return { ok: false, reason: 'malformed' } // XOR: exactly one prefix
  const kind: KeyKind = isAdmin ? 'admin' : 'client'

  // Z1: wrong endpoint for this key kind.
  if (opts.expectedKind && opts.expectedKind !== kind) {
    return { ok: false, reason: 'wrong_endpoint' }
  }

  // R3 layer 2: env kill-switch (admin only) — works even when DB unreachable.
  if (kind === 'admin' && process.env.ADMIN_KEY_KILL_SWITCH === 'true') {
    return { ok: false, reason: 'kill_switched' }
  }

  const found = await lookupByKind(kind, sha256Hex(rawKey))
  if (found === 'error') return { ok: false, reason: 'lookup_error' }
  if (!found) return { ok: false, reason: 'not_found_or_revoked' }

  // Y1: admin IP allowlist (empty = unrestricted, soft-launch).
  if (kind === 'admin' && found.ipAllowlist.length > 0) {
    if (!opts.sourceIp || !ipInCidrList(opts.sourceIp, found.ipAllowlist)) {
      return { ok: false, reason: 'ip_blocked' }
    }
  }

  void touchLastUsed(kind, found.keyId, opts.sourceIp).catch((e) =>
    console.error('[api-key-access] touchLastUsed rejected:', e),
  )

  if (kind === 'client') {
    return {
      ok: true,
      auth: { kind: 'client', keyId: found.keyId, clientId: found.clientId as string, scopes: found.scopes },
    }
  }
  return {
    ok: true,
    auth: {
      kind: 'admin',
      keyId: found.keyId,
      ownerEmail: found.ownerEmail as string,
      scopes: found.scopes,
      ipAllowlist: found.ipAllowlist,
    },
  }
}

async function touchLastUsed(kind: KeyKind, keyId: string, ip?: string): Promise<void> {
  const table = kind === 'admin' ? 'admin_api_keys' : 'client_api_keys'
  const patch: Record<string, unknown> = { last_used_at: new Date().toISOString() }
  if (kind === 'admin' && ip) patch.last_used_ip = ip // only admin table has last_used_ip
  const { error } = await supabaseAdmin.from(table).update(patch).eq('id', keyId)
  if (error) console.error('[api-key-access] touchLastUsed failed:', error)
}

/**
 * Append one row to mcp_access_log (audit / rate-limit / billing source).
 * Writes client_key_id OR admin_key_id per kind (R2 双 FK CHECK). Fire-and-forget.
 */
export function logMcpAccess(params: {
  kind?: KeyKind // default 'client' (back-compat with existing client callers)
  keyId: string
  clientId?: string | null
  tool: string
  ok: boolean
  errorCode?: string
  sourceIp?: string
}): void {
  const kind = params.kind ?? 'client'
  const row: Record<string, unknown> = {
    key_kind: kind,
    client_id: params.clientId ?? null,
    tool: params.tool,
    ok: params.ok,
    error_code: params.errorCode ?? null,
    source_ip: params.sourceIp ?? null,
  }
  if (kind === 'admin') row.admin_key_id = params.keyId
  else row.client_key_id = params.keyId

  void supabaseAdmin
    .from('mcp_access_log')
    .insert(row)
    .then(({ error }) => {
      if (error) console.error('[api-key-access] logMcpAccess failed:', error)
    })
    .catch((e) => console.error('[api-key-access] logMcpAccess rejected:', e))
}

// ── tool-callback context guards (physically separate per kind) ─────────────

export interface McpContext {
  meClientId: string
  keyId: string
}

/**
 * Client tools MUST call this. Throws if the locked client context is missing
 * (e.g. an admin authInfo, which has no meClientId) — never silently continues.
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

export interface AdminContext {
  adminKeyId: string
  ownerEmail: string
  scopes: string[]
}

/**
 * Admin tools MUST call this. Throws unless extra.kind === 'admin' — so a
 * client authInfo can never reach an admin tool (and vice-versa via
 * requireMeClientId). The two guards are the inner chokepoints mirroring the
 * outer prefix-fork + endpoint split.
 */
export function requireAdminContext(authInfo: unknown): AdminContext {
  const extra = (authInfo as { extra?: Record<string, unknown> } | undefined)?.extra
  if (!extra || extra.kind !== 'admin') {
    throw new Error('MCP admin context required — refusing to run admin tool')
  }
  const adminKeyId = extra.adminKeyId
  const ownerEmail = extra.ownerEmail
  if (typeof adminKeyId !== 'string' || adminKeyId.length === 0) {
    throw new Error('MCP admin context missing adminKeyId — refusing to run admin tool')
  }
  if (typeof ownerEmail !== 'string' || ownerEmail.length === 0) {
    throw new Error('MCP admin context missing ownerEmail — refusing to run admin tool')
  }
  return { adminKeyId, ownerEmail, scopes: (extra.scopes as string[]) ?? [] }
}

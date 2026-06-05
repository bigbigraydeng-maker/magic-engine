/**
 * MCP API keys — list + issue (Phase 34 / P34.2).
 *
 * GET  → list this client's keys. NEVER returns key_hash or plaintext;
 *        select columns are an explicit allowlist (no `select('*')`).
 *        Revoked keys are kept and returned (UI greys them out) — audit trail.
 * POST → issue a fresh key for this client. The plaintext is returned
 *        EXACTLY ONCE in this response; only sha256(plaintext) is persisted.
 *        Body: { name: string } (1..80 chars after trim + control-char strip).
 *
 * Auth: requireDashboardClientAccess (browser session) + admin-only role
 * check (魏征 Y6: client-viewer must NOT issue/revoke/list — MVP is FDE-
 * issued only per design doc §3.4, client self-serve deferred to V2).
 * Plus an Origin/Referer check on writes (魏征 R2: CSRF defence in depth).
 * MCP Bearer tokens cannot reach this endpoint — they're only honored by
 * /api/mcp/*.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { generateApiKey } from '@/lib/auth/api-key-access'

const MAX_NAME_LEN = 80

// Allowlist of columns safe to expose to the FDE/dashboard UI.
// key_hash and (obviously) plaintext are NEVER in here. Adding `*` or
// `key_hash` would be the only way to leak the hash — keep this explicit.
const KEY_LIST_COLUMNS =
  'id, name, key_prefix, scopes, last_used_at, revoked_at, created_at, created_by_email'

interface PostBody {
  name?: unknown
}

/**
 * Same-origin check for state-changing requests. Blocks classic cross-site
 * form-POST / fetch from third-party pages where a credentialed FDE session
 * cookie could otherwise drive a silent key issue/revoke.
 */
function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false  // server-side / same-origin GETs commonly omit Origin
  try {
    // Use req.url (Request property) not req.nextUrl so this works in unit
    // tests that pass a plain Request as well as in production NextRequest.
    return new URL(origin).host !== new URL(req.url).host
  } catch {
    return true
  }
}

/**
 * Strip any Unicode control / format / zero-width chars (category C) so a
 * name like "GBP​​测试" can't visually impersonate "GBP测试"
 * and trick the FDE into revoking the wrong key (魏征 Y3).
 */
function sanitiseName(input: string): string {
  return input.replace(/\p{C}/gu, '').trim()
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  // Admin-only (魏征 Y6). Even GET — listing keys reveals prefixes and audit
  // metadata that the client end-user should not see in the FDE Dashboard.
  if (access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .select(KEY_LIST_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[api-keys] GET failed:', error)
    return NextResponse.json(
      { error: 'Failed to load API keys' },
      { status: 500 },
    )
  }

  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  }
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
  }

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const cleanedName = typeof body.name === 'string' ? sanitiseName(body.name) : ''
  if (cleanedName.length === 0) {
    return NextResponse.json(
      { error: 'name is required (1..80 chars, no control characters)', code: 'INVALID_NAME' },
      { status: 400 },
    )
  }
  if (cleanedName.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `name too long (max ${MAX_NAME_LEN} chars)`, code: 'INVALID_NAME' },
      { status: 400 },
    )
  }

  const fresh = generateApiKey()

  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .insert({
      client_id: clientId,
      key_hash: fresh.hash,
      key_prefix: fresh.prefix,
      name: cleanedName,
      // scopes column has DB default ['read:all']; omitted intentionally.
      created_by_email: access.user.email ?? null,
    })
    // Explicit column list — never `*`. If DB ever returns key_hash here, the
    // response builder below would still pick fields by name, but defence in
    // depth: don't even let the hash into `data`.
    .select('id, name, key_prefix, scopes, created_at')
    .single()

  if (error || !data) {
    // NEVER echo the supabase error message — it can include hashes / row
    // fragments depending on the failure mode (魏征 Y2).
    console.error('[api-keys] POST insert failed:', error)
    return NextResponse.json(
      { error: 'Failed to issue API key' },
      { status: 500 },
    )
  }

  // ⚠️ This is the ONLY place plaintext is ever returned. Client UI must
  // show it once and never persist it. After this response there is no way
  // to recover plaintext from key_hash.
  return NextResponse.json({
    success: true,
    key: {
      id: data.id,
      name: data.name,
      key_prefix: data.key_prefix,
      scopes: data.scopes,
      created_at: data.created_at,
      plaintext: fresh.plaintext,
    },
  })
}

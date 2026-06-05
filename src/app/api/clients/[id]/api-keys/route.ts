/**
 * MCP API keys — list + issue (Phase 34 / P34.2).
 *
 * GET  → list this client's keys. NEVER returns key_hash or plaintext;
 *        select columns are an explicit allowlist (no `select('*')`).
 *        Revoked keys are kept and returned (UI greys them out) — audit trail.
 * POST → issue a fresh key for this client. The plaintext is returned
 *        EXACTLY ONCE in this response; only sha256(plaintext) is persisted.
 *        Body: { name: string } (1..80 chars after trim).
 *
 * Auth: requireDashboardClientAccess (browser session). MCP Bearer tokens
 * cannot reach this endpoint — they're only honored by /api/mcp/*.
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .select(KEY_LIST_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: `Failed to load API keys: ${error.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawName = typeof body.name === 'string' ? body.name.trim() : ''
  if (rawName.length === 0) {
    return NextResponse.json(
      { error: 'name is required (1..80 chars)', code: 'INVALID_NAME' },
      { status: 400 },
    )
  }
  if (rawName.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: `name too long (max ${MAX_NAME_LEN} chars)`, code: 'INVALID_NAME' },
      { status: 400 },
    )
  }

  const fresh = generateApiKey()
  const createdByEmail = access.user.email ?? null

  const { data, error } = await supabaseAdmin
    .from('client_api_keys')
    .insert({
      client_id: clientId,
      key_hash: fresh.hash,
      key_prefix: fresh.prefix,
      name: rawName,
      // scopes column has DB default ['read:all']; omitted intentionally.
      created_by_email: createdByEmail,
    })
    .select('id, name, key_prefix, scopes, created_at')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: `Failed to issue API key: ${error?.message ?? 'unknown'}` },
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

/**
 * Admin MCP keys — list + issue (Phase 34 / P34-P3.7).
 *
 * GET  → list all admin keys (never key_hash). Includes expiry + last_used.
 * POST → issue a new admin key. Plaintext returned EXACTLY ONCE.
 *        Body: { name, expires_days?: 30|60|90|180, ip_allowlist?: string[] }.
 *        Default expiry 90 days. ip_allowlist empty allowed at MVP (UI red
 *        warning + SOP 24h). Z2: first issuance gated by web-side confirm
 *        dialog (no colleague code yet — table reserved).
 *
 * Auth: requireAdmin (session, admin role) — NOT MCP keys. Separate surface
 * from /api/mcp-admin (which is the runtime admin MCP endpoint).
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdmin } from '@/lib/auth/require-admin'
import { generateAdminApiKey } from '@/lib/auth/api-key-access'

const MAX_NAME_LEN = 80
const ALLOWED_EXPIRY_DAYS = [30, 60, 90, 180] as const
const DEFAULT_EXPIRY_DAYS = 90

const ADMIN_KEY_COLUMNS =
  'id, name, key_prefix, owner_email, scopes, ip_allowlist, expires_at, ' +
  'last_used_at, last_used_ip, created_by_email, revoked_at, revoked_reason, created_at'

function isCrossOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {
    const forwardedHost = req.headers.get('x-forwarded-host')
    const selfHost = forwardedHost ?? new URL(req.url).host
    return new URL(origin).host !== selfHost
  } catch {
    return true
  }
}

function sanitiseName(input: string): string {
  return input.replace(/\p{C}/gu, '').trim()
}

export async function GET() {
  const access = await requireAdmin()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const { data, error } = await supabaseAdmin
    .from('admin_api_keys')
    .select(ADMIN_KEY_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin-mcp-keys] GET failed:', error)
    return NextResponse.json({ error: 'Failed to load admin keys' }, { status: 500 })
  }
  return NextResponse.json({ keys: data ?? [] })
}

interface PostBody {
  name?: unknown
  owner_email?: unknown
  expires_days?: unknown
  ip_allowlist?: unknown
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })
  }
  const access = await requireAdmin()
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? sanitiseName(body.name) : ''
  if (name.length === 0 || name.length > MAX_NAME_LEN) {
    return NextResponse.json(
      { error: 'name is required (1..80 chars, no control characters)', code: 'INVALID_NAME' },
      { status: 400 },
    )
  }

  // owner defaults to the issuing admin (first key = PM self-issue)
  const ownerEmail =
    typeof body.owner_email === 'string' && body.owner_email.includes('@')
      ? body.owner_email.toLowerCase().trim()
      : (access.user.email ?? '')
  if (!ownerEmail) {
    return NextResponse.json({ error: 'owner_email required', code: 'INVALID_OWNER' }, { status: 400 })
  }

  const expiresDays = ALLOWED_EXPIRY_DAYS.includes(body.expires_days as never)
    ? (body.expires_days as number)
    : DEFAULT_EXPIRY_DAYS
  const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()

  // ip_allowlist: array of CIDR strings; empty allowed (soft-launch).
  const ipAllowlist = Array.isArray(body.ip_allowlist)
    ? body.ip_allowlist.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : []

  const sourceIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const fresh = generateAdminApiKey()

  const { data, error } = await supabaseAdmin
    .from('admin_api_keys')
    .insert({
      key_hash: fresh.hash,
      key_prefix: fresh.prefix,
      name,
      owner_email: ownerEmail,
      ip_allowlist: ipAllowlist,
      expires_at: expiresAt,
      created_by_email: access.user.email ?? null,
      created_by_ip: sourceIp,
    })
    .select('id, name, key_prefix, owner_email, scopes, ip_allowlist, expires_at, created_at')
    .single()

  if (error || !data) {
    console.error('[admin-mcp-keys] POST insert failed:', error)
    return NextResponse.json({ error: 'Failed to issue admin key' }, { status: 500 })
  }

  // ⚠️ ONLY place plaintext is ever returned.
  return NextResponse.json({
    success: true,
    ip_allowlist_empty: ipAllowlist.length === 0,
    key: { ...data, plaintext: fresh.plaintext },
  })
}

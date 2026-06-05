/**
 * GET /api/mtc/ledger?clientId=<uuid>&page=<number>
 *
 * Returns paginated MTC ledger rows for a client.
 *
 * Auth (either satisfies):
 *   - Portal user: client_portal_users table has (email, clientId) record
 *   - Admin:       guardAdmin() returns null (whitelist pass)
 *
 * Reference: ROADMAP.md [P-MTC.3]
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/require-session'
import { guardAdmin } from '@/lib/auth/require-admin'
import { ACCESS_TYPES_DASHBOARD } from '@/lib/auth/access-types'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

// ─── Types ────────────────────────────────────────────────────────────────────

type LedgerRow = {
  id: string
  direction: 'debit' | 'credit'
  service_key: string
  mtc_amount: number
  source: string
  notes: string | null
  created_at: string
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId')
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  const pageParam = request.nextUrl.searchParams.get('page')
  const raw = parseInt(pageParam ?? '0', 10)
  const page = Number.isFinite(raw) && raw >= 0 ? raw : 0

  // ── Auth: session required for both paths ──────────────────────────────────

  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  // ── Try portal user access first ──────────────────────────────────────────

  const email = (session.user.email ?? '').toLowerCase()

  const { data: portalRows, error: portalErr } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('email', email)
    .eq('client_id', clientId)
    .in('access_type', ACCESS_TYPES_DASHBOARD as readonly string[] as string[])

  if (portalErr) {
    console.error('[mtc/ledger] portal user lookup failed:', portalErr)
    return NextResponse.json({ error: 'Authorization check failed' }, { status: 500 })
  }

  const isPortalUser = Array.isArray(portalRows) && portalRows.length > 0

  // ── Fall back to admin check ───────────────────────────────────────────────

  if (!isPortalUser) {
    const adminGuard = await guardAdmin()
    if (adminGuard !== null) {
      // Neither portal user nor admin — deny
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // ── Fetch ledger rows ──────────────────────────────────────────────────────

  const from = page * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1

  const { data, error, count } = await supabaseAdmin
    .from('mtc_ledger')
    .select('id, direction, service_key, mtc_amount, source, notes, created_at', {
      count: 'exact',
    })
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    console.error('[mtc/ledger]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as LedgerRow[]

  return NextResponse.json({
    rows,
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  })
}

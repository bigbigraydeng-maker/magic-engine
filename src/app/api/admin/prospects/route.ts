/**
 * GET /api/admin/prospects?status=&page=&limit=
 *
 * Admin-only. Returns paginated list of public_scan_jobs.
 * Intentionally excludes the `result` and `progress_log` fields (can be ~50KB each).
 * Use /api/admin/prospects/[id] to fetch the full detail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

const PAGE_SIZE = 30
const VALID_STATUSES = ['queued', 'running', 'completed', 'failed']

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const params  = req.nextUrl.searchParams
  const status  = params.get('status') ?? ''
  const page    = Math.max(1, parseInt(params.get('page') ?? '1', 10))
  const limit   = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? String(PAGE_SIZE), 10)))
  const offset  = (page - 1) * limit

  let query = supabaseAdmin
    .from('public_scan_jobs')
    .select('id, url, domain, email, name, status, created_at, completed_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && VALID_STATUSES.includes(status)) {
    query = query.eq('status', status)
  }

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    prospects: data ?? [],
    total: count ?? 0,
    page,
    limit,
  })
}

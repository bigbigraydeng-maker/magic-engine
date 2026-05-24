/**
 * GET /api/admin/prospects/[id]
 *
 * Admin-only. Returns full scan job detail including result + progress_log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const { id } = params
  if (!id) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, url, domain, email, name, status, result, progress_log, created_at, completed_at, error')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  return NextResponse.json({ prospect: data })
}

/**
 * POST /api/clients/[id]/production/[packageId]/schedule
 *
 * P21.10 — Batch-schedule content posts in a production package.
 *
 * Body:
 *   assignments  { post_id: string; scheduled_at: string }[]  — ISO 8601 UTC
 *   approve      boolean  — if true, also flip package status → 'approved' (default false)
 *
 * Returns:
 *   { success, scheduled: number, failed: number, packageStatus }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

type RouteContext = { params: { id: string; packageId: string } }

interface Assignment {
  post_id: string
  scheduled_at: string
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, packageId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: { assignments?: unknown; approve?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
    return NextResponse.json({ success: false, error: 'assignments must be a non-empty array' }, { status: 400 })
  }

  const assignments = (body.assignments as unknown[]).filter(
    (a): a is Assignment =>
      typeof a === 'object' && a !== null &&
      typeof (a as Assignment).post_id === 'string' &&
      typeof (a as Assignment).scheduled_at === 'string'
  )

  if (assignments.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid assignments provided' }, { status: 400 })
  }

  // Verify the package belongs to this client
  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from('production_packages')
    .select('id, status')
    .eq('id', packageId)
    .eq('client_id', clientId)
    .single()

  if (pkgErr || !pkg) {
    return NextResponse.json({ success: false, error: 'Production package not found' }, { status: 404 })
  }

  // Batch-update content_posts.scheduled_at + status → 'approved'
  let scheduled = 0
  let failed = 0

  await Promise.all(
    assignments.map(async ({ post_id, scheduled_at }) => {
      const { error } = await supabaseAdmin
        .from('content_posts')
        .update({ scheduled_at, status: 'approved' })
        .eq('id', post_id)
        .eq('client_id', clientId)

      if (error) {
        console.error(`[production/schedule] failed to schedule post ${post_id}:`, error.message)
        failed++
      } else {
        scheduled++
      }
    })
  )

  // Optionally flip package to 'approved' (enables downstream publish workflow)
  let packageStatus = pkg.status as string
  const shouldApprove = body.approve === true
  if (shouldApprove && scheduled > 0 && pkg.status !== 'approved') {
    const { data: updated } = await supabaseAdmin
      .from('production_packages')
      .update({ status: 'approved' })
      .eq('id', packageId)
      .select('status')
      .single()
    if (updated) packageStatus = updated.status
  }

  return NextResponse.json({
    success: scheduled > 0,
    scheduled,
    failed,
    packageStatus,
  }, { status: scheduled > 0 ? 200 : 500 })
}

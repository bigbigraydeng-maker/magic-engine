import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { clampLimit } from '@/lib/validation-utils'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

type RouteContext = { params: { id: string } }

interface ProductionPackageListRow {
  id: string
  [key: string]: unknown
}

const VALID_DIMENSIONS = ['seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor'] as const
type DiagnosticDimension = typeof VALID_DIMENSIONS[number]

/**
 * GET /api/clients/[id]/production
 *
 * Returns all production packages for a client, newest first.
 * Each package includes an `item_count` derived from production_items.
 *
 * Query params:
 *   dimension  — filter by diagnostic_dimension
 *   status     — filter by package status
 *   limit      — max rows (default 50, max 100)
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { searchParams } = req.nextUrl
    const dimension = searchParams.get('dimension')
    const status    = searchParams.get('status')
    const limit     = clampLimit(searchParams.get('limit'))

    let query = supabaseAdmin
      .from('production_packages')
      .select(
        'id, dimension, title, brief, status, campaign_id, execution_item_id, ' +
        'created_at, updated_at'
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (dimension) query = query.eq('dimension', dimension)
    if (status)    query = query.eq('status', status)

    const { data: packages, error: pkgErr } = await query

    if (pkgErr) {
      console.error('[production list GET] Supabase error:', pkgErr)
      return NextResponse.json({ success: false, error: 'Failed to retrieve packages' }, { status: 500 })
    }

    const safePackages = (packages ?? []) as unknown as ProductionPackageListRow[]

    // Batch-fetch item counts for all returned packages
    let itemCountMap: Record<string, number> = {}
    if (safePackages.length > 0) {
      const packageIds = safePackages.map(p => p.id)
      const { data: items, error: itemErr } = await supabaseAdmin
        .from('production_items')
        .select('package_id')
        .in('package_id', packageIds)

      if (!itemErr && items) {
        itemCountMap = items.reduce<Record<string, number>>((acc, i) => {
          acc[i.package_id] = (acc[i.package_id] ?? 0) + 1
          return acc
        }, {})
      }
    }

    const result = safePackages.map(pkg => ({
      ...pkg,
      item_count: itemCountMap[pkg.id] ?? 0,
    }))

    return NextResponse.json({ success: true, packages: result })
  } catch (err: unknown) {
    console.error('[production list GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

/**
 * POST /api/clients/[id]/production
 *
 * Creates a new production package for the client.
 *
 * Body:
 *   dimension         — required, one of the 6 diagnostic dimensions
 *   title             — required, non-empty string
 *   brief             — optional string
 *   campaign_id       — optional UUID
 *   execution_item_id — optional UUID
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const body = await req.json() as {
      dimension?: unknown
      title?: unknown
      brief?: unknown
      campaign_id?: unknown
      execution_item_id?: unknown
    }

    const { dimension, title, brief, campaign_id, execution_item_id } = body

    if (!dimension || !VALID_DIMENSIONS.includes(dimension as DiagnosticDimension)) {
      return NextResponse.json(
        { success: false, error: `dimension 必须是 ${VALID_DIMENSIONS.join(' / ')} 之一` },
        { status: 400 }
      )
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'title 不能为空' }, { status: 400 })
    }

    // Resolve master_brief for this client (take the first one)
    const { data: brief_row, error: briefErr } = await supabaseAdmin
      .from('master_briefs')
      .select('id')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle()

    if (briefErr) {
      console.error('[production POST] master_brief lookup error:', briefErr)
      return NextResponse.json({ success: false, error: '查询客户档案失败' }, { status: 500 })
    }
    if (!brief_row) {
      return NextResponse.json(
        { success: false, error: '该客户尚未建立 Master Brief，请先完成客户档案' },
        { status: 422 }
      )
    }

    const { data: pkg, error: insertErr } = await supabaseAdmin
      .from('production_packages')
      .insert({
        client_id:                   clientId,
        master_brief_id:             brief_row.id,
        dimension:                   dimension as DiagnosticDimension,
        title:                       title.trim(),
        brief:                       typeof brief === 'string' && brief.trim() ? brief.trim() : null,
        campaign_id:                 typeof campaign_id === 'string' && campaign_id ? campaign_id : null,
        execution_item_id:           typeof execution_item_id === 'string' && execution_item_id ? execution_item_id : null,
        source_payload:              {},
        generation_context_snapshot: {},
        status:                      'draft',
      })
      .select('id, dimension, title, brief, status, campaign_id, execution_item_id, created_at, updated_at')
      .single()

    if (insertErr) {
      console.error('[production POST] insert error:', insertErr)
      return NextResponse.json({ success: false, error: '创建失败，请重试' }, { status: 500 })
    }

    return NextResponse.json({ success: true, package: pkg }, { status: 201 })
  } catch (err: unknown) {
    console.error('[production POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

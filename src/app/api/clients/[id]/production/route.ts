import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken, clampLimit } from '@/lib/validation-utils'

type RouteContext = { params: { id: string } }

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
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const clientId = params.id
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

    const safePackages = packages ?? []

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

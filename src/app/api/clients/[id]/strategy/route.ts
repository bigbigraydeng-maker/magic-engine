import { NextRequest, NextResponse } from 'next/server'
import {
  listStrategyItems,
  countStrategyItemsByStatus,
} from '@/lib/db/strategy-items'
import type {
  StrategyStatus,
  StrategyActionType,
  ListStrategyFilter,
} from '@/types/magic-engine'

const ALLOWED_STATUS: StrategyStatus[] = [
  'pending',
  'approved',
  'in_progress',
  'done',
  'dismissed',
]

const ALLOWED_ACTION: StrategyActionType[] = [
  'upgrade_page',
  'new_blog',
  'social_content',
]

/**
 * GET /api/clients/[id]/strategy
 *
 * Returns the current strategy item list for a client (sorted by score),
 * plus a status-bucket count summary.
 *
 * Query params (all optional):
 *   status, action_type, strategy_run_id, limit
 *
 * Reference: ROADMAP.md P8.D.1.5
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const sp = req.nextUrl.searchParams
    const filter: ListStrategyFilter = {}

    const s = sp.get('status')
    if (s && ALLOWED_STATUS.includes(s as StrategyStatus))
      filter.status = s as StrategyStatus

    const a = sp.get('action_type')
    if (a && ALLOWED_ACTION.includes(a as StrategyActionType))
      filter.action_type = a as StrategyActionType

    const r = sp.get('strategy_run_id')
    if (r) filter.strategy_run_id = r

    const limit = parseInt(sp.get('limit') ?? '', 10)
    if (Number.isFinite(limit) && limit > 0) filter.limit = limit

    const [items, statusCounts] = await Promise.all([
      listStrategyItems(params.id, filter),
      countStrategyItemsByStatus(params.id),
    ])

    return NextResponse.json({
      success: true,
      items,
      count: items.length,
      status_counts: statusCounts,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

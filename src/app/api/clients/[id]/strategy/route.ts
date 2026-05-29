/**
 * GET /api/clients/[id]/strategy
 *
 * Lists strategy items for a client with optional filtering and pagination.
 *
 * Query parameters:
 * - status (optional): filter by StrategyStatus
 * - exclude_status (optional): exclude rows with this status (e.g. "dismissed")
 * - run_id (optional): filter by strategy_run_id
 * - limit (optional): integer 1-100, default 50 (clamped silently)
 * - offset (optional): integer >= 0, default 0
 *
 * Phase 8.1
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { StrategyItem, StrategyStatus } from '@/lib/strategy/types'

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

export interface ListStrategyResponse {
  items: StrategyItem[]
  total: number
  limit: number
  offset: number
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_STATUSES: StrategyStatus[] = [
  'pending',
  'approved',
  'in_progress',
  'done',
  'dismissed',
]

function isValidStatus(value: string): value is StrategyStatus {
  return VALID_STATUSES.includes(value as StrategyStatus)
}

function clampLimit(raw: string | null): number {
  const parsed = raw !== null ? parseInt(raw, 10) : 50
  if (isNaN(parsed)) return 50
  return Math.max(1, Math.min(100, parsed))
}

function clampOffset(raw: string | null): number {
  const parsed = raw !== null ? parseInt(raw, 10) : 0
  if (isNaN(parsed) || parsed < 0) return 0
  return parsed
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const clientId = params.id

  try {
    // Parse query parameters
    const { searchParams } = new URL(req.url)
    const statusParam = searchParams.get('status')
    const excludeStatusParam = searchParams.get('exclude_status')
    const runIdParam = searchParams.get('run_id')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // Validate status if provided
    if (statusParam !== null && !isValidStatus(statusParam)) {
      return NextResponse.json(
        {
          error: `Invalid status "${statusParam}". Must be one of: ${VALID_STATUSES.join(', ')}`,
        },
        { status: 400 }
      )
    }

    if (excludeStatusParam !== null && !isValidStatus(excludeStatusParam)) {
      return NextResponse.json(
        {
          error: `Invalid exclude_status "${excludeStatusParam}". Must be one of: ${VALID_STATUSES.join(', ')}`,
        },
        { status: 400 }
      )
    }

    const limit = clampLimit(limitParam)
    const offset = clampOffset(offsetParam)

    // Step 1: Verify client exists
    const { data: client, error: clientError } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Step 2: Build query on content_strategy_items
    let query = supabaseAdmin
      .from('content_strategy_items')
      .select('*', { count: 'exact' })
      .eq('client_id', clientId)
      .order('priority_score', { ascending: false })

    if (statusParam !== null) {
      query = query.eq('status', statusParam)
    }

    if (excludeStatusParam !== null) {
      query = query.neq('status', excludeStatusParam)
    }

    if (runIdParam !== null) {
      query = query.eq('strategy_run_id', runIdParam)
    }

    query = query.range(offset, offset + limit - 1)

    const { data, count, error: queryError } = await query

    if (queryError) {
      return NextResponse.json(
        { error: queryError.message ?? 'Failed to fetch strategy items' },
        { status: 500 }
      )
    }

    const items = (data ?? []) as StrategyItem[]
    const total = count ?? 0

    return NextResponse.json(
      { items, total, limit, offset } satisfies ListStrategyResponse,
      { status: 200 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { updateStrategyStatus } from '@/lib/db/strategy-items'
import type { StrategyStatus } from '@/types/magic-engine'

const ALLOWED: StrategyStatus[] = [
  'pending',
  'approved',
  'in_progress',
  'done',
  'dismissed',
]

/**
 * PATCH /api/clients/[id]/strategy/[itemId]
 *
 * Body: { status: StrategyStatus, linked_blog_post_id?: string | null }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      status?: string
      linked_blog_post_id?: string | null
    }
    if (!body.status || !ALLOWED.includes(body.status as StrategyStatus)) {
      return NextResponse.json(
        { success: false, error: 'invalid status' },
        { status: 400 }
      )
    }
    const updated = await updateStrategyStatus(params.itemId, {
      status: body.status as StrategyStatus,
      linked_blog_post_id: body.linked_blog_post_id,
    })
    return NextResponse.json({ success: true, item: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

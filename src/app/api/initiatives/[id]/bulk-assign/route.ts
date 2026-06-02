/**
 * POST /api/initiatives/[id]/bulk-assign
 *
 * Body: { execution_item_ids: string[] }
 *   → 把多个 execution_items 的 initiative_id 改为该 initiative。
 *
 * 校验：所有 actions 必须属于该 initiative 的 client_id（防越界）。
 * 返回 updated_count。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getInitiativeById } from '@/lib/strategy/initiatives'

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let body: { execution_item_ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const ids = (body.execution_item_ids ?? []).filter(Boolean)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'execution_item_ids must be non-empty' }, { status: 400 })
  }
  if (ids.length > 200) {
    return NextResponse.json({ error: 'Max 200 items per call' }, { status: 400 })
  }

  const initiative = await getInitiativeById(supabaseAdmin, params.id)
  if (!initiative) return NextResponse.json({ error: 'Initiative not found' }, { status: 404 })

  // Update only actions that belong to the same client (defence-in-depth)
  const { data, error } = await supabaseAdmin
    .from('execution_items')
    .update({ initiative_id: initiative.id })
    .in('id', ids)
    .eq('client_id', initiative.client_id)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    updated_count: data?.length ?? 0,
    skipped_count: ids.length - (data?.length ?? 0),
  })
}

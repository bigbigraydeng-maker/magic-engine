/**
 * PATCH / DELETE /api/clients/[id]/memory/[type]/[memId]
 *
 * Phase 23.E — 编辑或删除一条 L3 记忆。
 *
 * URL params:
 *   id      — client_id
 *   type    — 'preferences' | 'patterns' | 'experiments' | 'decisions'
 *   memId   — memory row id (UUID)
 *
 * PATCH body (按 type 不同，全部可选)：
 *   preferences:  { content?, preference_type?, confidence_score?, flywheel?, is_active? }
 *   patterns:     { pattern_content?, pattern_type?, performance_metric?, flywheel?, is_active? }
 *   experiments:  { experiment_description?, failure_reason?, dimension? }
 *   decisions:    { outcome_verdict?, outcome_notes? }      // 决策历史只允许改 verdict + notes
 *
 * Responses:
 *   200  { success: true, row }
 *   400  invalid type / empty patch / unknown field
 *   404  not found / wrong client
 *   500  DB error
 *
 * Reference: ROADMAP.md Phase 23.E
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VALID_TYPES = ['preferences', 'patterns', 'experiments', 'decisions'] as const
type MemoryType = (typeof VALID_TYPES)[number]

const TABLE_MAP: Record<MemoryType, string> = {
  preferences: 'client_learned_preferences',
  patterns:    'client_proven_patterns',
  experiments: 'client_failed_experiments',
  decisions:   'client_decision_history',
}

const ALLOWED_PATCH_FIELDS: Record<MemoryType, readonly string[]> = {
  preferences: ['content', 'preference_type', 'confidence_score', 'flywheel', 'is_active'],
  patterns:    ['pattern_content', 'pattern_type', 'performance_metric', 'flywheel', 'is_active'],
  experiments: ['experiment_description', 'failure_reason', 'dimension'],
  decisions:   ['outcome_verdict', 'outcome_notes'],
}

function isMemoryType(t: string): t is MemoryType {
  return (VALID_TYPES as readonly string[]).includes(t)
}

// ── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; type: string; memId: string } },
): Promise<NextResponse> {
  const { id: clientId, type, memId } = params

  if (!isMemoryType(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const allowed = ALLOWED_PATCH_FIELDS[type]
  const patch: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: `No allowed fields in body. Allowed: ${allowed.join(', ')}` },
      { status: 400 },
    )
  }

  const table = TABLE_MAP[type]
  const { data, error } = await supabaseAdmin
    .from(table)
    .update(patch)
    .eq('id', memId)
    .eq('client_id', clientId)
    .select()
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Memory row not found for this client' }, { status: 404 })
    }
    console.error('[memory/patch] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, row: data })
}

// ── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; type: string; memId: string } },
): Promise<NextResponse> {
  const { id: clientId, type, memId } = params

  if (!isMemoryType(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 },
    )
  }

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const table = TABLE_MAP[type]
  const { error, count } = await supabaseAdmin
    .from(table)
    .delete({ count: 'exact' })
    .eq('id', memId)
    .eq('client_id', clientId)

  if (error) {
    console.error('[memory/delete] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!count) {
    return NextResponse.json({ error: 'Memory row not found for this client' }, { status: 404 })
  }

  return NextResponse.json({ success: true, deleted: count })
}

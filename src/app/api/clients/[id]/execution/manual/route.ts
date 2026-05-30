/**
 * POST /api/clients/[id]/execution/manual
 *
 * Phase 20.D — FDE 手动录入执行任务（不绑定处方或 Marketing Plan）。
 * FDE 可从任意六支柱直接录入已完成 / 进行中的工作，写入看板供客户可见。
 *
 * Body: {
 *   title:        string   (required)
 *   description?: string
 *   dimension:    'seo' | 'ai_visibility' | 'ads' | 'social' | 'reputation' | 'competitor'
 *   fix_type?:    'fde_manual' | 'me_auto' | 'third_party'   (default: 'fde_manual')
 *   status?:      'pending' | 'in_progress' | 'completed' | 'skipped'  (default: 'completed')
 *   due_date?:    YYYY-MM-DD
 * }
 *
 * Security: session-cookie via requireDashboardClientAccess (Phase 19 pattern)
 * Reference: ROADMAP.md Phase 20.D
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { DiagnosticDimension, ExecutionItem, ExecutionItemStatus, FixType } from '@/types/diagnostic'

export const dynamic = 'force-dynamic'

const VALID_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]
const VALID_FIX_TYPES: FixType[] = ['fde_manual', 'me_auto', 'third_party']
const VALID_STATUSES: ExecutionItemStatus[] = ['pending', 'in_progress', 'completed', 'skipped']

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  try {
    const body = (await req.json()) as {
      title?: string
      description?: string
      dimension?: DiagnosticDimension
      fix_type?: FixType
      status?: ExecutionItemStatus
      due_date?: string
    }

    const title = (body.title ?? '').trim()
    if (!title) {
      return NextResponse.json({ success: false, error: 'title 必填' }, { status: 400 })
    }

    const dimension: DiagnosticDimension =
      body.dimension && VALID_DIMENSIONS.includes(body.dimension) ? body.dimension : 'seo'
    const fix_type: FixType =
      body.fix_type && VALID_FIX_TYPES.includes(body.fix_type) ? body.fix_type : 'fde_manual'
    const status: ExecutionItemStatus =
      body.status && VALID_STATUSES.includes(body.status) ? body.status : 'completed'
    const description = (body.description ?? '').trim() || title
    const due_date = body.due_date ?? null

    // Compute next sort_order (within fde_manual items for this client)
    const { data: maxRow } = await supabaseAdmin
      .from('execution_items')
      .select('sort_order')
      .eq('client_id', clientId)
      .eq('source', 'fde_manual')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>()

    const sortOrder = (maxRow?.sort_order ?? 0) + 10

    const completed_at = status === 'completed' ? new Date().toISOString() : null
    const started_at   = (status === 'completed' || status === 'in_progress') ? new Date().toISOString() : null

    const { data: item, error: insertErr } = await supabaseAdmin
      .from('execution_items')
      .insert({
        client_id:         clientId,
        prescription_id:   null,
        marketing_plan_id: null,
        source:            'fde_manual',
        finding_id:        null,
        dimension,
        phase:             1,
        title,
        description,
        fix_type,
        status,
        due_date,
        steps_json: {
          source: 'fde_manual',
          estimated_hours: 1,
          required_skills: ['FDE'],
        },
        execution_target: null,
        sort_order:    sortOrder,
        started_at,
        completed_at,
      })
      .select('*')
      .single<ExecutionItem>()

    if (insertErr || !item) {
      console.error('[execution/manual POST] insert failed:', insertErr)
      return NextResponse.json({ success: false, error: '录入执行任务失败' }, { status: 500 })
    }

    // Write audit log
    await supabaseAdmin.from('execution_logs').insert({
      execution_item_id: item.id,
      client_id:         clientId,
      author:            'fde',
      kind:              'adjustment',
      content:           `FDE 录入：${title}`,
      meta:              { source: 'fde_manual', dimension, status },
    }).then(({ error: logErr }) => {
      if (logErr) console.error('[execution/manual POST] log insert failed:', logErr)
    })

    return NextResponse.json({ success: true, item })
  } catch (err: unknown) {
    console.error('[execution/manual POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

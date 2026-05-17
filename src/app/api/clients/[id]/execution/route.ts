/**
 * GET  /api/clients/[id]/execution
 *   Returns all execution_items for a client（每项附带 logs），
 *   外加涉及的处方元数据（按处方分组用）。
 *   Query: ?prescription_id=<uuid>  — 过滤到单个处方（可选）
 *
 * POST /api/clients/[id]/execution
 *   FDE 在执行看板上手动新增一个执行项（处方"活化" P8.10.S5.2）。
 *   Body: { prescription_id, phase, title, description, dimension, fix_type }
 *   新增后写一条 execution_logs（kind='adjustment'）。
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.5.17 / P8.10.S5.2
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import type {
  ExecutionItem, ExecutionLog, PrescriptionStatus,
  DiagnosticDimension, FixType,
} from '@/types/diagnostic'
import type { OutcomeVerdict } from '@/lib/flywheel/adapters/types'

/** Summary of the latest attribution outcome for an execution item. */
export interface ItemOutcomeSummary {
  verdict: OutcomeVerdict
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number
  computed_at: string
}

const VALID_DIMENSIONS: DiagnosticDimension[] = [
  'seo', 'ai_visibility', 'ads', 'social', 'reputation', 'competitor',
]
const VALID_FIX_TYPES: FixType[] = ['me_auto', 'fde_manual', 'third_party']

export const dynamic = 'force-dynamic'

/** 返回时每个 item 附带它的 logs（鲁班 P8.10.S4.1）和最新 outcome（P12.A.10） */
export interface ExecutionItemWithLogs extends ExecutionItem {
  logs: ExecutionLog[]
  outcome: ItemOutcomeSummary | null
}

/** 执行项涉及的处方元数据 — 用于看板按处方分组（P8.10.S5） */
export interface ExecutionPrescriptionMeta {
  id: string
  status: PrescriptionStatus
  supplements_id: string | null
  supersedes_id: string | null
  generated_at: string | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params
    const { searchParams } = new URL(req.url)
    const prescriptionId = searchParams.get('prescription_id')

    let query = supabaseAdmin
      .from('execution_items')
      .select('*')
      .eq('client_id', clientId)
      .order('sort_order', { ascending: true })

    if (prescriptionId) {
      query = query.eq('prescription_id', prescriptionId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[execution GET] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Failed to fetch execution items' }, { status: 500 })
    }

    const baseItems = (data ?? []) as ExecutionItem[]

    // 拉取这些 item 的所有 logs，一次查完按 item 分组
    let logsByItem: Record<string, ExecutionLog[]> = {}
    if (baseItems.length > 0) {
      const { data: logRows, error: logErr } = await supabaseAdmin
        .from('execution_logs')
        .select('*')
        .in('execution_item_id', baseItems.map(i => i.id))
        .order('created_at', { ascending: true })

      if (logErr) {
        console.error('[execution GET] logs fetch error (non-fatal):', logErr)
      } else {
        logsByItem = (logRows ?? []).reduce((acc, row) => {
          const log = row as ExecutionLog
          ;(acc[log.execution_item_id] ??= []).push(log)
          return acc
        }, {} as Record<string, ExecutionLog[]>)
      }
    }

    // 拉取这些 item 的最新 flywheel_outcome（P12.A.10）
    // 路径：execution_items → flywheel_actions.execution_item_id → flywheel_outcomes.action_id
    let outcomeByItem: Record<string, ItemOutcomeSummary> = {}
    if (baseItems.length > 0) {
      const { data: actionRows } = await supabaseAdmin
        .from('flywheel_actions')
        .select('id, execution_item_id')
        .in('execution_item_id', baseItems.map(i => i.id))

      if (actionRows?.length) {
        const actionToItem = new Map<string, string>(
          (actionRows as { id: string; execution_item_id: string }[])
            .map(a => [a.id, a.execution_item_id])
        )

        const { data: outcomeRows } = await supabaseAdmin
          .from('flywheel_outcomes')
          .select('action_id, metric_key, delta, delta_pct, confidence, verdict, computed_at')
          .in('action_id', actionRows.map(a => a.id))
          .order('computed_at', { ascending: false })

        if (outcomeRows?.length) {
          for (const row of outcomeRows as {
            action_id: string; metric_key: string; delta: number | null
            delta_pct: number | null; confidence: number
            verdict: string; computed_at: string
          }[]) {
            const itemId = actionToItem.get(row.action_id)
            if (itemId && !outcomeByItem[itemId]) {
              outcomeByItem[itemId] = {
                verdict: row.verdict as ItemOutcomeSummary['verdict'],
                metric_key: row.metric_key,
                delta: row.delta,
                delta_pct: row.delta_pct,
                confidence: row.confidence,
                computed_at: row.computed_at,
              }
            }
          }
        }
      }
    }

    const items: ExecutionItemWithLogs[] = baseItems.map(it => ({
      ...it,
      logs: logsByItem[it.id] ?? [],
      outcome: outcomeByItem[it.id] ?? null,
    }))

    // 拉取这些 item 涉及的处方元数据（按处方分组 + 补充/修订按钮用）
    let prescriptions: ExecutionPrescriptionMeta[] = []
    const prescriptionIds = Array.from(new Set(baseItems.map(i => i.prescription_id)))
    if (prescriptionIds.length > 0) {
      const { data: presRows, error: presErr } = await supabaseAdmin
        .from('prescriptions')
        .select('id, status, supplements_id, supersedes_id, generated_at')
        .in('id', prescriptionIds)
        .order('generated_at', { ascending: true })
      if (presErr) {
        console.error('[execution GET] prescriptions fetch error (non-fatal):', presErr)
      } else {
        prescriptions = (presRows ?? []) as ExecutionPrescriptionMeta[]
      }
    }

    return NextResponse.json({ success: true, items, prescriptions, count: items.length }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err: unknown) {
    console.error('[execution GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

// ─── POST — FDE 手动新增执行项（处方活化）──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId } = params
    const body = (await req.json()) as {
      prescription_id?: string
      phase?: number
      title?: string
      description?: string
      dimension?: DiagnosticDimension
      fix_type?: FixType
    }

    const title = (body.title ?? '').trim()
    const description = (body.description ?? '').trim()
    if (!body.prescription_id || !title) {
      return NextResponse.json(
        { success: false, error: 'prescription_id 和 title 必填' },
        { status: 400 },
      )
    }
    const phase = body.phase && [1, 2, 3].includes(body.phase) ? body.phase : 1
    const dimension: DiagnosticDimension =
      body.dimension && VALID_DIMENSIONS.includes(body.dimension) ? body.dimension : 'seo'
    const fix_type: FixType =
      body.fix_type && VALID_FIX_TYPES.includes(body.fix_type) ? body.fix_type : 'fde_manual'

    // 校验处方归属
    const { data: presc, error: pErr } = await supabaseAdmin
      .from('prescriptions')
      .select('id')
      .eq('id', body.prescription_id)
      .eq('client_id', clientId)
      .single<{ id: string }>()
    if (pErr || !presc) {
      return NextResponse.json({ success: false, error: '处方不存在' }, { status: 404 })
    }

    // sort_order：该处方现有最大值 + 1
    const { data: maxRow } = await supabaseAdmin
      .from('execution_items')
      .select('sort_order')
      .eq('prescription_id', body.prescription_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>()
    const sortOrder = (maxRow?.sort_order ?? (phase - 1) * 100) + 1

    const { data: item, error: insertErr } = await supabaseAdmin
      .from('execution_items')
      .insert({
        prescription_id: body.prescription_id,
        client_id:       clientId,
        finding_id:      null,
        dimension,
        phase,
        title,
        description:     description || title,
        fix_type,
        status:          'pending',
        steps_json:      { source: 'fde_manual_add' },
        sort_order:      sortOrder,
      })
      .select('*')
      .single<ExecutionItem>()

    if (insertErr || !item) {
      console.error('[execution POST] insert failed:', insertErr)
      return NextResponse.json({ success: false, error: '新增执行项失败' }, { status: 500 })
    }

    // 写审计日志
    await supabaseAdmin.from('execution_logs').insert({
      execution_item_id: item.id,
      client_id:         clientId,
      author:            'fde',
      kind:              'adjustment',
      content:           `FDE 手动新增执行项：${title}`,
      meta:              { adjustment: 'add' },
    }).then(({ error: logErr }) => {
      if (logErr) console.error('[execution POST] log insert failed:', logErr)
    })

    return NextResponse.json({ success: true, item })
  } catch (err: unknown) {
    console.error('[execution POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

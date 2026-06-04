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
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type {
  ExecutionItem, ExecutionLog, PrescriptionStatus,
  DiagnosticDimension, FixType, LinkedContentPost,
} from '@/types/diagnostic'
import type { ExecutionMode, FlywheelName, OutcomeVerdict } from '@/lib/flywheel/adapters/types'

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
const AUTONOMOUS_PRESCRIPTION_ID = '__autonomous__'

/** 返回时每个 item 附带它的 logs（鲁班 P8.10.S4.1）和最新 outcome（P12.A.10）+ 关联内容（飞轮闭环） */
export interface ExecutionItemWithLogs extends ExecutionItem {
  logs: ExecutionLog[]
  outcome: ItemOutcomeSummary | null
  linked_post: LinkedContentPost | null
  source_kind?: 'execution_item' | 'flywheel_action'
  flywheel_action_id?: string
}

interface FlywheelActionForExecution {
  id: string
  client_id: string
  flywheel: FlywheelName
  action_type: string
  execution_mode: ExecutionMode
  vendor: string | null
  payload: Record<string, unknown> | null
  expected_metric: string | null
  expected_delta: number | null
  executed_at: string | null
  created_at: string
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
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
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

        const outcomeByAction = await fetchLatestOutcomesByAction(actionRows.map(a => a.id))
        for (const [actionId, outcome] of Object.entries(outcomeByAction)) {
          const itemId = actionToItem.get(actionId)
          if (itemId) {
            outcomeByItem[itemId] = outcome
          }
        }
      }
    }

    // 拉取关联的 content_posts + 最终视觉资产（内容飞轮闭环）
    const linkedPostByItem: Record<string, LinkedContentPost> = {}
    const postIds = Array.from(new Set(
      baseItems.map(i => i.content_post_id).filter((x): x is string => !!x),
    ))
    if (postIds.length > 0) {
      const { data: postRows } = await supabaseAdmin
        .from('content_posts')
        .select('id, title, status, platforms, caption, scheduled_at')
        .in('id', postIds)

      // 取每篇 post 的最终视觉资产（is_final=true 或 latest）
      const { data: assetRows } = await supabaseAdmin
        .from('visual_assets')
        .select('post_id, storage_url, is_final, created_at')
        .in('post_id', postIds)
        .not('storage_url', 'is', null)
        .order('created_at', { ascending: false })

      const assetByPost = new Map<string, string>()
      for (const row of (assetRows ?? []) as { post_id: string; storage_url: string; is_final: boolean }[]) {
        // Final 优先；否则取最新的
        if (row.is_final) assetByPost.set(row.post_id, row.storage_url)
        else if (!assetByPost.has(row.post_id)) assetByPost.set(row.post_id, row.storage_url)
      }

      const postById = new Map<string, {
        id: string; title: string; status: string
        platforms: string[] | null; caption: string | null; scheduled_at: string | null
      }>()
      for (const row of (postRows ?? []) as Array<{
        id: string; title: string; status: string
        platforms: string[] | null; caption: string | null; scheduled_at: string | null
      }>) {
        postById.set(row.id, row)
      }

      for (const it of baseItems) {
        if (!it.content_post_id) continue
        const post = postById.get(it.content_post_id)
        if (!post) continue
        linkedPostByItem[it.id] = {
          id: post.id,
          title: post.title,
          status: post.status,
          platforms: post.platforms ?? [],
          caption: post.caption,
          scheduled_at: post.scheduled_at,
          visual_asset_url: assetByPost.get(post.id) ?? null,
        }
      }
    }

    const items: ExecutionItemWithLogs[] = baseItems.map(it => ({
      ...it,
      source_kind: 'execution_item',
      logs: logsByItem[it.id] ?? [],
      outcome: outcomeByItem[it.id] ?? null,
      linked_post: linkedPostByItem[it.id] ?? null,
    }))
    const autonomousItems = prescriptionId ? [] : await fetchAutonomousActionItems(clientId)
    const allItems = [...autonomousItems, ...items]

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

    return NextResponse.json({ success: true, items: allItems, prescriptions, count: allItems.length }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err: unknown) {
    console.error('[execution GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

async function fetchLatestOutcomesByAction(actionIds: string[]): Promise<Record<string, ItemOutcomeSummary>> {
  if (actionIds.length === 0) return {}

  const { data: outcomeRows } = await supabaseAdmin
    .from('flywheel_outcomes')
    .select('action_id, metric_key, delta, delta_pct, confidence, verdict, computed_at')
    .in('action_id', actionIds)
    .order('computed_at', { ascending: false })

  const outcomeByAction: Record<string, ItemOutcomeSummary> = {}
  for (const row of (outcomeRows ?? []) as Array<{
    action_id: string; metric_key: string; delta: number | null
    delta_pct: number | null; confidence: number
    verdict: string; computed_at: string
  }>) {
    if (outcomeByAction[row.action_id]) continue
    outcomeByAction[row.action_id] = {
      verdict: row.verdict as ItemOutcomeSummary['verdict'],
      metric_key: row.metric_key,
      delta: row.delta,
      delta_pct: row.delta_pct,
      confidence: row.confidence,
      computed_at: row.computed_at,
    }
  }

  return outcomeByAction
}

async function fetchAutonomousActionItems(clientId: string): Promise<ExecutionItemWithLogs[]> {
  const { data: actionRows, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, client_id, flywheel, action_type, execution_mode, vendor, payload, expected_metric, expected_delta, executed_at, created_at')
    .eq('client_id', clientId)
    .is('execution_item_id', null)
    .order('executed_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[execution GET] autonomous actions fetch error (non-fatal):', error)
    return []
  }

  const actions = (actionRows ?? []) as FlywheelActionForExecution[]
  const outcomeByAction = await fetchLatestOutcomesByAction(actions.map(a => a.id))
  return actions.map(action => buildAutonomousItem(action, outcomeByAction[action.id] ?? null))
}

function buildAutonomousItem(
  action: FlywheelActionForExecution,
  outcome: ItemOutcomeSummary | null,
): ExecutionItemWithLogs {
  const payload = action.payload ?? {}
  const executedAt = action.executed_at ?? action.created_at
  const keyword = typeof payload.primary_keyword === 'string' ? payload.primary_keyword : null
  const title = action.action_type === 'seo.publish_blog'
    ? keyword ? `生成博客：${keyword}` : '生成博客'
    : `${action.flywheel.toUpperCase()} · ${action.action_type}`

  return {
    id: action.id,
    prescription_id: AUTONOMOUS_PRESCRIPTION_ID,
    client_id: action.client_id,
    finding_id: null,
    dimension: flywheelToDimension(action.flywheel),
    phase: 1,
    title,
    description: `自主行动 · ${action.action_type} · ${formatDate(executedAt)}`,
    fix_type: modeToFixType(action.execution_mode),
    status: 'completed',
    steps_json: {
      source: 'flywheel_action',
      action_type: action.action_type,
      measurement_method: action.expected_metric ? `追踪 ${action.expected_metric}` : undefined,
    },
    execution_target: {
      flywheel: action.flywheel,
      mode: action.execution_mode,
      vendor: action.vendor ?? undefined,
      action_type: action.action_type,
    },
    assigned_to: null,
    due_date: null,
    started_at: executedAt,
    completed_at: executedAt,
    sort_order: 0,
    created_at: action.created_at,
    updated_at: action.created_at,
    content_post_id: null,
    source: 'diagnostic',           // 自主行动用 sentinel prescription_id，归类为 diagnostic 来源
    marketing_plan_id: null,
    initiative_id: null,
    generation_started_at: null,    // autonomous actions don't go through the workbench generate flow
    generation_error: null,
    logs: [],
    outcome,
    linked_post: null,
    source_kind: 'flywheel_action',
    flywheel_action_id: action.id,
  }
}

function flywheelToDimension(flywheel: FlywheelName): DiagnosticDimension {
  if (flywheel === 'geo') return 'ai_visibility'
  return flywheel
}

function modeToFixType(mode: ExecutionMode): FixType {
  if (mode === 'third_party') return 'third_party'
  if (mode === 'external_manual') return 'fde_manual'
  return 'me_auto'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
}

// ─── POST — FDE 手动新增执行项（处方活化）──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const body = (await req.json()) as {
      prescription_id?: string
      marketing_plan_id?: string
      phase?: number
      title?: string
      description?: string
      dimension?: DiagnosticDimension
      fix_type?: FixType
      platform?: string
      kind?: string
    }

    const title = (body.title ?? '').trim()
    const description = (body.description ?? '').trim()
    const isMarketingPlan = !!body.marketing_plan_id && !body.prescription_id

    if (!isMarketingPlan && !body.prescription_id) {
      return NextResponse.json(
        { success: false, error: 'prescription_id 或 marketing_plan_id 必填' },
        { status: 400 },
      )
    }
    if (!title) {
      return NextResponse.json({ success: false, error: 'title 必填' }, { status: 400 })
    }

    const phase = body.phase && [1, 2, 3].includes(body.phase) ? body.phase : 1

    // ── Marketing Plan 任务新增 ────────────────────────────────────────────────
    if (isMarketingPlan) {
      const { data: plan, error: planErr } = await supabaseAdmin
        .from('marketing_plans')
        .select('id')
        .eq('id', body.marketing_plan_id!)
        .eq('client_id', clientId)
        .single<{ id: string }>()
      if (planErr || !plan) {
        return NextResponse.json({ success: false, error: 'Marketing Plan 不存在' }, { status: 404 })
      }

      const { data: maxRow } = await supabaseAdmin
        .from('execution_items')
        .select('sort_order')
        .eq('marketing_plan_id', body.marketing_plan_id!)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle<{ sort_order: number }>()
      const sortOrder = (maxRow?.sort_order ?? (phase - 1) * 100) + 1

      const kind = body.kind ?? 'social_post'
      const platform = body.platform ?? null
      const stepsJson = {
        source: 'fde_manual_add',
        kind,
        platform,
        estimated_hours: 1,
        required_skills: kind === 'social_reel' ? ['video direction', 'social copywriting'] : ['social copywriting'],
      }

      const { data: item, error: insertErr } = await supabaseAdmin
        .from('execution_items')
        .insert({
          prescription_id:   null,
          marketing_plan_id: body.marketing_plan_id!,
          source:            'marketing_plan',
          client_id:         clientId,
          finding_id:        null,
          dimension:         'social',
          phase,
          title,
          description:       description || title,
          fix_type:          'fde_manual',
          status:            'pending',
          steps_json:        stepsJson,
          execution_target:  { mode: 'in_house', flywheel: 'social', module: 'social_matrix' },
          sort_order:        sortOrder,
        })
        .select('*')
        .single<ExecutionItem>()

      if (insertErr || !item) {
        console.error('[execution POST] mp insert failed:', insertErr)
        return NextResponse.json({ success: false, error: '新增执行项失败' }, { status: 500 })
      }

      await supabaseAdmin.from('execution_logs').insert({
        execution_item_id: item.id,
        client_id:         clientId,
        author:            'fde',
        kind:              'adjustment',
        content:           `FDE 手动新增执行项：${title}`,
        meta:              { adjustment: 'add', source: 'marketing_plan' },
      }).then(({ error: logErr }) => {
        if (logErr) console.error('[execution POST] log insert failed:', logErr)
      })

      return NextResponse.json({ success: true, item })
    }

    // ── 处方任务新增（原有逻辑）────────────────────────────────────────────────
    const dimension: DiagnosticDimension =
      body.dimension && VALID_DIMENSIONS.includes(body.dimension) ? body.dimension : 'seo'
    const fix_type: FixType =
      body.fix_type && VALID_FIX_TYPES.includes(body.fix_type) ? body.fix_type : 'fde_manual'

    const { data: presc, error: pErr } = await supabaseAdmin
      .from('prescriptions')
      .select('id')
      .eq('id', body.prescription_id!)
      .eq('client_id', clientId)
      .single<{ id: string }>()
    if (pErr || !presc) {
      return NextResponse.json({ success: false, error: '处方不存在' }, { status: 404 })
    }

    const { data: maxRow } = await supabaseAdmin
      .from('execution_items')
      .select('sort_order')
      .eq('prescription_id', body.prescription_id!)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>()
    const sortOrder = (maxRow?.sort_order ?? (phase - 1) * 100) + 1

    const { data: item, error: insertErr } = await supabaseAdmin
      .from('execution_items')
      .insert({
        prescription_id: body.prescription_id!,
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

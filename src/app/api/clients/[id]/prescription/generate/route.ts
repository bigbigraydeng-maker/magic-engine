/**
 * POST /api/clients/[id]/prescription/generate
 *
 * **流式响应模式**（SSE）。3 种生成模式：
 *   - 普通生成    body.discovery_id      — 从张骞 discovery 全新开方
 *   - 补充处方    body.supplement_of     — 为已有处方生成增量动作（原处方不动）
 *   - 修订处方    body.revise            — 为方向需调整的处方生成 v2
 *   - legacy      body.run_id            — diagnostic run（同步小路径）
 *
 * 补充/修订模式：从原处方 derive discovery_id，加载原处方全文 + 执行进度，
 * 作为 priorContext 传给华佗。
 *
 * Response: text/event-stream（SSE）
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S3 / S5
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { generatePrescription } from '@/lib/diagnostic/prescription-generator'
import { runHuatuo } from '@/lib/huatuo/agent'
import type {
  PrescriptionIntake, PrescriptionContent, PriorPrescriptionContext,
  ExecutionItem,
} from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import { savePrescriptionCase, deriveCrisisType } from '@/lib/case-library/saver'
import { mapIndustryToCategory } from '@/lib/huatuo/industry-mapper'
import { loadMemoryForClient } from '@/lib/memory'
import { getGoalById, listActiveGoals } from '@/lib/strategy/goals'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const HEARTBEAT_INTERVAL_MS = 8_000

// 补充/修订时，新处方要写的关系字段
interface PriorMeta {
  priorContext: PriorPrescriptionContext
  /** 新处方记录上要 set 的字段 */
  relationField: 'supplements_id' | 'supersedes_id'
  priorPrescriptionId: string
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return new Response(JSON.stringify({ error: access.error }), {
      status: access.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: {
    run_id?: string
    discovery_id?: string
    supplement_of?: string
    revise?: string
    intake?: PrescriptionIntake
    /**
     * DAPE Week 2 W4 — 处方跟 Goal 一对一 (修 BUG-FMT-F21).
     * 缺省时尝试用客户最新 active goal 兜底; 客户无 active goal 则报 422.
     */
    goal_id?: string
  }
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'invalid JSON body')
  }
  if (!body.intake) return errorResponse(400, 'intake is required')
  const intake = body.intake
  if (!intake.business_goal || typeof intake.monthly_budget_aud !== 'number') {
    return errorResponse(400, 'intake must include business_goal and monthly_budget_aud')
  }

  // ── DAPE W4: 解析 Goal (一对一) ─────────────────────────────────────
  const goalResult = await resolveGoal(clientId, body.goal_id, body.supplement_of ?? body.revise)
  if ('error' in goalResult) return errorResponse(goalResult.status, goalResult.error)
  const goal = goalResult.goal

  // ── Path: 补充 / 修订 — 从原处方 derive 上下文 ─────────────────────────────
  const priorId = body.supplement_of ?? body.revise
  if (priorId) {
    const mode = body.supplement_of ? 'supplement' : 'revision'
    const prep = await preparePriorContext(clientId, priorId, mode)
    if ('error' in prep) return errorResponse(prep.status, prep.error)

    const priorMeta: PriorMeta = {
      priorContext: prep.priorContext,
      relationField: mode === 'supplement' ? 'supplements_id' : 'supersedes_id',
      priorPrescriptionId: priorId,
    }
    return new Response(
      makeHuatuoStream(clientId, prep.discoveryId, prep.discovery, intake, goal, priorMeta),
      { headers: streamHeaders() },
    )
  }

  // ── Path A: 普通生成（discovery 源）─ 流式 ────────────────────────────────
  if (body.discovery_id) {
    const { data: row, error: discErr } = await supabaseAdmin
      .from('client_discovery')
      .select('id, payload, confirmed_at')
      .eq('id', body.discovery_id)
      .eq('client_id', clientId)
      .single<{ id: string; payload: DiscoveryReport; confirmed_at: string | null }>()

    if (discErr || !row) return errorResponse(404, 'Discovery not found')
    if (!row.confirmed_at) {
      return errorResponse(422, 'Discovery must be confirmed before generating a prescription')
    }

    return new Response(makeHuatuoStream(clientId, row.id, row.payload, intake, goal), {
      headers: streamHeaders(),
    })
  }

  // ── Path B: legacy diagnostic run（同步小路径）────────────────────────────
  if (body.run_id) {
    try {
      const { data: run, error: runError } = await supabaseAdmin
        .from('diagnostic_runs')
        .select('id, status')
        .eq('id', body.run_id)
        .eq('client_id', clientId)
        .single()
      if (runError || !run) return errorResponse(404, 'Diagnostic run not found')
      const { prescriptionId, content } = await generatePrescription(
        supabaseAdmin, body.run_id, clientId, intake,
      )
      return new Response(JSON.stringify({ success: true, prescription_id: prescriptionId, content }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      return errorResponse(500, message)
    }
  }

  return errorResponse(400, 'discovery_id / supplement_of / revise / run_id 至少要有一个')
}

// ─── DAPE Week 2 W4: Goal 解析 ───────────────────────────────────────────────
//
// 处方跟 Goal 一对一 (修 BUG-FMT-F21). 优先级:
//   1. body.goal_id 显式传 → 校验属于该 client
//   2. 补充/修订模式 → 从原处方 inherit goal_id (不传也能跑)
//   3. 客户唯一 active goal → 自动 fallback (UI 在迁移期不必每次传)
//   4. 客户多 active goals 但没传 → 422 (强制 UI 选)
//   5. 客户 0 active goals → 允许 NULL (legacy 模式, 兼容 pre-DAPE 流)
//
// 不破坏: 历史 6 处方 (CTS/Oztop 等) goal_id 全 NULL, 新调用可不传 (兜底逻辑)
//
type ResolveGoalResult =
  | { goal: GoalRow | null }
  | { error: string; status: number }

async function resolveGoal(
  clientId: string,
  explicitGoalId: string | undefined,
  priorPrescriptionId: string | undefined,
): Promise<ResolveGoalResult> {
  // Case 1: 显式 goal_id
  if (explicitGoalId) {
    const g = await getGoalById(supabaseAdmin, explicitGoalId)
    if (!g) return { error: 'Goal not found', status: 404 }
    if (g.client_id !== clientId) return { error: 'Goal does not belong to this client', status: 403 }
    return { goal: g }
  }

  // Case 2: 补充/修订 — 继承原处方的 goal_id
  if (priorPrescriptionId) {
    const { data: prior } = await supabaseAdmin
      .from('prescriptions')
      .select('goal_id')
      .eq('id', priorPrescriptionId)
      .eq('client_id', clientId)
      .maybeSingle<{ goal_id: string | null }>()
    if (prior?.goal_id) {
      const g = await getGoalById(supabaseAdmin, prior.goal_id)
      if (g) return { goal: g }
    }
    // 原处方无 goal_id (legacy) → 继续 fallback case 3
  }

  // Case 3-5: 客户 active goals 兜底
  const activeGoals = await listActiveGoals(supabaseAdmin, clientId)
  if (activeGoals.length === 1) {
    return { goal: activeGoals[0] }   // 唯一 active goal 自动用
  }
  if (activeGoals.length > 1) {
    return {
      error: `Client has ${activeGoals.length} active goals — body.goal_id is required to disambiguate`,
      status: 422,
    }
  }
  // 0 active goals = legacy 模式 (允许 NULL, 跟旧处方一致)
  return { goal: null }
}

/** DAPE W4: 算同 Goal 下一版本号. legacy (goal=null) 永远 v1. */
async function computeNextVersion(goalId: string | null): Promise<number> {
  if (!goalId) return 1
  const { data } = await supabaseAdmin
    .from('prescriptions')
    .select('version')
    .eq('goal_id', goalId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>()
  return (data?.version ?? 0) + 1
}

// ─── 补充/修订：从原处方加载上下文 ────────────────────────────────────────────

type PreparePriorResult =
  | { discoveryId: string; discovery: DiscoveryReport; priorContext: PriorPrescriptionContext }
  | { error: string; status: number }

async function preparePriorContext(
  clientId: string,
  priorId: string,
  mode: 'supplement' | 'revision',
): Promise<PreparePriorResult> {
  // 1. 加载原处方
  const { data: prior, error: pErr } = await supabaseAdmin
    .from('prescriptions')
    .select('id, status, discovery_id, content')
    .eq('id', priorId)
    .eq('client_id', clientId)
    .single<{
      id: string
      status: string
      discovery_id: string | null
      content: PrescriptionContent | null
    }>()

  if (pErr || !prior) return { error: '原处方不存在', status: 404 }
  if (!prior.content) return { error: '原处方内容为空，无法补充/修订', status: 422 }
  if (!prior.discovery_id) return { error: '原处方缺少 discovery 关联', status: 422 }
  // 只能补充/修订已批准的处方（执行中）
  if (prior.status !== 'approved') {
    return { error: `只能补充/修订"已批准"的处方（当前状态：${prior.status}）`, status: 422 }
  }

  // 2. 加载 discovery
  const { data: disc, error: dErr } = await supabaseAdmin
    .from('client_discovery')
    .select('id, payload')
    .eq('id', prior.discovery_id)
    .eq('client_id', clientId)
    .single<{ id: string; payload: DiscoveryReport }>()

  if (dErr || !disc) return { error: '原处方的 discovery 不存在', status: 404 }

  // 3. 加载原处方的执行进度 → 摘要
  const { data: execRows } = await supabaseAdmin
    .from('execution_items')
    .select('title, status, phase')
    .eq('prescription_id', priorId)
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })

  const execItems = (execRows ?? []) as Pick<ExecutionItem, 'title' | 'status' | 'phase'>[]
  const executionSummary = buildExecutionSummary(execItems)

  return {
    discoveryId: disc.id,
    discovery: disc.payload,
    priorContext: {
      mode,
      priorContent: prior.content,
      executionSummary,
    },
  }
}

function buildExecutionSummary(
  items: Pick<ExecutionItem, 'title' | 'status' | 'phase'>[],
): string {
  if (items.length === 0) return '（原处方暂无执行项记录）'

  const done = items.filter(i => i.status === 'completed')
  const inProgress = items.filter(i => i.status === 'in_progress')
  const pending = items.filter(i => i.status === 'pending')
  const skipped = items.filter(i => i.status === 'skipped')

  const lines: string[] = [
    `共 ${items.length} 项：已完成 ${done.length} / 进行中 ${inProgress.length} / 待处理 ${pending.length} / 已跳过 ${skipped.length}`,
    '',
  ]
  if (done.length > 0) {
    lines.push('**已完成的动作（成果已落地，不要重复）**：')
    done.forEach(i => lines.push(`  - ✓ [P${i.phase}] ${i.title}`))
  }
  if (inProgress.length > 0) {
    lines.push('**进行中的动作**：')
    inProgress.forEach(i => lines.push(`  - ◐ [P${i.phase}] ${i.title}`))
  }
  if (pending.length > 0) {
    lines.push('**待处理的动作**：')
    pending.forEach(i => lines.push(`  - ○ [P${i.phase}] ${i.title}`))
  }
  return lines.join('\n')
}

// ─── SSE Stream builder ───────────────────────────────────────────────────────

function streamHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeHuatuoStream(
  clientId: string,
  discoveryId: string,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  goal: GoalRow | null,
  priorMeta?: PriorMeta,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch {/* */}
      }, HEARTBEAT_INTERVAL_MS)

      const sendEvent = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {/* connection closed */}
      }

      // 1. 插入 generating 行（补充/修订时带上关系字段, DAPE W4 填 goal_id + version）
      let prescriptionId: string | null = null
      try {
        // DAPE W4: 算同 Goal 下下一版本号
        const nextVersion = await computeNextVersion(goal?.id ?? null)

        const insertRow: Record<string, unknown> = {
          client_id:     clientId,
          discovery_id:  discoveryId,
          run_id:        null,
          status:        'generating',
          intake,
          content:       null,
          agent_name:    'huatuo',
          progress_note: '排队中…',
          generated_at:  new Date().toISOString(),
          goal_id:       goal?.id ?? null,     // DAPE W4: 一对一
          version:       nextVersion,           // DAPE W4: 版本化 (v1/v2/v3)
        }
        if (priorMeta) {
          insertRow[priorMeta.relationField] = priorMeta.priorPrescriptionId
        }

        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from('prescriptions')
          .insert(insertRow)
          .select('id')
          .single<{ id: string }>()

        if (insertErr || !inserted) {
          sendEvent({ type: 'error', error: `创建处方草稿失败: ${insertErr?.message ?? 'unknown'}` })
          clearInterval(heartbeat)
          controller.close()
          return
        }
        prescriptionId = inserted.id
        sendEvent({ type: 'started', prescription_id: prescriptionId })
      } catch (err) {
        sendEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) })
        clearInterval(heartbeat)
        controller.close()
        return
      }

      // Phase 23.D.2: Non-blocking memory load
      const memoryContext = await loadMemoryForClient(supabaseAdmin, clientId, {
        maxRecentDecisions: 5,
      })

      // 2. 执行华佗（补充/修订模式带 priorContext，附 L3 记忆上下文，DAPE W4 附 Goal）
      try {
        const result = await runHuatuo(supabaseAdmin, discovery, intake, {
          priorContext: priorMeta?.priorContext,
          memoryContext,
          goal,    // DAPE W4: 一对一 Goal 注入 prompt
          onProgress: async (note) => {
            sendEvent({ type: 'progress', note })
            if (prescriptionId) {
              await supabaseAdmin
                .from('prescriptions')
                .update({ progress_note: note })
                .eq('id', prescriptionId)
                .eq('client_id', clientId)
            }
          },
        })

        // 3. 写回 DB
        await supabaseAdmin
          .from('prescriptions')
          .update({
            status:          'draft',
            content:         result.content,
            self_grade:      result.self_grade,
            agent_version:   result.meta.agent_version,
            benchmarks_used: result.benchmarks_used,
            generation_meta: { ...result.meta, trend_summary: result.trend_summary },
            progress_note:   null,
            error_message:   null,
          })
          .eq('id', prescriptionId!)
          .eq('client_id', clientId)

        // 4. 案例库存档（静默，不阻塞主流程）
        savePrescriptionCase(supabaseAdmin, {
          clientId,
          discoveryId,
          prescriptionId: prescriptionId!,
          industryCategory: mapIndustryToCategory(discovery.business.industry),
          crisisType: deriveCrisisType(intake.priority_dimensions),
          monthlyBudgetAud: intake.monthly_budget_aud,
          market: 'AU',
          businessSize: 'small',
          prescriptionSummary: result.content.summary?.slice(0, 500) ?? null,
          selfGradeOverall: result.self_grade.overall ?? null,
        }).catch(err => console.warn('[prescription/generate] case save failed:', err))

        // 5. 通过流发完整结果给前端
        sendEvent({
          type: 'done',
          prescription_id: prescriptionId,
          content: result.content,
          self_grade: result.self_grade,
          meta: result.meta,
          trend_summary: result.trend_summary,
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[huatuo/stream] failed', { prescriptionId, message })

        if (prescriptionId) {
          await supabaseAdmin
            .from('prescriptions')
            .update({
              status:        'failed',
              error_message: message,
              progress_note: null,
            })
            .eq('id', prescriptionId)
            .eq('client_id', clientId)
        }
        sendEvent({ type: 'error', error: message })
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })
}

/**
 * POST /api/clients/[id]/prescription/generate
 *
 * 3 种生成模式：
 *   - 普通生成    body.discovery_id      — 从张骞 discovery 全新开方
 *   - 补充处方    body.supplement_of     — 为已有处方生成增量动作（原处方不动）
 *   - 修订处方    body.revise            — 为方向需调整的处方生成 v2
 *   - legacy      body.run_id            — diagnostic run（同步小路径）
 *
 * 补充/修订模式：从原处方 derive discovery_id，加载原处方全文 + 执行进度，
 * 作为 priorContext 传给华佗。
 *
 * Response: text/event-stream（SSE）
 * Security: logged-in session. OPC or this client's own FDE (requireOperatorAccess).
 * Reference: ROADMAP.md P8.10.S3 / S5
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { generatePrescription } from '@/lib/diagnostic/prescription-generator'
import { schedulePrescriptionGeneration } from '@/lib/huatuo/prescription-job'
import type {
  PrescriptionIntake, PrescriptionContent, PriorPrescriptionContext,
  ExecutionItem,
} from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import { prepareBudgetIntake } from '@/lib/ads/budget-currency'
import { getGoalById, listActiveGoals } from '@/lib/strategy/goals'
import { attachPlanSeed } from '@/lib/ads-strategy/plan-seed/attach'
import { afterPrescriptionDraftSaved } from '@/lib/marketing-plan/promo/plan-draft-hook'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

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
  // Drafting stays open to this client's FDE. requireGlobalAdmin would lock them out.
  const access = await requireOperatorAccess(clientId)
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
  const prepared = prepareBudgetIntake(body.intake)
  if (!prepared.ok) return errorResponse(400, prepared.error)
  const intake = prepared.intake
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
    return startHuatuoJob(clientId, prep.discoveryId, prep.discovery, intake, goal, priorMeta)
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

    return startHuatuoJob(clientId, row.id, row.payload, intake, goal)
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

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function acceptedResponse(prescriptionId: string): Response {
  return new Response(JSON.stringify({
    success: true,
    prescription_id: prescriptionId,
    status: 'generating',
  }), {
    status: 202,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

/** 插入 generating 行后立刻返回。模型调用不在这次请求里等。 */
async function startHuatuoJob(
  clientId: string,
  discoveryId: string,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  goal: GoalRow | null,
  priorMeta?: PriorMeta,
): Promise<Response> {
  try {
    const insertedId = await insertGeneratingRow(clientId, discoveryId, intake, goal, priorMeta)
    if ('error' in insertedId) return errorResponse(500, insertedId.error)
    schedulePrescriptionGeneration({
      clientId,
      prescriptionId: insertedId.id,
      discoveryId,
      discovery,
      intake,
      goal,
      priorContext: priorMeta?.priorContext,
    })
    return acceptedResponse(insertedId.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return errorResponse(500, message)
  }
}

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

        // 2b. 用事实构建计划草稿种子（永不抛错；失败时不写 plan_seed）
        result.content = await attachPlanSeed(result.content, { clientId, goalId: goal?.id ?? null }).catch(() => result.content)

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

        await afterPrescriptionDraftSaved({
          clientId,
          prescriptionId: prescriptionId!,
        })

        // 4. 案例库存档（静默，不阻塞主流程）
        savePrescriptionCase(supabaseAdmin, {
          clientId,
          discoveryId,
          prescriptionId: prescriptionId!,
          industryCategory: mapIndustryToCategory(discovery.business.industry),
          crisisType: deriveCrisisType(intake.priority_dimensions),
          monthlyBudgetAud: audOnlyAmount(intake.monthly_budget_aud, intake.budget_currency),
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

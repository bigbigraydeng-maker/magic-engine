/**
 * 把华佗开方 / 精修从 HTTP 请求里挪走。
 *
 * 请求只负责建好「生成中」的处方行并立刻返回。真正调模型写在网站进程里，
 * 跟张骞发现、行程生成同一套：先回执，再后台跑，结果写回这一行。
 * 不用另一套任务表，也不走 Inngest——Inngest 的执行请求打的是同一条被
 * 代理的网站地址，120 秒的模型调用会再次撞上大约 100 秒的等待上限。
 * 回执就在 prescriptions 这一行：status、error_message、generation_meta。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { runHuatuo, refineHuatuoPrescription } from '@/lib/huatuo/agent'
import type { PrescriptionIntake, PrescriptionContent, PriorPrescriptionContext } from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { HuatuoPrescriptionResult, SelfGrade, SelfGradeWeakness } from '@/lib/huatuo/types'
import { savePrescriptionCase, deriveCrisisType } from '@/lib/case-library/saver'
import { audOnlyAmount } from '@/lib/ads/budget-currency'
import { mapIndustryToCategory } from '@/lib/huatuo/industry-mapper'
import { loadMemoryForClient } from '@/lib/memory'
import { buildEffectJudgmentCard, type EffectJudgmentCard } from '@/lib/ads-strategy/effect-judgment/card'
import { loadEffectJudgmentCard } from '@/lib/ads-strategy/effect-judgment/load'
import { attachPlanSeed } from '@/lib/ads-strategy/plan-seed/attach'
import { afterPrescriptionDraftSaved } from '@/lib/marketing-plan/promo/plan-draft-hook'

export interface GenerationJobInput {
  clientId: string
  prescriptionId: string
  discoveryId: string
  discovery: DiscoveryReport
  intake: PrescriptionIntake
  goal: GoalRow | null
  priorContext?: PriorPrescriptionContext
}

export interface RefineJobInput {
  clientId: string
  prescriptionId: string
  discovery: DiscoveryReport
  intake: PrescriptionIntake
  previousContent: PrescriptionContent
  previousWeaknesses: SelfGradeWeakness[]
  humanComments?: string
  previousPasses: number
  previousSelfGrade: SelfGrade | null
  goal: GoalRow | null
}

export function schedulePrescriptionGeneration(input: GenerationJobInput): void {
  void executePrescriptionGeneration(input).catch((err) => {
    console.error('[huatuo/generate-job] crashed', { prescriptionId: input.prescriptionId, err })
  })
}

export function schedulePrescriptionRefine(input: RefineJobInput): void {
  void executePrescriptionRefine(input).catch((err) => {
    console.error('[huatuo/refine-job] crashed', { prescriptionId: input.prescriptionId, err })
  })
}

export async function executePrescriptionGeneration(input: GenerationJobInput): Promise<void> {
  const { clientId, prescriptionId } = input
  try {
    const result = await runWithMemory(clientId, (memoryContext) => runHuatuo(
      supabaseAdmin, input.discovery, input.intake, {
        priorContext: input.priorContext,
        memoryContext,
        goal: input.goal,
        onProgress: (note) => noteProgress(clientId, prescriptionId, note),
      },
    ))
    const measure = await measureCard(clientId, input.goal, result.content)
    result.content = await attachPlanSeed(result.content, {
      clientId,
      goalId: input.goal?.id ?? null,
      effectCard: measure,
    }).catch(() => result.content)
    await persistDraft(clientId, prescriptionId, result, true, measure)
    await draftPlanAfterSave(clientId, prescriptionId)
    archiveCase(input, result)
  } catch (err) {
    await markTerminal(clientId, prescriptionId, 'failed', messageOf(err))
  }
}

export async function executePrescriptionRefine(input: RefineJobInput): Promise<void> {
  const { clientId, prescriptionId } = input
  try {
    const result = await runWithMemory(clientId, (memoryContext) => refineHuatuoPrescription(
      supabaseAdmin, input.discovery, input.intake, input.previousContent, input.previousWeaknesses, {
        humanComments: input.humanComments,
        previousPasses: input.previousPasses,
        previousSelfGrade: input.previousSelfGrade,
        memoryContext,
        goal: input.goal,
        onProgress: (note) => noteProgress(clientId, prescriptionId, note),
      },
    ))
    // 精修重写了内容：用新内容的打法重建计划草稿种子（某阶段打法被校验整组丢掉时，按阶段号带回上一版该阶段的；LLM 没写的阶段不补）
    const measure = await measureCard(clientId, input.goal, result.content)
    result.content = await attachPlanSeed(result.content, {
      clientId,
      goalId: input.goal?.id ?? null,
      priorContent: input.previousContent,
      effectCard: measure,
    }).catch(() => result.content)
    await persistDraft(clientId, prescriptionId, result, false, measure)
    await draftPlanAfterSave(clientId, prescriptionId)
  } catch (err) {
    await markTerminal(clientId, prescriptionId, 'draft', messageOf(err))
  }
}

/** Unapproved plan draft follow-up. Never changes prescription status, even if it throws. */
async function draftPlanAfterSave(clientId: string, prescriptionId: string): Promise<void> {
  try {
    await afterPrescriptionDraftSaved({ clientId, prescriptionId })
  } catch (err) {
    console.warn('[huatuo/prescription-job] plan draft follow-up failed', { prescriptionId, err })
  }
}

async function runWithMemory(
  clientId: string,
  run: (memoryContext: Awaited<ReturnType<typeof loadMemoryForClient>>) => Promise<HuatuoPrescriptionResult>,
): Promise<HuatuoPrescriptionResult> {
  const memoryContext = await loadMemoryForClient(supabaseAdmin, clientId, { maxRecentDecisions: 5 })
  return run(memoryContext)
}

async function noteProgress(clientId: string, prescriptionId: string, note: string): Promise<void> {
  await supabaseAdmin
    .from('prescriptions')
    .update({ progress_note: note })
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
}

async function measureCard(
  clientId: string,
  goal: GenerationJobInput['goal'],
  content: HuatuoPrescriptionResult['content'],
): Promise<EffectJudgmentCard> {
  try {
    return await loadEffectJudgmentCard({ clientId, goal, content })
  } catch (err) {
    console.warn('[effect-judgment] card failed', err instanceof Error ? err.message : 'unknown')
    return buildEffectJudgmentCard({
      goal: null,
      approvedCost: null,
      approvedCostState: 'unreadable',
      prescriptionCosts: [],
      dailyCapCents: null,
      dailyCapState: 'unreadable',
      today: '',
      actualToDate: null,
      medianCostCents: null,
      sampleDays: null,
      loadError: '量这些数时没有读成，效果判断卡先空着。',
    })
  }
}

async function persistDraft(
  clientId: string,
  prescriptionId: string,
  result: HuatuoPrescriptionResult,
  includeAgentMeta: boolean,
  measure: EffectJudgmentCard,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'draft',
    content: result.content,
    self_grade: result.self_grade,
    generation_meta: { ...result.meta, trend_summary: result.trend_summary, measure },
    progress_note: null,
    error_message: null,
  }
  if (includeAgentMeta) {
    patch.agent_version = result.meta.agent_version
    patch.benchmarks_used = result.benchmarks_used
  }
  await supabaseAdmin
    .from('prescriptions')
    .update(patch)
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
}

async function markTerminal(
  clientId: string,
  prescriptionId: string,
  status: 'failed' | 'draft',
  message: string,
): Promise<void> {
  console.error('[huatuo/prescription-job] failed', { prescriptionId, status, message })
  await supabaseAdmin
    .from('prescriptions')
    .update({ status, error_message: message, progress_note: null })
    .eq('id', prescriptionId)
    .eq('client_id', clientId)
}

function archiveCase(input: GenerationJobInput, result: HuatuoPrescriptionResult): void {
  savePrescriptionCase(supabaseAdmin, {
    clientId: input.clientId,
    discoveryId: input.discoveryId,
    prescriptionId: input.prescriptionId,
    industryCategory: mapIndustryToCategory(input.discovery.business.industry),
    crisisType: deriveCrisisType(input.intake.priority_dimensions),
    monthlyBudgetAud: audOnlyAmount(input.intake.monthly_budget_aud, input.intake.budget_currency),
    market: 'AU',
    businessSize: 'small',
    prescriptionSummary: result.content.summary?.slice(0, 500) ?? null,
    selfGradeOverall: result.self_grade.overall ?? null,
  }).catch((err) => console.warn('[prescription/generate] case save failed:', err))
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

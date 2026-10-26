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
import { attachPlanSeed } from '@/lib/ads-strategy/plan-seed/attach'

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
    result.content = await attachPlanSeed(result.content, {
      clientId,
      goalId: input.goal?.id ?? null,
    }).catch(() => result.content)
    await persistDraft(clientId, prescriptionId, result, true)
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
    result.content = await attachPlanSeed(result.content, {
      clientId,
      goalId: input.goal?.id ?? null,
      priorContent: input.previousContent,
    }).catch(() => result.content)
    await persistDraft(clientId, prescriptionId, result, false)
  } catch (err) {
    await markTerminal(clientId, prescriptionId, 'draft', messageOf(err))
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

async function persistDraft(
  clientId: string,
  prescriptionId: string,
  result: HuatuoPrescriptionResult,
  includeAgentMeta: boolean,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: 'draft',
    content: result.content,
    self_grade: result.self_grade,
    generation_meta: { ...result.meta, trend_summary: result.trend_summary },
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

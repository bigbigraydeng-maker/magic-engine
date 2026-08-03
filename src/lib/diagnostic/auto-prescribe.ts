/**
 * 处方周更 —— 补上 DAPE 的 P 段（处方）。
 *
 * 体检（A 段）2026-08-03 已经接上周更。但只接 A 不接 P，等于每周产出一份新报告
 * 然后没人把它变成活儿 —— 库里的事实：真实客户最后一份方案是 5 月 14/15 号出的，
 * 之后再没出过第二份；4 份草稿从 5 月躺到今天，既没批准也没拒绝，就那么烂着。
 * 目标最近一次新建是 6/19，战役是 6/8。执行看板天天在转，转的是两个多月前的结论。
 *
 * 🔴 谁消费（PM 2026-08-04 拍板）：**不是 PM 的眼睛，是执行看板。**
 *    方案自动落地（派生 Initiative + 生成执行项），待办里只出一条通知让 PM 知情。
 *    理由：方案本身不花钱也不对外，落地只是变成看板上的待做动作 ——
 *    真要花钱 / 真要对外发布时，原来那道授权闸门还在。
 *    要 PM 一份份点头的方案，就是 5 月那 4 份草稿的下场。
 *
 * 🔴 为什么单独一个定时任务，不塞进体检里：
 *    体检本身已经是六维度全量采集 × 3 个客户串行，再串一轮 AI 出方容易超时；
 *    更要紧的是**失败要能分辨** —— 混在一起跑，挂了只知道"这周没结果"，
 *    分不清是体检没采到还是方案没生成。周二跑，正好吃周一体检的结果。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiagnosticDimension, PrescriptionIntake, TimelineUrgency } from '@/types/diagnostic'
import type { GoalRow } from '@/types/strategy'
import { generatePrescription } from './prescription-generator'
import { landPrescription } from './prescription-landing'
import { listActiveGoals } from '@/lib/strategy/goals'

/** 体检结果多新才算「这周的」—— 周更任务，给一周多一点余量。 */
export const DIAGNOSIS_FRESH_DAYS = 8

/** 同一客户多久内出过方就不再出 —— 防手工刚开完方定时任务又来一份。 */
export const REPRESCRIBE_COOLDOWN_DAYS = 6

/** 交给 AI 的重点维度取几个 —— 全给等于没重点。 */
const PRIORITY_DIMENSION_COUNT = 3

export interface CompletedRun {
  id: string
  clientId: string
  createdAt: Date
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null
}

export type PrescribeSkipReason =
  | 'no_fresh_diagnosis'
  | 'prescribed_recently'
  | 'no_active_goal'

export interface PrescribeCandidate {
  clientId: string
  runId: string
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null
}

export interface PrescribeSkip {
  clientId: string
  reason: PrescribeSkipReason
  detail: string
}

/**
 * 谁该出方。纯函数 —— 「给错客户开方」跟「给错客户做体检」一样贵，
 * 而且更难发现：错的方案会变成看板上真的动作。
 */
export function pickPrescribeCandidates(
  runs: CompletedRun[],
  lastPrescribedByClient: Map<string, Date>,
  now: Date,
): { candidates: PrescribeCandidate[]; skipped: PrescribeSkip[] } {
  const candidates: PrescribeCandidate[] = []
  const skipped: PrescribeSkip[] = []

  // 一个客户这周可能跑过不止一次体检 —— 只认最新那次
  const newestByClient = new Map<string, CompletedRun>()
  for (const r of runs) {
    const cur = newestByClient.get(r.clientId)
    if (!cur || r.createdAt > cur.createdAt) newestByClient.set(r.clientId, r)
  }

  for (const run of Array.from(newestByClient.values())) {
    const ageDays = (now.getTime() - run.createdAt.getTime()) / 86_400_000
    if (ageDays > DIAGNOSIS_FRESH_DAYS) {
      skipped.push({
        clientId: run.clientId,
        reason: 'no_fresh_diagnosis',
        detail: `最近一次体检是 ${ageDays.toFixed(0)} 天前，太旧了 —— 照旧结果开方等于开错药`,
      })
      continue
    }

    const last = lastPrescribedByClient.get(run.clientId)
    if (last) {
      const days = (now.getTime() - last.getTime()) / 86_400_000
      if (days < REPRESCRIBE_COOLDOWN_DAYS) {
        skipped.push({
          clientId: run.clientId,
          reason: 'prescribed_recently',
          detail: `${days.toFixed(1)} 天前刚出过方案（冷却 ${REPRESCRIBE_COOLDOWN_DAYS} 天）`,
        })
        continue
      }
    }

    candidates.push({
      clientId: run.clientId,
      runId: run.id,
      dimensionScores: run.dimensionScores,
    })
  }

  return { candidates, skipped }
}

/**
 * 体检里得分最低的几个维度 —— 交给 AI 当「这次重点看哪几块」。
 *
 * 🔴 没采到分数的维度（null）**不算最低**。
 *    null 是"这次没采着"，不是"零分"。把没采到的当最差报上去，
 *    AI 会照着一块根本没数据的地方开方 —— 这是编，不是分析。
 */
export function lowestDimensions(
  scores: Partial<Record<DiagnosticDimension, number | null>> | null,
  count: number = PRIORITY_DIMENSION_COUNT,
): DiagnosticDimension[] {
  if (!scores) return []
  const scored = Object.entries(scores)
    .filter((e): e is [string, number] => typeof e[1] === 'number')
    .sort((a, b) => a[1] - b[1])
    .slice(0, count)
  return scored.map(([dim]) => dim as DiagnosticDimension)
}

/** 目标离到期还有多久 → 紧迫度。纯粹按日期算，不猜。 */
export function urgencyFromGoal(goal: GoalRow, now: Date): TimelineUrgency {
  if (!goal.period_end) return 'short_term'
  const days = (new Date(goal.period_end).getTime() - now.getTime()) / 86_400_000
  if (days <= 45) return 'immediate'
  if (days <= 120) return 'short_term'
  return 'long_term'
}

/**
 * 这次开方按什么来。
 *
 * 🔴 优先照抄上一份方案的 intake —— 那是 PM/FDE 当初真填的业务意图，
 *    系统没有资格替他改写。只有从没开过方的客户才现推，
 *    而且每一项都指得出来源（目标标题 / 目标预算 / 目标结束日 / 体检分数），
 *    不许出现任何"看起来合理"的编造值。
 */
export function buildIntake(
  goal: GoalRow,
  dimensionScores: Partial<Record<DiagnosticDimension, number | null>> | null,
  priorIntake: PrescriptionIntake | null,
  now: Date,
): PrescriptionIntake {
  if (priorIntake) return priorIntake

  const priority = lowestDimensions(dimensionScores)
  return {
    business_goal: goal.title,
    timeline_urgency: urgencyFromGoal(goal, now),
    // 目标没填预算就是 0 —— 宁可让 AI 知道"没预算"，也不替客户编一个数
    monthly_budget_aud: goal.budget_amount ?? 0,
    priority_dimensions: priority,
    notes:
      `本次开方口径由系统按客户目标《${goal.title}》与本周体检自动推得` +
      (priority.length > 0 ? `，重点维度取体检最低分的 ${priority.join(' / ')}` : '，本周体检未采到任何维度分数') +
      '。该客户此前没有人工填过开方口径。',
  }
}

// ── 编排 ──────────────────────────────────────────────────────────────────────

export interface PrescribeOutcome {
  clientId: string
  clientName: string
  result: 'prescribed' | 'skipped' | 'error'
  prescriptionId?: string
  goalTitle?: string
  executionItems?: number
  detail?: string
}

export interface AutoPrescribeSummary {
  considered: number
  prescribed: number
  outcomes: PrescribeOutcome[]
}

export async function runAutoPrescribe(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<AutoPrescribeSummary> {
  const since = new Date(now.getTime() - DIAGNOSIS_FRESH_DAYS * 86_400_000).toISOString()

  const { data: runRows, error: runErr } = await supabase
    .from('diagnostic_runs')
    .select('id, client_id, created_at, dimension_scores')
    .eq('status', 'completed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (runErr) throw new Error(`diagnostic_runs query failed: ${runErr.message}`)

  const runs: CompletedRun[] = ((runRows ?? []) as Array<{
    id: string
    client_id: string
    created_at: string
    dimension_scores: Partial<Record<DiagnosticDimension, number | null>> | null
  }>).map((r) => ({
    id: r.id,
    clientId: r.client_id,
    createdAt: new Date(r.created_at),
    dimensionScores: r.dimension_scores,
  }))

  // 每个客户最近一次开方时间 + 最近一份 intake，一次查回来
  const { data: presRows } = await supabase
    .from('prescriptions')
    .select('client_id, created_at, intake')
    .order('created_at', { ascending: false })
    .limit(500)

  const lastPrescribed = new Map<string, Date>()
  const priorIntake = new Map<string, PrescriptionIntake>()
  for (const p of (presRows ?? []) as Array<{
    client_id: string
    created_at: string
    intake: PrescriptionIntake | null
  }>) {
    if (!lastPrescribed.has(p.client_id)) lastPrescribed.set(p.client_id, new Date(p.created_at))
    if (p.intake && !priorIntake.has(p.client_id)) priorIntake.set(p.client_id, p.intake)
  }

  const { candidates, skipped } = pickPrescribeCandidates(runs, lastPrescribed, now)

  const clientIds = Array.from(new Set([...candidates, ...skipped].map((x) => x.clientId)))
  const { data: clientRows } = await supabase
    .from('clients')
    .select('id, name')
    .in('id', clientIds.length > 0 ? clientIds : ['00000000-0000-0000-0000-000000000000'])
  const nameOf = new Map(
    ((clientRows ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  )

  const outcomes: PrescribeOutcome[] = skipped.map((s) => ({
    clientId: s.clientId,
    clientName: nameOf.get(s.clientId) ?? s.clientId,
    result: 'skipped' as const,
    detail: s.detail,
  }))

  let prescribed = 0
  // 串行：每份方案都要打一次 AI，并行只会互相抢额度，而这是周更任务，不赶时间
  for (const cand of candidates) {
    const clientName = nameOf.get(cand.clientId) ?? cand.clientId
    try {
      const goals = await listActiveGoals(supabase, cand.clientId)
      if (goals.length === 0) {
        outcomes.push({
          clientId: cand.clientId,
          clientName,
          result: 'skipped',
          detail: '这个客户没有进行中的目标，方案无从挂起 —— 先给他定个目标',
        })
        continue
      }
      // 多个进行中目标时挂最近建的那个（listActiveGoals 已按创建时间倒序）。
      // 挂哪个会写进待办通知，PM 一眼能看出挂错了。
      const goal = goals[0]

      const intake = buildIntake(goal, cand.dimensionScores, priorIntake.get(cand.clientId) ?? null, now)
      const { prescriptionId, content } = await generatePrescription(
        supabase,
        cand.runId,
        cand.clientId,
        intake,
      )

      // generatePrescription 存的是不挂目标的裸草稿，补上目标与版本号
      const { data: verRow } = await supabase
        .from('prescriptions')
        .select('version')
        .eq('goal_id', goal.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle<{ version: number }>()
      const nextVersion = (verRow?.version ?? 0) + 1

      const { error: linkErr } = await supabase
        .from('prescriptions')
        .update({ goal_id: goal.id, version: nextVersion })
        .eq('id', prescriptionId)
      if (linkErr) throw new Error(`处方挂目标失败：${linkErr.message}`)

      const landed = await landPrescription(
        supabase,
        {
          id: prescriptionId,
          client_id: cand.clientId,
          goal_id: goal.id,
          version: nextVersion,
          // 必须带上正文 —— 派生 Initiative 读的是 content.phases[].initiative_seed，
          // 传 null 会静默派生 0 个，方案就只剩执行项、挂不到目标下
          content,
          supersedes_id: null,
        },
        'prescription-weekly（自动落地）',
      )

      prescribed += 1
      outcomes.push({
        clientId: cand.clientId,
        clientName,
        result: 'prescribed',
        prescriptionId,
        goalTitle: goal.title,
        executionItems: landed.executionItems,
        detail: landed.notes.join('；'),
      })
    } catch (e) {
      // 一个客户失败不拖累其他客户，但原因必须留下
      outcomes.push({
        clientId: cand.clientId,
        clientName,
        result: 'error',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { considered: candidates.length + skipped.length, prescribed, outcomes }
}

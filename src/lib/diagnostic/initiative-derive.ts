/**
 * DAPE Week 2 W4 — Initiative 派生 (BUG-FMT-F21 修法核心)
 *
 * 处方批准时, 把 phases[].initiative_seed 自动 batch insert 到 initiatives 表.
 * Phase 31 三层骨架 (Goal → Initiative → Action) 闭环 — FDE 不再手动建 Initiative.
 *
 * Spec: docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md §2.3.5
 *
 * 不破坏规则:
 *   - 同 Goal 已有 active initiatives 一律保留 (防止误删 CTS 4 个 active goal 现有 initiatives)
 *   - phase.initiative_seed 缺 / NULL → 跳过该 phase, 不插入
 *   - 处方无 goal_id (legacy) → 整体跳过 (不能没头没脑插)
 *   - supporting 类型必须能匹配到一个 terminal sibling, 否则 fallback unassigned
 *   - 任何失败不阻塞批准 — Initiative 派生失败只 console.warn, 处方仍标 approved
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Prescription,
  PrescriptionContent,
  PrescriptionPhase,
  PhaseInitiativeSeed,
} from '@/types/diagnostic'
import type { InitiativeType, InitiativePosture } from '@/types/strategy'
import { INITIATIVE_TYPE_TIER } from '@/types/strategy'
import { createInitiative, listInitiativesForGoal } from '@/lib/strategy/initiatives'

export interface DeriveInitiativesResult {
  /** 实际插入的 Initiative 数量 */
  inserted: number
  /** 因数据问题或重复跳过的 phases */
  skipped: number
  /** 派生过程的人话日志 (用于 console + 未来 UI 展示) */
  notes: string[]
  /** Initiative ID 按 phase_number 顺序 (派生后用于跟 execution_items 关联) */
  initiativeIdsByPhase: Record<number, string>
}

/**
 * 从处方派生 Initiatives. 幂等: 同 Goal 已有同 title 的 Initiative 跳过.
 *
 * @param supabase service-role client (RLS bypass)
 * @param prescription 已加载的处方 (含 content + goal_id + version)
 * @returns 派生统计 + ID map
 */
export async function deriveInitiativesFromPrescription(
  supabase: SupabaseClient,
  prescription: Pick<Prescription, 'id' | 'client_id' | 'goal_id' | 'version' | 'content'>,
): Promise<DeriveInitiativesResult> {
  const empty: DeriveInitiativesResult = {
    inserted: 0,
    skipped: 0,
    notes: [],
    initiativeIdsByPhase: {},
  }

  if (!prescription.goal_id) {
    empty.notes.push('Prescription has no goal_id (legacy 模式), skipped Initiative derivation')
    return empty
  }
  if (!prescription.content) {
    empty.notes.push('Prescription content empty, skipped')
    return empty
  }

  // 已有的 Initiatives — 防止重复派生 (CTS 4 active goals 安全保护)
  const existing = await listInitiativesForGoal(supabase, prescription.goal_id, { includeArchived: false })
  // 🔴 存的是 title → id，不是光存 title。
  //    原来是 Set：撞上同名就只回一个 skipped，**不回那条已有 Initiative 的 id**，
  //    于是这个阶段的执行项 initiative_id 全是 null、在按目标筛的看板上一条都看不见。
  //    而处方提示词恰恰在往「标题稳定」上推（跟阶段名一致、用客户看得懂的话），
  //    标题越听话越容易撞，动作就越挂不上 —— 幂等保护反而成了挂载杀手。
  //    改成回传已有 id：重名不是「丢掉」，是「重新挂回那条已有的战线」，
  //    这才是幂等本来该干的事。
  const existingTitles = new Map(
    existing.map(i => [i.title.trim().toLowerCase(), i.id] as const),
  )

  // 🔴 目标没填预算时，一律不给 Initiative 传预算占比。
  //    占比在这种情况下算出来是 null（createInitiative 里要目标有预算才折算金额），
  //    什么都不影响 —— 但它会去撞「同目标占比之和 ≤ 100%」那道闸。
  //    库里实测：CTS《Best of China》已被 FDE 的 3 条战线占了 70%，
  //    任何正常的三阶段切分（40/35/25 之类）第一周就有 2/3 挂不上；
  //    而旧战线从不归档，基数只涨不落，两三周后新方案一条都插不进去 ——
  //    整条派生链会自己勒死，回到「动作全部未归类」的原状。
  //    一个什么都不影响的数字，不该有权掐死链条。
  const goalHasBudget = await goalHasBudgetAmount(supabase, prescription.goal_id)

  // 先 pass 1: 收集 terminal initiatives (phase_number → inserted id)
  // 再 pass 2: 解析 supporting 的 supports_phase_number → 真 initiative_id
  const phasesWithSeed: Array<{ phase: PrescriptionPhase; seed: PhaseInitiativeSeed }> = []
  for (const phase of prescription.content.phases) {
    if (!phase.initiative_seed) {
      empty.notes.push(`phase ${phase.phase_number}: 无 initiative_seed, 跳过 (legacy 模式可接受)`)
      empty.skipped++
      continue
    }
    phasesWithSeed.push({ phase, seed: phase.initiative_seed })
  }

  if (phasesWithSeed.length === 0) {
    empty.notes.push('No phases with initiative_seed, no Initiatives derived (legacy 处方)')
    return empty
  }

  // 至少 1 个 terminal — 不强制改, 但记日志
  const hasTerminal = phasesWithSeed.some(p => INITIATIVE_TYPE_TIER[p.seed.initiative_type] === 'terminal')
  if (!hasTerminal) {
    empty.notes.push('⚠️ 警告: 处方所有 phases 都是 supporting type — FDE 应手动加 terminal Initiative')
  }

  const result: DeriveInitiativesResult = {
    inserted: 0,
    skipped: empty.skipped,     // 累加之前缺 seed 的 phase
    notes: [...empty.notes],
    initiativeIdsByPhase: {},
  }

  // Pass 1: 先建 terminal initiatives (它们要给 supporting 当 parent)
  const terminalPhases = phasesWithSeed.filter(
    p => INITIATIVE_TYPE_TIER[p.seed.initiative_type] === 'terminal',
  )
  const supportingPhases = phasesWithSeed.filter(
    p => INITIATIVE_TYPE_TIER[p.seed.initiative_type] === 'supporting',
  )

  // 认不出来的类型不能静默蒸发：AI 哪天飘出个没见过的值，
  // 那个阶段既不算 terminal 也不算 supporting，两趟循环都不碰它 ——
  // 结果是这个阶段凭空消失，skipped 不加、日志一个字都没有。
  for (const { phase, seed } of phasesWithSeed) {
    if (INITIATIVE_TYPE_TIER[seed.initiative_type]) continue
    result.skipped++
    result.notes.push(
      `⚠️ phase ${phase.phase_number}: 不认识的战线类型 "${seed.initiative_type}"，这个阶段没能挂到目标下`,
    )
  }

  for (const { phase, seed } of terminalPhases) {
    const r = await tryCreateInitiative(
      supabase, prescription, phase, seed, existingTitles, undefined, goalHasBudget,
    )
    // 🔴 先认 id，再看 skipped：撞上同名时两者会同时出现 ——
    //    没新建（skipped）但拿到了已有那条的 id，动作照样要挂上去。
    if (r.id) result.initiativeIdsByPhase[phase.phase_number] = r.id
    if (r.skipped) {
      result.skipped++
      result.notes.push(`phase ${phase.phase_number}: ${r.reason}`)
    } else if (r.id) {
      result.inserted++
      result.notes.push(`✓ phase ${phase.phase_number}: terminal Initiative "${seed.title}" 已派生 (id=${r.id.slice(0, 8)}…)`)
    }
  }

  // Pass 2: supporting initiatives (需指向 terminal)
  for (const { phase, seed } of supportingPhases) {
    // 找一个 terminal sibling 当 parent (优先 seed.supports_phase_number, fallback 任意 terminal)
    let parentInitiativeId: string | undefined
    if (seed.supports_phase_number != null) {
      parentInitiativeId = result.initiativeIdsByPhase[seed.supports_phase_number]
    }
    if (!parentInitiativeId) {
      // 没指定或指定的 phase 跳过了 — fallback 用本批次第一个 terminal
      const firstTerminalId = Object.entries(result.initiativeIdsByPhase)[0]?.[1]
      // 或者用 goal 已有的第一个 terminal Initiative
      const existingTerminal = existing.find(i => i.tier === 'terminal' && !i.is_archived)
      parentInitiativeId = firstTerminalId ?? existingTerminal?.id
    }

    if (!parentInitiativeId && seed.initiative_type !== 'unassigned') {
      // 没有 terminal sibling, supporting 没法挂 — 降级为 unassigned
      result.notes.push(`⚠️ phase ${phase.phase_number}: supporting "${seed.title}" 无 terminal parent, 降级为 unassigned`)
      const r = await tryCreateInitiative(
        supabase, prescription, phase,
        { ...seed, initiative_type: 'unassigned' },
        existingTitles, undefined, goalHasBudget,
      )
      if (r.id) result.initiativeIdsByPhase[phase.phase_number] = r.id
      if (r.skipped) {
        result.skipped++
      } else if (r.id) {
        result.inserted++
      }
      continue
    }

    const r = await tryCreateInitiative(
      supabase, prescription, phase, seed, existingTitles, parentInitiativeId, goalHasBudget,
    )
    if (r.id) result.initiativeIdsByPhase[phase.phase_number] = r.id
    if (r.skipped) {
      result.skipped++
      result.notes.push(`phase ${phase.phase_number}: ${r.reason}`)
    } else if (r.id) {
      result.inserted++
      result.notes.push(`✓ phase ${phase.phase_number}: supporting Initiative "${seed.title}" 已派生 (id=${r.id.slice(0, 8)}…)`)
    }
  }

  return result
}

interface SingleResult {
  skipped: boolean
  id?: string
  reason?: string
}

/** 目标有没有填预算 —— 决定要不要给派生出的 Initiative 传预算占比。 */
async function goalHasBudgetAmount(supabase: SupabaseClient, goalId: string): Promise<boolean> {
  const { data } = await supabase
    .from('goals')
    .select('budget_amount')
    .eq('id', goalId)
    .maybeSingle<{ budget_amount: number | null }>()
  return data?.budget_amount != null
}

async function tryCreateInitiative(
  supabase: SupabaseClient,
  prescription: Pick<Prescription, 'id' | 'client_id' | 'goal_id' | 'version'>,
  phase: PrescriptionPhase,
  seed: PhaseInitiativeSeed,
  existingTitles: Map<string, string>,
  supportsInitiativeId: string | undefined,
  goalHasBudget: boolean,
): Promise<SingleResult> {
  const title = seed.title?.trim() || phase.name?.trim() || `处方 v${prescription.version} - 阶段 ${phase.phase_number}`
  const titleKey = title.toLowerCase()

  // 幂等: 同 Goal 同 title 已有 → 不新建，但**把已有那条的 id 回传**，
  // 这个阶段的动作照样挂得上去（见文件上方那段说明）
  const existingId = existingTitles.get(titleKey)
  if (existingId) {
    return {
      skipped: true,
      id: existingId,
      reason: `已存在同名 Initiative "${title}", 复用它 (幂等保护)`,
    }
  }

  // 校验 budget_percent 范围 (策略层会再校验, 这里防御性)。
  // 目标没填预算时一律不传 —— 免得一个不影响任何事的数字去撞 100% 上限
  const budgetPercent = goalHasBudget && seed.budget_percent != null
    ? Math.max(0, Math.min(100, seed.budget_percent))
    : undefined

  const r = await createInitiative(supabase, {
    goal_id: prescription.goal_id!,
    initiative_type: seed.initiative_type as InitiativeType,
    title,
    posture: (seed.posture ?? undefined) as InitiativePosture | undefined,
    budget_percent: budgetPercent,
    hypothesis: seed.hypothesis ?? undefined,
    supports_initiative_id: supportsInitiativeId,
    sort_order: phase.phase_number,
  })

  if (!r.ok || !r.initiative) {
    return { skipped: true, reason: r.error ?? 'createInitiative 失败' }
  }

  existingTitles.set(titleKey, r.initiative.id)  // 防止本批次重复
  return { skipped: false, id: r.initiative.id }
}

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
  const existingTitles = new Set(existing.map(i => i.title.trim().toLowerCase()))

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

  for (const { phase, seed } of terminalPhases) {
    const r = await tryCreateInitiative(supabase, prescription, phase, seed, existingTitles, undefined)
    if (r.skipped) {
      result.skipped++
      result.notes.push(`phase ${phase.phase_number}: ${r.reason}`)
    } else if (r.id) {
      result.inserted++
      result.initiativeIdsByPhase[phase.phase_number] = r.id
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
        existingTitles, undefined,
      )
      if (r.skipped) {
        result.skipped++
      } else if (r.id) {
        result.inserted++
        result.initiativeIdsByPhase[phase.phase_number] = r.id
      }
      continue
    }

    const r = await tryCreateInitiative(supabase, prescription, phase, seed, existingTitles, parentInitiativeId)
    if (r.skipped) {
      result.skipped++
      result.notes.push(`phase ${phase.phase_number}: ${r.reason}`)
    } else if (r.id) {
      result.inserted++
      result.initiativeIdsByPhase[phase.phase_number] = r.id
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

async function tryCreateInitiative(
  supabase: SupabaseClient,
  prescription: Pick<Prescription, 'id' | 'client_id' | 'goal_id' | 'version'>,
  phase: PrescriptionPhase,
  seed: PhaseInitiativeSeed,
  existingTitles: Set<string>,
  supportsInitiativeId: string | undefined,
): Promise<SingleResult> {
  const title = seed.title?.trim() || phase.name?.trim() || `处方 v${prescription.version} - 阶段 ${phase.phase_number}`
  const titleKey = title.toLowerCase()

  // 幂等: 同 Goal 同 title 已有 → 跳过
  if (existingTitles.has(titleKey)) {
    return { skipped: true, reason: `已存在同名 Initiative "${title}", 跳过 (幂等保护)` }
  }

  // 校验 budget_percent 范围 (策略层会再校验, 这里防御性)
  const budgetPercent = seed.budget_percent != null
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

  existingTitles.add(titleKey)  // 防止本批次重复
  return { skipped: false, id: r.initiative.id }
}

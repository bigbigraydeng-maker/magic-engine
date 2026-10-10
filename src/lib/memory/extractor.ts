/**
 * Phase 23.C — L3 记忆自动抽取器
 *
 * 从 flywheel_outcomes + flywheel_actions 中规则化地推导 L3 记忆条目：
 *
 *   1. confirmed 的动作 (confidence ≥ 0.6) → client_proven_patterns
 *   2. reversed  的动作 (confidence ≥ 0.6) → client_failed_experiments
 *   3. 同 action_type ≥ MIN_OCCURRENCES 个 confirmed 动作 → client_learned_preferences
 *   4. client_decision_history.outcome_verdict 回填（时间窗内匹配 outcomes）
 *
 * 单位是**动作**，不是 outcome 行（Issue #859 架构判断 6）:
 *
 *   一次快照会给同一个动作产出 clicks / impressions / avg_position 三行 outcome，
 *   ATTRIBUTION_DUAL_WINDOW_ENABLED 打开后再翻一倍。按行数计样本，一个动作就能
 *   自己凑够 MIN_OCCURRENCES_FOR_PREFERENCE，凭一次事件造出「持续跑赢」的偏好。
 *   `keepOneCasePerAction` 先折窗口再折指标，代表读数取动作自己承诺的
 *   expected_metric —— 与 aggregate / case-library / execution board 用的是同一把尺。
 *
 * 结论会翻转，所以写入是**对账**不是追加:
 *
 *   PR #862 之后 flywheel_outcomes 按自然键 upsert，同一行会被原地改，verdict
 *   能从 confirmed 翻成 reversed 再翻回来。老逻辑「见过这个 source_id 就跳过」
 *   于是让正反两条经验同时留在库里。现在每个动作每轮都对账到「当前结论那一侧
 *   生效、对侧下架」，DB 触发器（20260812100000）兜底。
 *
 * 只学真执行过、结论站得住的动作（1b，2026-09-26）:
 *
 *   EXECUTION_GATED_FLYWHEELS 里的支柱（seo / ads）不再走「新鲜的强结论就学」：
 *   每个动作过一遍 `classifyActionCase`（case-validity.ts）—— 诸葛亮的建议没执行过、
 *   整站指标、广告方向未定、窗口没到期、没有强结论，都不学；已经学进去的，按
 *   同一个判定下架（reconcile.ts），只切 is_active，被下架的行带表名进 cron 运行记录，
 *   可按清单恢复。开关打开和下架用的是同一个判定，一轮之内不可能先开后关。
 *   名单外的支柱（geo / social）输入与旧逻辑逐字相同。
 *
 * 设计原则：
 *   - 纯规则版本，无 LLM 调用 — 廉价、可解释、易回滚
 *   - 幂等：按 (client_id, source_action_id) 对账，重复跑不产生新行
 *   - 失败不阻塞：单条出错记入 errors，继续处理其余
 *   - 不删除已有记忆 — 只切 is_active，随时可翻回来
 *
 * Reference: ROADMAP.md Phase 23.C · Issue #859
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { keepOneCasePerAction } from '@/lib/flywheel/attribution/outcome-identity'
import {
  saveProvenPattern,
  saveFailedExperiment,
  savePreference,
  setDerivedMemoryActive,
  type DerivedMemoryTable,
} from './service'
import {
  MIN_OUTCOME_CONFIDENCE,
  OUTCOME_FRESH_DAYS,
  RULE_BASED_REASONS,
  classifyActionCase,
  isGatedFlywheel,
  type CaseAction,
  type CaseStatus,
} from './case-validity'
import {
  loadClientEvidence,
  loadDerivedMemory,
  loadExtractorClientIds,
  type ActionRow,
  type ClientEvidence,
  type DerivedMemoryRow,
  type OutcomeRow,
} from './extractor-load'
import {
  applyDeactivations,
  loadAttributionHealth,
  planDerivedMemoryDeactivations,
  planPreferenceDeactivations,
  type DeactivatedMemory,
  type DeactivationReason,
  type PreferenceRow,
  type ReconcileRow,
} from './reconcile'
import type { FlywheelName, PatternType, PreferenceType } from './types'

// ── 配置参数 ──────────────────────────────────────────────────────────────────

/** 同 action_type 连续 confirmed ≥ N 次才生成 learned_preference */
const MIN_OCCURRENCES_FOR_PREFERENCE = 3

// ── 公共类型 ──────────────────────────────────────────────────────────────────

export interface ExtractorResult {
  outcomes_processed: number
  /** Distinct actions behind those outcomes — the sample unit. */
  actions_processed: number
  patterns_added: number
  experiments_added: number
  preferences_added: number
  /** Rows switched off: the opposite verdict, and per-action duplicates. */
  memories_superseded: number
  /** Rows switched back on because the verdict flipped back. */
  memories_reactivated: number
  /**
   * 因为「太久没重算」被挡在门外的 outcome 行数。
   *
   * **必须报出来**，不能静默丢弃：这个数不为零，说明有一批动作的归因已经不再更新，
   * 而系统仍然在拿它们当证据。零和非零是两件完全不同的事，看不见就等于没发生。
   */
  outcomes_stale_skipped: number
  /** 1b · rows switched off because their action is no longer a valid case, by reason. */
  deactivated_by_reason: Partial<Record<DeactivationReason, number>>
  /** 1b · every row switched off by that reconciliation, with its table — the rollback list. */
  deactivated: DeactivatedMemory[]
  /** 1b · switch-offs held back because attribution looked stalled. */
  skipped_attribution_stalled: number
  /** 1b · memories left alone because their action's measurement window has not ended. */
  skipped_immature: number
  /** 1b · active memories of unknown pillar, left alone. */
  skipped_unknown_pillar: number
  errors: string[]
}

export interface ExtractorBatchResult {
  clients_processed: number
  aggregate: ExtractorResult
  per_client_errors: Array<{ client_id: string; error: string }>
}

export interface ExtractorOptions {
  /**
   * false = the manual FDE entry: never switch memories off, so every switch-off lands in
   * the cron run log (the rollback list). Step 4 still only opens valid cases, whatever
   * the entry point, so a manual run cannot reopen what the cron switched off.
   */
  reconcile?: boolean
  /** Batch runs check attribution health once and pass it in; single runs check it themselves. */
  attributionHealthy?: boolean
}

// ── 内部类型 ──────────────────────────────────────────────────────────────────

interface OutcomeJoinRow {
  outcome_id: string
  client_id: string
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number | null
  verdict: 'confirmed' | 'inconclusive' | 'reversed'
  computed_at: string
  window_days: number
  action_id: string
  action_type: string
  flywheel: FlywheelName
  vendor: string | null
  executed_at: string
  /** What the action promised to move — picks the representative reading. */
  expected_metric: string | null
}

type MemoryIndex = Record<DerivedMemoryTable, Map<string, DerivedMemoryRow[]>>

// ── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 为单个客户跑抽取器。
 * 任何 step 失败都会记入 errors，不会抛出。
 */
export async function runExtractorForClient(
  supabase: SupabaseClient,
  clientId: string,
  /** 测试注入用；生产不传。新鲜度闸拿它算截止时间。 */
  now: Date = new Date(),
  options: ExtractorOptions = {},
): Promise<ExtractorResult> {
  const result = emptyResult()
  const reconcile = options.reconcile ?? true

  // 1. 该客户全部 outcome 与全部动作 —— 记忆能依赖的证据都在这里
  let evidence: ClientEvidence
  try {
    evidence = await loadClientEvidence(supabase, clientId)
  } catch (err) {
    result.errors.push(`load outcomes: ${msgOf(err)}`)
    return result
  }
  const actionById = new Map(evidence.actions.map((a) => [a.id, a]))
  const outcomeById = new Map(evidence.outcomes.map((o) => [o.id, o]))

  // 2. 名单外支柱的输入与旧逻辑逐字相同：新鲜的强结论，一个动作一个案例
  const legacy = legacyStrongReadings(evidence, actionById, now)
  result.outcomes_processed = legacy.joined.length
  result.outcomes_stale_skipped = legacy.staleSkipped

  // 3. 名单内支柱：每个动作一个判定，打开与下架共用
  const classify = makeClassifier(evidence, actionById, now)
  const cases = [
    ...keepOneCasePerAction(legacy.joined.filter((o) => !isGatedFlywheel(o.flywheel))),
    ...validGatedCases(evidence, actionById, outcomeById, classify),
  ]
  result.actions_processed = cases.length

  // 4. 已派生的记忆行，按动作索引
  let proven: DerivedMemoryRow[]
  let failed: DerivedMemoryRow[]
  try {
    proven = await loadDerivedMemory(supabase, clientId, 'client_proven_patterns')
    failed = await loadDerivedMemory(supabase, clientId, 'client_failed_experiments')
  } catch (err) {
    // 读不到存量就停手：继续跑会把「已有的」当成「没有的」，写出一堆重复记忆，
    // 而且对侧下架也做不了 —— 那比这一轮不抽取糟糕得多。
    result.errors.push(`load existing memories: ${msgOf(err)}`)
    return result
  }
  const allOutcomeToAction = new Map(evidence.outcomes.map((o) => [o.id, o.action_id]))
  const derived = {
    // 名单外支柱照旧只用本轮新鲜强结论认领存量行（输入不变 = 行为不变）
    legacy: indexBoth(proven, failed, new Map(legacy.joined.map((o) => [o.outcome_id, o.action_id]))),
    gated: indexBoth(proven, failed, allOutcomeToAction),
  }

  // 5. 逐动作对账：当前结论那一侧生效，对侧下架
  for (const out of cases) {
    await reconcileOneCase(supabase, out, isGatedFlywheel(out.flywheel) ? derived.gated : derived.legacy, result)
  }

  let healthy = true
  if (reconcile) {
    const health = options.attributionHealthy === undefined
      ? await loadAttributionHealth(supabase, now)
      : { healthy: options.attributionHealthy, detail: '' }
    healthy = health.healthy
    if (!health.healthy && health.detail) {
      result.errors.push(`attribution stalled, freshness-based switch-offs held back: ${health.detail}`)
    }
  }

  // 6. 聚合 action_type 频次 → preferences（同样按动作计数）；名单内支柱同时对账下架
  const holdKeys = healthy ? new Set<string>() : stallSensitiveActionTypes(evidence.actions, classify)
  try {
    await reconcilePreferences(supabase, clientId, cases, result, { reconcile, holdKeys })
  } catch (err) {
    result.errors.push(`extract preferences: ${msgOf(err)}`)
  }

  // 7. 名单内支柱：动作已不是有效案例的记忆行下架（只切 is_active，按行 id）
  if (reconcile) {
    const rows = [
      ...toReconcileRows(proven, 'client_proven_patterns', allOutcomeToAction, actionById),
      ...toReconcileRows(failed, 'client_failed_experiments', allOutcomeToAction, actionById),
    ]
    const plan = planDerivedMemoryDeactivations(rows, classify, healthy)
    result.skipped_attribution_stalled += plan.skippedStalled
    result.skipped_immature += plan.skippedImmature
    result.skipped_unknown_pillar += plan.skippedUnknownPillar
    await applyAndRecord(supabase, clientId, plan.deactivate, result)
  }

  // （已退役 2026-09-06）这里原本还有一步「回填 client_decision_history.outcome_verdict」。
  //
  // 判据是错的，而且错得很彻底：它只按 client_id + 时间窗查 outcome，**从不看这条决策
  // 本身关联的是哪个动作**，然后拿窗口内全部 outcome 的多数票，给该客户窗口内的**每一条**
  // 决策盖同一个章。生产实测（2026-09-06）：116 条自动回填只有 5 种 note，每种恰好对应
  // 一个客户 —— 其中一家的 50 条决策被一次性全部盖成 failure。
  //
  // 危害不止于脏数据：`memory/format.ts` 会把它拼成 `(outcome: failure)` 写进
  // 「Recent Decisions」段，喂给鲁班（`luban/project-prompts.ts`）和华佗
  // （`huatuo/memory.ts`，长模式）。也就是说 AI 被告知那 50 个互不相干的选择都失败了。
  // 而 `updateDecisionOutcome` 只填 `outcome_verdict is null` 的行，**填过就不再复查**，
  // 是不可逆的单向写。
  //
  // 🔴 要重做的话，判据必须换成「只匹配这条决策**所关联动作**的 outcome」，时间窗用
  //    `flywheel_actions.executed_at` 而不是 `flywheel_outcomes.computed_at`
  //    （后者每轮 attribution 都会被刷成「现在」，根本不是事件发生时间）。
  //    但 `client_decision_history` 目前**没有指向 action 的外键**，接不上就别猜 ——
  //    宁可这一段永久不做，也不要再往客户记忆里刻一批假结论。
  //    人工/其它调用方要写结论，走 `memory/service.ts` 的 `updateDecisionOutcome`，那条没问题。

  return result
}

/**
 * 跑全部客户。返回每客户级聚合 + 错误名单。
 */
export async function runExtractorForAllClients(
  supabase: SupabaseClient,
  /** 测试注入用；生产不传。 */
  now: Date = new Date(),
): Promise<ExtractorBatchResult> {
  const aggregate = emptyResult()
  const perClientErrors: Array<{ client_id: string; error: string }> = []

  // 有 outcome 的客户 ∪ 还有在用派生记忆的客户（outcome 全被删掉的客户，记忆也得有人管）
  let clientIds: string[]
  try {
    clientIds = await loadExtractorClientIds(supabase)
  } catch (err) {
    return {
      clients_processed: 0,
      aggregate,
      per_client_errors: [{ client_id: '*', error: `list clients: ${msgOf(err)}` }],
    }
  }

  // 归因是否正常只查一次：停摆时「过期 / 没有强结论」两类下架全部按住，只报一次
  const health = await loadAttributionHealth(supabase, now)
  if (!health.healthy) {
    perClientErrors.push({
      client_id: '*',
      error: `attribution stalled, freshness-based switch-offs held back: ${health.detail}`,
    })
  }

  let processed = 0
  for (const clientId of clientIds) {
    try {
      const r = await runExtractorForClient(supabase, clientId, now, {
        reconcile: true,
        attributionHealthy: health.healthy,
      })
      processed++
      mergeInto(aggregate, r)
      if (r.errors.length > 0) {
        perClientErrors.push({ client_id: clientId, error: r.errors.join(' | ') })
      }
    } catch (err) {
      perClientErrors.push({ client_id: clientId, error: msgOf(err) })
    }
  }

  return { clients_processed: processed, aggregate, per_client_errors: perClientErrors }
}

// ── 结果 helpers ──────────────────────────────────────────────────────────────

function emptyResult(): ExtractorResult {
  return {
    outcomes_processed: 0,
    actions_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    memories_superseded: 0,
    memories_reactivated: 0,
    outcomes_stale_skipped: 0,
    deactivated_by_reason: {},
    deactivated: [],
    skipped_attribution_stalled: 0,
    skipped_immature: 0,
    skipped_unknown_pillar: 0,
    errors: [],
  }
}

function mergeInto(into: ExtractorResult, r: ExtractorResult): void {
  into.outcomes_processed += r.outcomes_processed
  into.actions_processed += r.actions_processed
  into.patterns_added += r.patterns_added
  into.experiments_added += r.experiments_added
  into.preferences_added += r.preferences_added
  into.memories_superseded += r.memories_superseded
  into.memories_reactivated += r.memories_reactivated
  into.outcomes_stale_skipped += r.outcomes_stale_skipped
  into.skipped_attribution_stalled += r.skipped_attribution_stalled
  into.skipped_immature += r.skipped_immature
  into.skipped_unknown_pillar += r.skipped_unknown_pillar
  into.deactivated.push(...r.deactivated)
  for (const [reason, n] of Object.entries(r.deactivated_by_reason) as Array<[DeactivationReason, number]>) {
    into.deactivated_by_reason[reason] = (into.deactivated_by_reason[reason] ?? 0) + n
  }
}

async function applyAndRecord(
  supabase: SupabaseClient,
  clientId: string,
  planned: DeactivatedMemory[],
  result: ExtractorResult,
): Promise<void> {
  if (planned.length === 0) return
  const { done, errors } = await applyDeactivations(supabase, clientId, planned)
  result.errors.push(...errors)
  for (const d of done) {
    result.deactivated.push(d)
    result.deactivated_by_reason[d.reason] = (result.deactivated_by_reason[d.reason] ?? 0) + 1
  }
}

// ── 证据整理 helpers ──────────────────────────────────────────────────────────

/**
 * 旧逻辑的输入：新鲜的强结论（confirmed / reversed）与动作拼好。
 *
 * 归因结果多久没被重算就不再当证据用（OUTCOME_FRESH_DAYS，见 case-validity.ts）：
 * attribution 每 6 小时把所有**现役**动作的 outcome 重算一遍（`computed_at` 刷成现在），
 * 所以健康的行永远不超过一天。
 *
 * 🔴 为什么必须有这道闸（2026-09-06 生产实测）：库里有 **51 行 / 17 个动作**的归因
 *    永久冻结在 2026-08-04~05。成因见 Issue #859 —— page-upgrade 的 PR 被拒后
 *    `expected_metric` 被写成 null，而两个写入方的查询都带
 *    `.not('expected_metric','is',null)`，从此谁都不再选中它们，既不刷新也不删除。
 *    抽取器不看时间读全表，于是一个多月前的读数一直被当现役证据学。
 *
 * 在内存里筛（不在查询里筛）是为了能数出「挡掉了多少」；时间读不出来的行保留 ——
 * 不认识的格式不该等于「过期」。
 */
function legacyStrongReadings(
  evidence: ClientEvidence,
  actionById: Map<string, ActionRow>,
  now: Date,
): { joined: OutcomeJoinRow[]; staleSkipped: number } {
  const strong = evidence.outcomes.filter((o) => o.verdict === 'confirmed' || o.verdict === 'reversed')
  const cutoff = now.getTime() - OUTCOME_FRESH_DAYS * 86_400_000
  const fresh = strong.filter((o) => {
    const t = Date.parse(o.computed_at)
    return Number.isNaN(t) || t >= cutoff
  })

  const joined: OutcomeJoinRow[] = []
  for (const o of fresh) {
    const a = actionById.get(o.action_id)
    if (a) joined.push(joinRow(o, a))
  }
  return { joined, staleSkipped: strong.length - fresh.length }
}

function joinRow(o: OutcomeRow, a: ActionRow): OutcomeJoinRow {
  return {
    outcome_id: o.id,
    client_id: o.client_id,
    metric_key: o.metric_key,
    delta: o.delta,
    delta_pct: o.delta_pct,
    confidence: o.confidence,
    verdict: o.verdict,
    computed_at: o.computed_at,
    window_days: o.window_days ?? 0,
    action_id: o.action_id,
    action_type: a.action_type,
    flywheel: a.flywheel,
    vendor: a.vendor,
    executed_at: a.executed_at,
    expected_metric: a.expected_metric,
  }
}

function toCaseAction(a: ActionRow): CaseAction {
  return {
    id: a.id,
    flywheel: a.flywheel,
    executed_at: a.executed_at,
    expected_metric: a.expected_metric,
    zhuge_session_key: a.zhuge_session_key,
    payload_source: a.payload_source,
    execution_item_id: a.execution_item_id,
    action_run_id: a.action_run_id,
  }
}

/** One `classifyActionCase` per action, memoised — step 5 and step 7 must see the same answer. */
function makeClassifier(
  evidence: ClientEvidence,
  actionById: Map<string, ActionRow>,
  now: Date,
): (actionId: string) => CaseStatus {
  const byAction = new Map<string, OutcomeRow[]>()
  for (const o of evidence.outcomes) {
    const held = byAction.get(o.action_id)
    if (held) held.push(o)
    else byAction.set(o.action_id, [o])
  }
  const memo = new Map<string, CaseStatus>()
  return (actionId: string) => {
    const hit = memo.get(actionId)
    if (hit) return hit
    const action = actionById.get(actionId)
    const status = classifyActionCase({
      action: action ? toCaseAction(action) : null,
      outcomes: byAction.get(actionId) ?? [],
      now,
    })
    memo.set(actionId, status)
    return status
  }
}

/** Gated-pillar actions that are valid cases, as step-5 input (their representative reading). */
function validGatedCases(
  evidence: ClientEvidence,
  actionById: Map<string, ActionRow>,
  outcomeById: Map<string, OutcomeRow>,
  classify: (actionId: string) => CaseStatus,
): OutcomeJoinRow[] {
  const out: OutcomeJoinRow[] = []
  const actionIds = Array.from(new Set(evidence.outcomes.map((o) => o.action_id))).sort()
  for (const actionId of actionIds) {
    const action = actionById.get(actionId)
    if (!action || !isGatedFlywheel(action.flywheel)) continue
    const status = classify(actionId)
    if (status.kind !== 'valid') continue
    const row = outcomeById.get(status.representative.id)
    if (row) out.push(joinRow(row, action))
  }
  return out
}

function indexBoth(
  proven: DerivedMemoryRow[],
  failed: DerivedMemoryRow[],
  outcomeToAction: Map<string, string>,
): MemoryIndex {
  return {
    client_proven_patterns: indexByAction(proven, outcomeToAction),
    client_failed_experiments: indexByAction(failed, outcomeToAction),
  }
}

function toReconcileRows(
  rows: DerivedMemoryRow[],
  table: DerivedMemoryTable,
  outcomeToAction: Map<string, string>,
  actionById: Map<string, ActionRow>,
): ReconcileRow[] {
  return rows.map((r) => {
    const actionId = r.source_action_id ?? (r.source_id ? outcomeToAction.get(r.source_id) ?? null : null)
    const action = actionId ? actionById.get(actionId) : undefined
    return {
      id: r.id,
      table,
      is_active: r.is_active,
      source_action_id: r.source_action_id,
      action_id: actionId,
      pillar: action?.flywheel ?? r.pillar_column,
    }
  })
}

// ── 逐动作对账 ────────────────────────────────────────────────────────────────

async function reconcileOneCase(
  supabase: SupabaseClient,
  out: OutcomeJoinRow,
  derived: MemoryIndex,
  result: ExtractorResult,
): Promise<void> {
  if ((out.confidence ?? 0) < MIN_OUTCOME_CONFIDENCE) return
  if (out.verdict !== 'confirmed' && out.verdict !== 'reversed') return

  const confirmed = out.verdict === 'confirmed'
  const winner: DerivedMemoryTable = confirmed ? 'client_proven_patterns' : 'client_failed_experiments'
  const loser:  DerivedMemoryTable = confirmed ? 'client_failed_experiments' : 'client_proven_patterns'

  try {
    const held = derived[winner].get(out.action_id) ?? []

    if (held.length === 0) {
      const saved = confirmed
        ? await saveProvenPattern(supabase, {
            client_id: out.client_id,
            pattern_type: actionToPatternType(out.action_type),
            pattern_content: describePattern(out),
            performance_metric: describeMetric(out),
            flywheel: out.flywheel,
            source_table: 'flywheel_outcomes',
            source_id: out.outcome_id,
            source_action_id: out.action_id,
          })
        : await saveFailedExperiment(supabase, {
            client_id: out.client_id,
            experiment_description: describeExperiment(out),
            failure_reason: describeFailure(out),
            dimension: flywheelToDimension(out.flywheel),
            tried_at: out.executed_at,
            source_table: 'flywheel_outcomes',
            source_id: out.outcome_id,
            source_action_id: out.action_id,
          })
      if (saved) {
        if (confirmed) result.patterns_added++
        else result.experiments_added++
      }
    } else {
      // 已有该动作的记忆：认领存量行的动作身份，留一条生效，其余下架。
      // 留最早那条 —— 它是这个动作第一次被学到的时间点，且排序确定。
      const [keep, ...redundant] = [...held].sort(byCreatedAtThenId)
      const changes = await adoptAndActivate(supabase, winner, keep, out.action_id)
      result.memories_reactivated += changes

      for (const row of redundant) {
        result.memories_superseded += await adoptAndDeactivate(supabase, winner, row, out.action_id)
      }
    }

    // 对侧下架。触发器只在 INSERT / is_active 变化时响，命中不了「本来就
    // active 且这轮没被碰」的存量行，所以这一刀必须显式补上。
    result.memories_superseded += await setDerivedMemoryActive(
      supabase, loser, out.client_id, out.action_id, false,
    )
  } catch (err) {
    result.errors.push(`action ${out.action_id}: ${msgOf(err)}`)
  }
}

/**
 * 把记忆行按**动作**归类。
 *
 * 新行直接有 source_action_id。20260812100000 之前写的行只有 source_id
 * （= outcome.id），用 outcome → action 映射认回来，这样第一次跑不会把
 * 存量记忆当成不存在而重复写一遍。认不回来的（对应 outcome 已经不在了）留在
 * 原地不动 —— 没有证据说它属于哪个动作，猜一个比放着更糟。
 */
function indexByAction(
  rows: DerivedMemoryRow[],
  outcomeToAction: Map<string, string>,
): Map<string, DerivedMemoryRow[]> {
  const byAction = new Map<string, DerivedMemoryRow[]>()

  for (const row of rows) {
    const actionId = row.source_action_id
      ?? (row.source_id ? outcomeToAction.get(row.source_id) : undefined)
    if (!actionId) continue

    const held = byAction.get(actionId)
    if (held) held.push(row)
    else byAction.set(actionId, [row])
  }

  return byAction
}

/** 稳定排序：建立时间优先，同一时间按 id，避免行顺序左右保留哪一条。 */
function byCreatedAtThenId(a: DerivedMemoryRow, b: DerivedMemoryRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 认领动作身份 + 确保生效。返回「本来不生效、被打开」的行数。 */
async function adoptAndActivate(
  supabase: SupabaseClient,
  table: DerivedMemoryTable,
  row: DerivedMemoryRow,
  actionId: string,
): Promise<number> {
  const needsAdoption = row.source_action_id !== actionId
  if (!needsAdoption && row.is_active) return 0

  const { error } = await supabase
    .from(table)
    .update({ source_action_id: actionId, is_active: true })
    .eq('id', row.id)

  if (error) throw new Error(`activate ${table} ${row.id}: ${error.message}`)
  return row.is_active ? 0 : 1
}

/** 认领动作身份 + 下架。返回「本来生效、被关掉」的行数。 */
async function adoptAndDeactivate(
  supabase: SupabaseClient,
  table: DerivedMemoryTable,
  row: DerivedMemoryRow,
  actionId: string,
): Promise<number> {
  const needsAdoption = row.source_action_id !== actionId
  if (!needsAdoption && !row.is_active) return 0

  const { error } = await supabase
    .from(table)
    .update({ source_action_id: actionId, is_active: false })
    .eq('id', row.id)

  if (error) throw new Error(`deactivate ${table} ${row.id}: ${error.message}`)
  return row.is_active ? 1 : 0
}

// ── Preference 聚合 ───────────────────────────────────────────────────────────

/**
 * 同一 action_type 在该客户上 confirmed 的**动作个数**达到阈值，生成
 * learned_preference。已存在同 (preference_type, content, source, flywheel) 不重复写。
 *
 * ⚠️ `cases` 必须已经过 `keepOneCasePerAction` 折叠。这里数的是「几个动作跑赢了」，
 * 不是「几行 outcome 说跑赢了」—— MIN_OCCURRENCES_FOR_PREFERENCE = 3，而一个 GSC
 * 动作一次就出三行（clicks / impressions / avg_position），按行数数的话一个动作
 * 就能自己凑够阈值，凭一次事件写出「持续跑赢」。
 *
 * 名单内支柱（1b）：写入与下架共用同一个支撑数（这里的 grouped，只数有效案例）；
 * 证据回来时重新打开同内容的旧行、不新增行；支撑不足 3 的在用行下架（归因停摆时，
 * 支撑可能只是被停摆拉低的类型按住不动；动作全都因规则失效的类型照样下架）。
 * 读偏好失败直接报错 —— 当成「没有」会写出重复、还会漏掉所有下架。
 */
async function reconcilePreferences(
  supabase: SupabaseClient,
  clientId: string,
  cases: OutcomeJoinRow[],
  result: ExtractorResult,
  opts: { reconcile: boolean; holdKeys: ReadonlySet<string> },
): Promise<void> {
  const grouped = groupConfirmedByActionType(cases)

  const { data: existing, error } = await supabase
    .from('client_learned_preferences')
    .select('id, content, flywheel, preference_type, is_active, extracted_from_table')
    .eq('client_id', clientId)
    .eq('source', 'auto_extracted')
  if (error) throw new Error(`load preferences: ${error.message}`)

  const existingRows = (existing ?? []) as PreferenceRow[]
  const byKey = new Map(existingRows.map((r) => [prefKey(r.flywheel ?? 'global', r.preference_type, r.content), r]))

  for (const entry of Array.from(grouped.values())) {
    if (entry.count < MIN_OCCURRENCES_FOR_PREFERENCE) continue

    const preference: { preference_type: PreferenceType; content: string; flywheel: FlywheelName } = {
      preference_type: 'format',
      content: `${entry.count} 个动作 confirmed: action_type='${entry.actionType}' 在 ${entry.flywheel} 飞轮持续跑赢`,
      flywheel: entry.flywheel,
    }
    const held = byKey.get(prefKey(preference.flywheel, preference.preference_type, preference.content))
    if (held) {
      if (!held.is_active && isGatedFlywheel(entry.flywheel)) {
        const { error: upErr } = await supabase
          .from('client_learned_preferences')
          .update({ is_active: true })
          .eq('id', held.id)
        if (upErr) throw new Error(`reactivate preference ${held.id}: ${upErr.message}`)
        held.is_active = true
        result.memories_reactivated++
        await supersedeStalePreferences(supabase, existingRows, entry.flywheel, entry.actionType, preference.content)
      }
      continue
    }

    // confidence_score 与样本数挂钩（cap 0.95）
    const confidence = Math.min(0.95, 0.5 + (entry.count - MIN_OCCURRENCES_FOR_PREFERENCE) * 0.1)

    const sample = entry.samples[0]
    const saved = await savePreference(supabase, {
      client_id: clientId,
      preference_type: preference.preference_type,
      content: preference.content,
      source: 'auto_extracted',
      confidence_score: confidence,
      flywheel: preference.flywheel,
      extracted_from_table: 'flywheel_outcomes',
      extracted_from_id: sample?.outcome_id,
    })
    if (saved) {
      result.preferences_added++
      await supersedeStalePreferences(supabase, existingRows, entry.flywheel, entry.actionType, preference.content)
    }
  }

  if (!opts.reconcile) return
  const support = new Map(Array.from(grouped.values()).map((e) => [`${e.flywheel}::${e.actionType}`, e.count]))
  const { planned, held } = planPreferenceDeactivations(
    existingRows,
    support,
    MIN_OCCURRENCES_FOR_PREFERENCE,
    opts.holdKeys,
  )
  result.skipped_attribution_stalled += held
  await applyAndRecord(supabase, clientId, planned, result)
}

/**
 * Gated action types whose low support may only be a symptom of stalled attribution:
 * at least one of their actions is valid, or invalid for a freshness reason. A type whose
 * every action fails a rule-based check (whole-site metric, never executed, …) is not
 * included — its preference comes off even while attribution is stalled.
 */
function stallSensitiveActionTypes(
  actions: readonly ActionRow[],
  classify: (actionId: string) => CaseStatus,
): Set<string> {
  const keys = new Set<string>()
  for (const a of actions) {
    if (!isGatedFlywheel(a.flywheel)) continue
    const status = classify(a.id)
    if (status.kind === 'valid' || !RULE_BASED_REASONS.has(status.reason)) {
      keys.add(`${a.flywheel}::${a.action_type}`)
    }
  }
  return keys
}

function prefKey(flywheel: string, preferenceType: string, content: string): string {
  return `${flywheel}::${preferenceType}::${content}`
}

/** 按 (flywheel, action_type) 聚合 confirmed 且够置信度的动作数 —— 写入与下架共用的支撑数。 */
function groupConfirmedByActionType(
  cases: OutcomeJoinRow[],
): Map<string, { count: number; flywheel: FlywheelName; actionType: string; samples: OutcomeJoinRow[] }> {
  const grouped = new Map<string, { count: number; flywheel: FlywheelName; actionType: string; samples: OutcomeJoinRow[] }>()
  for (const o of cases) {
    if (o.verdict !== 'confirmed') continue
    if ((o.confidence ?? 0) < MIN_OUTCOME_CONFIDENCE) continue
    const key = `${o.flywheel}::${o.action_type}`
    const entry = grouped.get(key) ?? { count: 0, flywheel: o.flywheel, actionType: o.action_type, samples: [] }
    entry.count++
    if (entry.samples.length < 3) entry.samples.push(o)
    grouped.set(key, entry)
  }
  return grouped
}

/**
 * 同一个 (flywheel, action_type) 上，只留最新那条自动抽取的偏好生效。
 *
 * 为什么必须做：这一版把计数从「outcome 行数」改成「动作数」，同一个
 * action_type 的新旧两条内容不一样（`9 次 confirmed` vs `3 个动作 confirmed`），
 * 去重键里含 content，所以新的照写，旧的照留。不下架旧的，等于新写了一条准确
 * 的，同时让那条按行数膨胀出来的「持续跑赢」继续喂给 agent —— 这正是要修的东西。
 *
 * 匹配在内存里做，不拼 `.like()`：action_type 来自 DB 自由文本，带 `%` 或 `_`
 * 会把通配符带进过滤串，误伤别的 action_type 的偏好。
 * 只碰 source='auto_extracted' 的行，FDE 手工标注永远不动。
 */
async function supersedeStalePreferences(
  supabase: SupabaseClient,
  existingRows: PreferenceRow[],
  flywheel: FlywheelName,
  actionType: string,
  freshContent: string,
): Promise<void> {
  const marker = `action_type='${actionType}'`
  const stale = existingRows.filter(r =>
    r.is_active
    && r.flywheel === flywheel
    && r.content !== freshContent
    && r.content.includes(marker),
  )
  if (stale.length === 0) return

  const { error } = await supabase
    .from('client_learned_preferences')
    .update({ is_active: false })
    .in('id', stale.map(r => r.id))

  if (error) {
    console.warn('[extractor] supersede stale preferences:', error.message)
    return
  }
  for (const row of stale) row.is_active = false
}


// ── Action-type → pattern_type / description mapping ──────────────────────────

function actionToPatternType(actionType: string): PatternType {
  const a = actionType.toLowerCase()
  if (a.includes('hook') || a.includes('headline') || a.includes('title')) return 'headline'
  if (a.includes('cta')) return 'cta'
  if (a.includes('structure') || a.includes('layout')) return 'structure'
  if (a.includes('publish') || a.includes('post') || a.includes('compose')) return 'format'
  return 'angle'
}

function describePattern(out: OutcomeJoinRow): string {
  const dPct = out.delta_pct != null ? `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}%` : 'positive delta'
  return `${out.flywheel} 飞轮 '${out.action_type}' 在 ${out.window_days} 天窗口内 ${dPct} 提升 ${out.metric_key}（confidence ${round2(out.confidence ?? 0)}）`
}

function describeMetric(out: OutcomeJoinRow): string {
  if (out.delta_pct != null) {
    return `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}% on ${out.metric_key} (${out.window_days}d window)`
  }
  if (out.delta != null) {
    return `Δ ${round2(out.delta)} on ${out.metric_key} (${out.window_days}d window)`
  }
  return `confirmed on ${out.metric_key}`
}

function describeExperiment(out: OutcomeJoinRow): string {
  return `${out.flywheel} 飞轮尝试 action_type='${out.action_type}'（目标指标 ${out.metric_key}）`
}

function describeFailure(out: OutcomeJoinRow): string {
  const dPct = out.delta_pct != null ? `${out.delta_pct >= 0 ? '+' : ''}${round1(out.delta_pct)}%` : '反向变动'
  return `${out.window_days} 天窗口内 ${out.metric_key} ${dPct}，verdict=reversed（confidence ${round2(out.confidence ?? 0)}）`
}

function flywheelToDimension(fw: FlywheelName): 'seo' | 'ai_visibility' | 'ads' | 'social' {
  switch (fw) {
    case 'geo':    return 'ai_visibility'
    case 'seo':    return 'seo'
    case 'ads':    return 'ads'
    case 'social': return 'social'
  }
}

// ── Misc utils ────────────────────────────────────────────────────────────────

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

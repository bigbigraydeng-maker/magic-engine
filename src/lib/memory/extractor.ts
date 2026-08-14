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
  updateDecisionOutcome,
  type DerivedMemoryTable,
} from './service'
import type { FlywheelName, PatternType, PreferenceType } from './types'

// ── 配置参数 ──────────────────────────────────────────────────────────────────

/** 写入 patterns/experiments 的最低 outcome confidence */
const MIN_OUTCOME_CONFIDENCE = 0.6

/** 同 action_type 连续 confirmed ≥ N 次才生成 learned_preference */
const MIN_OCCURRENCES_FOR_PREFERENCE = 3

/** decision → outcome 匹配的时间窗（天） */
const DECISION_MATCH_WINDOW_DAYS = 14

// ── 公共类型 ──────────────────────────────────────────────────────────────────

export interface ExtractorResult {
  outcomes_processed: number
  /** Distinct actions behind those outcomes — the sample unit. */
  actions_processed: number
  patterns_added: number
  experiments_added: number
  preferences_added: number
  decisions_updated: number
  /** Rows switched off: the opposite verdict, and per-action duplicates. */
  memories_superseded: number
  /** Rows switched back on because the verdict flipped back. */
  memories_reactivated: number
  errors: string[]
}

export interface ExtractorBatchResult {
  clients_processed: number
  aggregate: ExtractorResult
  per_client_errors: Array<{ client_id: string; error: string }>
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

/** A derived memory row, as far as reconciliation cares. */
interface DerivedMemoryRow {
  id: string
  source_id: string | null
  source_action_id: string | null
  is_active: boolean
  created_at: string
}

// ── 公共 API ──────────────────────────────────────────────────────────────────

/**
 * 为单个客户跑抽取器。
 * 任何 step 失败都会记入 errors，不会抛出。
 */
export async function runExtractorForClient(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ExtractorResult> {
  const result: ExtractorResult = {
    outcomes_processed: 0,
    actions_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    decisions_updated: 0,
    memories_superseded: 0,
    memories_reactivated: 0,
    errors: [],
  }

  // 1. 拉取该客户所有 high-confidence outcomes + JOIN action
  let outcomes: OutcomeJoinRow[] = []
  try {
    outcomes = await loadOutcomesWithActions(supabase, clientId)
    result.outcomes_processed = outcomes.length
  } catch (err) {
    result.errors.push(`load outcomes: ${msgOf(err)}`)
    return result
  }

  if (outcomes.length === 0) {
    return result
  }

  // 2. 折成「一个动作一个案例」—— 之后所有计数都在这上面做
  const cases = keepOneCasePerAction(outcomes)
  result.actions_processed = cases.length

  // 3. 拉取已派生的记忆行，按动作索引（存量行没有 source_action_id，
  //    用 outcome_id → action_id 认领回来，避免第一次跑就写出重复）
  const outcomeToAction = new Map(outcomes.map(o => [o.outcome_id, o.action_id]))
  let derived: Record<DerivedMemoryTable, Map<string, DerivedMemoryRow[]>> = {
    client_proven_patterns: new Map(),
    client_failed_experiments: new Map(),
  }
  try {
    derived = {
      client_proven_patterns: indexByAction(
        await loadDerivedMemory(supabase, clientId, 'client_proven_patterns'),
        outcomeToAction,
      ),
      client_failed_experiments: indexByAction(
        await loadDerivedMemory(supabase, clientId, 'client_failed_experiments'),
        outcomeToAction,
      ),
    }
  } catch (err) {
    // 读不到存量就停手：继续跑会把「已有的」当成「没有的」，写出一堆重复记忆，
    // 而且对侧下架也做不了 —— 那比这一轮不抽取糟糕得多。
    result.errors.push(`load existing memories: ${msgOf(err)}`)
    return result
  }

  // 4. 逐动作对账：当前结论那一侧生效，对侧下架
  for (const out of cases) {
    if ((out.confidence ?? 0) < MIN_OUTCOME_CONFIDENCE) continue
    if (out.verdict !== 'confirmed' && out.verdict !== 'reversed') continue

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

  // 5. 聚合 action_type 频次 → 生成 preferences（同样按动作计数）
  try {
    const added = await extractPreferencesFromActionTypes(
      supabase, clientId, cases,
    )
    result.preferences_added += added
  } catch (err) {
    result.errors.push(`extract preferences: ${msgOf(err)}`)
  }

  // 5. 回填 decision_history.outcome_verdict
  try {
    const updated = await backfillDecisionOutcomes(supabase, clientId)
    result.decisions_updated += updated
  } catch (err) {
    result.errors.push(`backfill decisions: ${msgOf(err)}`)
  }

  return result
}

/**
 * 跑全部客户。返回每客户级聚合 + 错误名单。
 */
export async function runExtractorForAllClients(
  supabase: SupabaseClient,
): Promise<ExtractorBatchResult> {
  const aggregate: ExtractorResult = {
    outcomes_processed: 0,
    actions_processed: 0,
    patterns_added: 0,
    experiments_added: 0,
    preferences_added: 0,
    decisions_updated: 0,
    memories_superseded: 0,
    memories_reactivated: 0,
    errors: [],
  }
  const perClientErrors: Array<{ client_id: string; error: string }> = []

  // 仅处理在 outcomes 表里出现过的客户（无 outcome 客户跳过）
  const { data: rows, error } = await supabase
    .from('flywheel_outcomes')
    .select('client_id')
    .order('client_id')

  if (error) {
    return {
      clients_processed: 0,
      aggregate,
      per_client_errors: [{ client_id: '*', error: `list clients: ${error.message}` }],
    }
  }

  const clientIds = Array.from(new Set((rows ?? []).map(r => r.client_id))).filter(Boolean)
  let processed = 0

  for (const clientId of clientIds) {
    try {
      const r = await runExtractorForClient(supabase, clientId)
      processed++
      aggregate.outcomes_processed    += r.outcomes_processed
      aggregate.actions_processed     += r.actions_processed
      aggregate.patterns_added        += r.patterns_added
      aggregate.experiments_added     += r.experiments_added
      aggregate.preferences_added     += r.preferences_added
      aggregate.decisions_updated     += r.decisions_updated
      aggregate.memories_superseded   += r.memories_superseded
      aggregate.memories_reactivated  += r.memories_reactivated
      if (r.errors.length > 0) {
        perClientErrors.push({ client_id: clientId, error: r.errors.join(' | ') })
      }
    } catch (err) {
      perClientErrors.push({ client_id: clientId, error: msgOf(err) })
    }
  }

  return { clients_processed: processed, aggregate, per_client_errors: perClientErrors }
}

// ── 数据加载 helpers ──────────────────────────────────────────────────────────

async function loadOutcomesWithActions(
  supabase: SupabaseClient,
  clientId: string,
): Promise<OutcomeJoinRow[]> {
  // 单跑 JOIN 在 PostgREST 风格里不直观；用两步查询并在内存里合并
  const { data: outcomeRows, error: outcomeErr } = await supabase
    .from('flywheel_outcomes')
    .select('id, client_id, action_id, metric_key, delta, delta_pct, confidence, verdict, computed_at, window_days')
    .eq('client_id', clientId)
    .in('verdict', ['confirmed', 'reversed'])
    .order('computed_at', { ascending: false })

  if (outcomeErr) throw new Error(outcomeErr.message)
  if (!outcomeRows || outcomeRows.length === 0) return []

  const actionIds = Array.from(new Set(outcomeRows.map(r => r.action_id).filter(Boolean)))
  if (actionIds.length === 0) return []

  const { data: actionRows, error: actionErr } = await supabase
    .from('flywheel_actions')
    // expected_metric 决定折叠时哪一行代表这个动作 —— 少选它，代表读数就退化成
    // 「窗口最长的那条」，跟 aggregate / case-library 的口径对不上。
    .select('id, action_type, flywheel, vendor, executed_at, expected_metric')
    .in('id', actionIds)

  if (actionErr) throw new Error(actionErr.message)

  const actionMap = new Map<string, { action_type: string; flywheel: FlywheelName; vendor: string | null; executed_at: string; expected_metric: string | null }>()
  for (const a of actionRows ?? []) {
    actionMap.set(a.id, {
      action_type: a.action_type,
      flywheel: a.flywheel,
      vendor: a.vendor ?? null,
      executed_at: a.executed_at,
      expected_metric: a.expected_metric ?? null,
    })
  }

  const joined: OutcomeJoinRow[] = []
  for (const o of outcomeRows) {
    const a = actionMap.get(o.action_id)
    if (!a) continue
    joined.push({
      outcome_id: o.id,
      client_id: o.client_id,
      metric_key: o.metric_key,
      delta: o.delta,
      delta_pct: o.delta_pct,
      confidence: o.confidence,
      verdict: o.verdict,
      computed_at: o.computed_at,
      window_days: o.window_days,
      action_id: o.action_id,
      action_type: a.action_type,
      flywheel: a.flywheel,
      vendor: a.vendor,
      executed_at: a.executed_at,
      expected_metric: a.expected_metric,
    })
  }
  return joined
}

/**
 * 该客户在某张派生记忆表里的所有行（含已下架的）。
 *
 * 已下架的行必须一起读回来 —— 结论翻回 confirmed 时要能把它重新激活，
 * 只读 active 的话会认为「没有」，于是再插一条，重复就是这么来的。
 */
async function loadDerivedMemory(
  supabase: SupabaseClient,
  clientId: string,
  table: DerivedMemoryTable,
): Promise<DerivedMemoryRow[]> {
  const { data, error } = await supabase
    .from(table)
    .select('id, source_id, source_action_id, is_active, created_at')
    .eq('client_id', clientId)
    .eq('source_table', 'flywheel_outcomes')

  if (error) throw new Error(`${table}: ${error.message}`)
  return (data ?? []) as DerivedMemoryRow[]
}

/**
 * 把记忆行按**动作**归类。
 *
 * 新行直接有 source_action_id。20260812100000 之前写的行只有 source_id
 * （= outcome.id），用本轮的 outcome → action 映射认回来，这样第一次跑不会把
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
 */
async function extractPreferencesFromActionTypes(
  supabase: SupabaseClient,
  clientId: string,
  cases: OutcomeJoinRow[],
): Promise<number> {
  // 按 (flywheel, action_type) 聚合 confirmed 动作数
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

  // 已有 auto_extracted preferences（按 flywheel + content 去重；同时用来下架
  // 同一 action_type 的旧口径行 —— 见 supersedeStalePreferences）
  const { data: existing } = await supabase
    .from('client_learned_preferences')
    .select('id, content, flywheel, preference_type, is_active')
    .eq('client_id', clientId)
    .eq('source', 'auto_extracted')

  const existingRows = (existing ?? []) as PreferenceRow[]
  const existingKeys = new Set(
    existingRows.map(r => `${r.flywheel ?? 'global'}::${r.preference_type}::${r.content}`),
  )

  let added = 0
  for (const entry of Array.from(grouped.values())) {
    if (entry.count < MIN_OCCURRENCES_FOR_PREFERENCE) continue

    const preference: { preference_type: PreferenceType; content: string; flywheel: FlywheelName } = {
      preference_type: 'format',
      content: `${entry.count} 个动作 confirmed: action_type='${entry.actionType}' 在 ${entry.flywheel} 飞轮持续跑赢`,
      flywheel: entry.flywheel,
    }
    const key = `${preference.flywheel}::${preference.preference_type}::${preference.content}`
    if (existingKeys.has(key)) continue

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
      added++
      existingKeys.add(key)
      await supersedeStalePreferences(supabase, existingRows, entry.flywheel, entry.actionType, preference.content)
    }
  }
  return added
}

interface PreferenceRow {
  id: string
  content: string
  flywheel: string | null
  preference_type: string
  is_active: boolean
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

// ── Decision verdict backfill ─────────────────────────────────────────────────

/**
 * 把 client_decision_history.outcome_verdict 是 null 的记录补全：
 * 在 created_at + window 天内查该客户 outcomes，按 majority verdict 决定。
 */
async function backfillDecisionOutcomes(
  supabase: SupabaseClient,
  clientId: string,
): Promise<number> {
  const { data: decisions, error } = await supabase
    .from('client_decision_history')
    .select('id, created_at')
    .eq('client_id', clientId)
    .is('outcome_verdict', null)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(error.message)
  }
  if (!decisions || decisions.length === 0) return 0

  let updated = 0
  for (const d of decisions) {
    const start = new Date(d.created_at)
    const end = new Date(start)
    end.setDate(end.getDate() + DECISION_MATCH_WINDOW_DAYS)

    const { data: outcomes, error: oErr } = await supabase
      .from('flywheel_outcomes')
      .select('verdict')
      .eq('client_id', clientId)
      .gte('computed_at', start.toISOString())
      .lte('computed_at', end.toISOString())

    if (oErr) continue
    if (!outcomes || outcomes.length === 0) continue

    const verdict = aggregateVerdicts(outcomes.map((o: { verdict: string }) => o.verdict))
    if (!verdict) continue

    await updateDecisionOutcome(supabase, d.id, verdict, `auto-derived from ${outcomes.length} outcomes within ${DECISION_MATCH_WINDOW_DAYS}d window`)
    updated++
  }
  return updated
}

function aggregateVerdicts(verdicts: string[]): 'success' | 'failure' | 'inconclusive' | null {
  let confirmed = 0
  let reversed = 0
  let inconclusive = 0
  for (const v of verdicts) {
    if (v === 'confirmed') confirmed++
    else if (v === 'reversed') reversed++
    else if (v === 'inconclusive') inconclusive++
  }
  const total = confirmed + reversed + inconclusive
  if (total === 0) return null
  if (confirmed > reversed && confirmed >= total / 2) return 'success'
  if (reversed > confirmed && reversed >= total / 2) return 'failure'
  return 'inconclusive'
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

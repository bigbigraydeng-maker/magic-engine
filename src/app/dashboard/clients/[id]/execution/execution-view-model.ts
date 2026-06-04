import type {
  ExecutionItem,
  ExecutionLog,
  LinkedContentPost,
  PrescriptionStatus,
  CardContentState,
} from '@/types/diagnostic'

export const AUTONOMOUS_GROUP_ID = '__autonomous__'
/** Marketing Plan 任务分组前缀 — 实际 pid 形如 'mp:<plan_id>' */
export const MARKETING_PLAN_GROUP_PREFIX = 'mp:'
/** FDE 手动录入分组 ID — source='fde_manual' 的所有任务聚合到此组（Phase 20.D）*/
export const FDE_MANUAL_GROUP_ID = '__fde_manual__'

export interface PrescriptionMeta {
  id: string
  status: PrescriptionStatus
  supplements_id: string | null
  supersedes_id: string | null
  generated_at: string | null
}

/** Marketing Plan 分组的 meta — 与 PrescriptionMeta 区分 */
export interface MarketingPlanMeta {
  id: string
  title: string
  status: 'draft' | 'approved' | 'completed' | 'archived'
  start_date: string | null
  end_date: string | null
  approved_at: string | null
}

export interface OutcomeSummary {
  verdict: 'confirmed' | 'inconclusive' | 'reversed'
  metric_key: string
  delta: number | null
  delta_pct: number | null
  confidence: number
  computed_at: string
}

export type ItemWithLogs = ExecutionItem & {
  logs: ExecutionLog[]
  outcome?: OutcomeSummary | null
  linked_post?: LinkedContentPost | null
  /** Kanban 卡片内容状态条聚合（文/图/视/发） */
  content_state?: CardContentState | null
  source_kind?: 'execution_item' | 'flywheel_action'
  flywheel_action_id?: string
}

export interface GroupData {
  pid: string
  items: ItemWithLogs[]
  meta?: PrescriptionMeta
  /** Marketing Plan 分组的 meta（与 meta 互斥）*/
  marketingPlanMeta?: MarketingPlanMeta
  label: string
  weight: number
  archived: boolean
  derivable: boolean
  editable: boolean    // 是否允许新增/编辑执行项（自主行动泳道为 false）
  /** 来源类型 — 用于 UI 显示不同 badge */
  kind: 'prescription' | 'marketing_plan' | 'autonomous' | 'fde_manual'
}

// ─── Dimension grouping (new Kanban view) ──────────────────────────────────────

export interface DimensionGroup {
  dimension: string
  label: string
  icon: string
  items: ItemWithLogs[]
  /** weight controls display order */
  weight: number
}

const DIMENSION_META: Record<string, { label: string; icon: string; weight: number }> = {
  social:        { label: '社媒内容',  icon: '📱', weight: 1 },
  seo:           { label: 'SEO 内容', icon: '📝', weight: 2 },
  ai_visibility: { label: 'GEO 内容', icon: '🌐', weight: 3 },
  ads:           { label: '广告',     icon: '📣', weight: 4 },
  reputation:    { label: '口碑',     icon: '⭐', weight: 5 },
  competitor:    { label: '竞品监控', icon: '🔍', weight: 6 },
}

/**
 * Groups non-autonomous execution items by dimension.
 * Autonomous/flywheel items are excluded — they belong in Analytics, not the Kanban.
 * Items with unknown dimensions fall into their own group at the end.
 */
export function buildDimensionGroups(items: ItemWithLogs[]): DimensionGroup[] {
  const byDimension: Record<string, ItemWithLogs[]> = {}

  for (const item of items) {
    if (isAutonomousItem(item)) continue   // flywheel — not for FDE kanban
    if (item.source === 'proactive_signal') continue
    const dim = item.dimension ?? 'other'
    ;(byDimension[dim] ??= []).push(item)
  }

  return Object.entries(byDimension)
    .map(([dimension, dimItems]): DimensionGroup => {
      const meta = DIMENSION_META[dimension]
      return {
        dimension,
        label:  meta?.label ?? dimension,
        icon:   meta?.icon  ?? '📌',
        weight: meta?.weight ?? 99,
        items:  dimItems.sort((a, b) => {
          // pending first, then in_progress, then completed/skipped
          const order: Record<string, number> = { pending: 0, in_progress: 1, completed: 2, skipped: 3 }
          return (order[a.status ?? ''] ?? 9) - (order[b.status ?? ''] ?? 9)
            || (a.sort_order ?? 0) - (b.sort_order ?? 0)
        }),
      }
    })
    .sort((a, b) => a.weight - b.weight)
}

const METRIC_DISPLAY: Record<string, string> = {
  'geo.query.mention_rate':      'Mention rate',
  'geo.query.brand_prominence':  'Brand prominence',
  'geo.query.sentiment_score':   'Sentiment score',
  'seo.keyword.ranking':         'Keyword ranking',
  'ads.roas':                    'ROAS',
  'social.engagement_rate':      'Engagement rate',
}

/** Pure helper — used by OutcomeChip and unit tests (P12.A.10). */
export function formatOutcomeLabel(outcome: OutcomeSummary): string {
  const metricLabel = METRIC_DISPLAY[outcome.metric_key] ?? outcome.metric_key
  const deltaPctStr = outcome.delta_pct !== null
    ? `${outcome.delta_pct > 0 ? '+' : ''}${Math.round(outcome.delta_pct)}%`
    : outcome.delta !== null
      ? `${outcome.delta > 0 ? '+' : ''}${Number(outcome.delta).toFixed(2)}`
      : ''
  const confidenceStr = `confidence ${outcome.confidence.toFixed(2)}`
  return deltaPctStr
    ? `${metricLabel} ${deltaPctStr}, ${outcome.verdict} (${confidenceStr})`
    : `${metricLabel} ${outcome.verdict} (${confidenceStr})`
}

export function isAutonomousItem(item: ItemWithLogs): boolean {
  return item.source_kind === 'flywheel_action' || item.prescription_id === AUTONOMOUS_GROUP_ID
}

/**
 * 计算 item 所属分组的 pid：
 *   - 自主行动 → AUTONOMOUS_GROUP_ID
 *   - fde_manual 来源 → FDE_MANUAL_GROUP_ID（Phase 20.D）
 *   - marketing_plan 来源 → 'mp:' + marketing_plan_id
 *   - 否则 → prescription_id（兜底用空字符串）
 */
function pidForItem(item: ItemWithLogs): string {
  if (isAutonomousItem(item)) return AUTONOMOUS_GROUP_ID
  if (item.source === 'proactive_signal') return AUTONOMOUS_GROUP_ID
  if (item.source === 'fde_manual') return FDE_MANUAL_GROUP_ID
  if (item.source === 'marketing_plan' && item.marketing_plan_id) {
    return MARKETING_PLAN_GROUP_PREFIX + item.marketing_plan_id
  }
  return item.prescription_id ?? ''
}

export function buildExecutionGroups(
  items: ItemWithLogs[],
  prescriptions: PrescriptionMeta[],
  marketingPlans: MarketingPlanMeta[] = [],
): GroupData[] {
  const presMap = new Map(prescriptions.map(p => [p.id, p]))
  const mpMap = new Map(marketingPlans.map(p => [p.id, p]))
  const itemsByGroup: Record<string, ItemWithLogs[]> = {}
  for (const item of items) {
    const pid = pidForItem(item)
    ;(itemsByGroup[pid] ??= []).push(item)
  }

  return Object.entries(itemsByGroup)
    .map(([pid, groupItems]) => {
      if (pid === FDE_MANUAL_GROUP_ID) return buildFdeManualGroup(groupItems)
      if (pid.startsWith(MARKETING_PLAN_GROUP_PREFIX)) {
        const planId = pid.slice(MARKETING_PLAN_GROUP_PREFIX.length)
        return buildMarketingPlanGroup(pid, groupItems, mpMap.get(planId))
      }
      return buildGroup(pid, groupItems, presMap.get(pid))
    })
    .sort((a, b) =>
      a.weight - b.weight ||
      (a.meta?.generated_at ?? a.marketingPlanMeta?.approved_at ?? '').localeCompare(
        b.meta?.generated_at ?? b.marketingPlanMeta?.approved_at ?? '',
      ),
    )
}

function buildGroup(
  pid: string,
  groupItems: ItemWithLogs[],
  meta?: PrescriptionMeta,
): GroupData {
  if (pid === AUTONOMOUS_GROUP_ID) {
    return {
      pid, items: groupItems, label: '飞轮自主行动',
      weight: 0, archived: false, derivable: false, editable: false,
      kind: 'autonomous',
    }
  }

  let label = '处方'; let weight = 5; let archived = false; let derivable = false
  if (meta) {
    if (meta.status === 'superseded') { label = '已归档 · 被修订取代'; weight = 9; archived = true }
    else if (meta.supersedes_id)      { label = '修订版';   weight = 2; derivable = meta.status === 'approved' }
    else if (meta.supplements_id)     { label = '补充处方'; weight = 3; derivable = meta.status === 'approved' }
    else                              { label = '原处方';   weight = 1; derivable = meta.status === 'approved' }
  }

  return {
    pid, items: groupItems, meta, label, weight, archived, derivable,
    editable: !archived,
    kind: 'prescription',
  }
}

function buildMarketingPlanGroup(
  pid: string,
  groupItems: ItemWithLogs[],
  mpMeta?: MarketingPlanMeta,
): GroupData {
  // weight = 4：排在原处方（1）/修订（2）/补充（3）之后、其他处方（5）之前
  const archived = mpMeta?.status === 'archived' || mpMeta?.status === 'completed'
  const label = mpMeta?.title
    ? `📋 ${mpMeta.title}`
    : '📋 Marketing Plan'
  return {
    pid,
    items: groupItems,
    marketingPlanMeta: mpMeta,
    label,
    weight: archived ? 8 : 4,
    archived,
    derivable: false,    // Marketing Plan 不派生（重新生成走 generator）
    editable: !archived,
    kind: 'marketing_plan',
  }
}

/**
 * Phase 20.D — FDE 手动录入分组。
 * weight = 7：排在所有处方/Marketing Plan 之后、飞轮自主行动（0）之前。
 * 任务按 sort_order 排序，FDE 可拖拽调整优先级。
 */
function buildFdeManualGroup(groupItems: ItemWithLogs[]): GroupData {
  // sort by sort_order ascending (already ordered from API)
  const sorted = [...groupItems].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  return {
    pid:      FDE_MANUAL_GROUP_ID,
    items:    sorted,
    label:    '📝 FDE 录入工作',
    weight:   7,
    archived: false,
    derivable: false,
    editable:  true,
    kind:      'fde_manual',
  }
}

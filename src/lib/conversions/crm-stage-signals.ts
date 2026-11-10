/**
 * 线索阶段回传：客户配置解析 + 「哪位客人该报哪一档」的纯计算（2026-11-10）。
 *
 * 纯函数：不碰数据库、不发网络。读写在 `crm-stage-signals-run.ts`。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 做什么
 * ────────────────────────────────────────────────────────────────────────
 * 员工在客户管理页把一位来自 Facebook 即时表单的客人推进到某个阶段时，按 Meta
 * 「Conversion Leads」CRM 集成的格式，把「这条线索走到了某阶段」报回 Meta，让 Meta
 * 能把它对回带来这条线索的广告。
 *
 * 🔴 平台化边界：共享代码里**不写任何客户的阶段名**。哪些阶段要报、报成什么名字、
 *    哪些后续阶段也算「到过」这一档，全部来自 `clients.leads_config.crm_stage_signals`。
 *    换一个客户（地产、旅游、物流）只改配置，不改这里。
 *
 * 三条从 Meta 官方文档核实过、直接决定这里算法的规则（2026-11-10）：
 *   1. 事件时间最多早于发送时刻 7 天，且必须晚于线索生成时间，否则可能被丢弃。
 *   2. 只认即时表单线索（要有线索编号）；没有编号的事件「会被收下但不会被识别」。
 *   3. 「到了后面的阶段，前面的阶段应当已经发过」——所以后面的阶段会补齐前面的。
 */

import type { OutcomeForSend } from './destination-writer'

/** 能往广告平台发的事实种类（与 me_sale_outcomes.outcome_kind 一致）。 */
export type WritebackOutcomeKind = OutcomeForSend['outcomeKind']

// ── 配置 ─────────────────────────────────────────────────────────────────

export type CrmStageDef = {
  /** 发给 Meta 的阶段名，原样作为事件名。 */
  eventName: string
  /** 客户管理页里哪些阶段算「到过这一档」（后续阶段也可以列进来）。可以为空，只要配了 `bookingMilestone`。 */
  stageKeys: string[]
  /**
   * 订单里哪个里程碑被员工标成「已收」也算到过这一档（`deposit` 定金 / `balance` 尾款）。
   * 比客人阶段准：客人阶段常是事后批量补的，订单里程碑是标的那一刻（2026-11-10 CTS 实测）。
   */
  bookingMilestone: BookingMilestoneKind | null
}

export type BookingMilestoneKind = 'deposit' | 'balance'
const BOOKING_KINDS: readonly BookingMilestoneKind[] = ['deposit', 'balance']

/** 订单里程碑在计划器里用的内部阶段名——带冒号，不会跟客户管理页的阶段 key 撞。 */
export function bookingStageKey(kind: BookingMilestoneKind): string {
  return `booking:${kind}`
}

/** 这一档认哪些「阶段变化」：客户管理页的阶段 + 订单里程碑。 */
export function matchKeysOf(def: CrmStageDef): string[] {
  return def.bookingMilestone ? [...def.stageKeys, bookingStageKey(def.bookingMilestone)] : def.stageKeys
}

export type CrmStageSignalsConfig = {
  enabled: boolean
  /** 'live' 才真发；其它一律只生成预览（试运行）。 */
  mode: 'dry_run' | 'live'
  /** 客户在 Meta 后台为线索阶段专门建的数据集编号；没配就发不出去。 */
  datasetId: string | null
  /** Meta 要求的「线索来自哪个系统」。 */
  leadEventSource: string
  /** 可选：线索刚进来时报的第一档名字（Meta 建议连第一档一起报）。不配就不报第一档。 */
  initialEventName: string | null
  /** 从前到后的阶段顺序。 */
  stages: CrmStageDef[]
}

const DEFAULT_LEAD_EVENT_SOURCE = 'Magic Engine'
const EVENT_NAME_MAX = 100

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 && t.length <= EVENT_NAME_MAX ? t : null
}

/**
 * 解析 `leads_config.crm_stage_signals`。格式不对一律当「没开」（返回 null），
 * 不猜、不部分生效——这一路发出去的东西撤不回。
 */
export function parseCrmStageSignalsConfig(leadsConfig: unknown): CrmStageSignalsConfig | null {
  if (!isRecord(leadsConfig)) return null
  const raw = leadsConfig.crm_stage_signals
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.stages)) return null

  const stages: CrmStageDef[] = []
  const seenNames = new Set<string>()
  for (const s of raw.stages) {
    if (!isRecord(s)) return null
    const eventName = cleanName(s.event_name)
    if (!eventName || seenNames.has(eventName)) return null
    if (s.stage_keys != null && !Array.isArray(s.stage_keys)) return null
    const stageKeys = (Array.isArray(s.stage_keys) ? s.stage_keys : []).filter(
      (k): k is string => typeof k === 'string' && k.trim().length > 0,
    )
    let bookingMilestone: BookingMilestoneKind | null = null
    if (s.booking_milestone != null) {
      // 写了但不认识 = 配置写错，整体不生效（不猜成「没写」）
      if (!BOOKING_KINDS.includes(s.booking_milestone as BookingMilestoneKind)) return null
      bookingMilestone = s.booking_milestone as BookingMilestoneKind
    }
    if (stageKeys.length === 0 && !bookingMilestone) return null
    seenNames.add(eventName)
    stages.push({ eventName, stageKeys, bookingMilestone })
  }
  if (stages.length === 0) return null

  const initialEventName = raw.initial_event_name == null ? null : cleanName(raw.initial_event_name)
  if (raw.initial_event_name != null && (!initialEventName || seenNames.has(initialEventName))) return null

  const datasetId = typeof raw.dataset_id === 'string' && /^\d{5,20}$/.test(raw.dataset_id) ? raw.dataset_id : null

  return {
    enabled: raw.enabled === true,
    mode: raw.mode === 'live' ? 'live' : 'dry_run',
    datasetId,
    leadEventSource: cleanName(raw.lead_event_source) ?? DEFAULT_LEAD_EVENT_SOURCE,
    initialEventName,
    stages,
  }
}

/**
 * 读 `leads_config.capi_send_kinds`：这个客户允许往广告平台发哪几类事件。
 * 没写 = 不限制（老客户行为不变）；写了但格式不对 = 一类都不许发（fail-closed）。
 */
export function readCapiSendKinds(leadsConfig: unknown): WritebackOutcomeKind[] | null {
  if (!isRecord(leadsConfig) || !('capi_send_kinds' in leadsConfig)) return null
  const raw = leadsConfig.capi_send_kinds
  if (!Array.isArray(raw)) return []
  const allowed: WritebackOutcomeKind[] = ['purchase', 'balance', 'lead', 'lead_stage']
  return raw.filter((k): k is WritebackOutcomeKind => allowed.includes(k as WritebackOutcomeKind))
}

// ── 计划：哪位客人该报哪一档 ──────────────────────────────────────────────

/** 一条即时表单线索（来自 contact_touchpoints，source=meta_lead_form）。 */
export type FormLead = { contactId: string; leadId: string; createdAt: string }
/** 一次阶段变化（来自 contact_stage_events）。 */
export type StageChange = { contactId: string; toStage: string; at: string }

export type PlannedLeadStageEvent = {
  contactId: string
  leadId: string
  eventName: string
  occurredAt: string
  /** 幂等键：同一条线索的同一档只报一次。 */
  sourceRef: string
  /** 在漏斗里的位置（第一档 = -1），同一时刻按它排先后。 */
  order: number
}

export type PlanSkip = { contactId: string; eventName: string; reason: 'stage_before_any_lead' }

export type PlanResult = { events: PlannedLeadStageEvent[]; skipped: PlanSkip[] }

const LEAD_ID_RE = /^\d{15,17}$/

export function leadStageSourceRef(leadId: string, eventName: string): string {
  return `${leadId}:${eventName}`
}

/**
 * 算出时间窗内该报的线索阶段事件。
 *
 * - 每档的「到达时间」= 这一档或它后面任一档最早发生的时刻（到了后面的档，前面的档也算到过）。
 * - 每档挂在「到达之前最近的那条表单线索」上；到达之前没有任何表单线索 → 跳过并记原因。
 * - 事件时间至少比线索生成时间晚 1 秒（Meta：早于线索时间的事件可能被丢弃）。
 * - 只输出 `[now - windowMs, now]` 之内的；更早的要么已经报过、要么超了平台窗口。
 */
export function planLeadStageEvents(input: {
  config: Pick<CrmStageSignalsConfig, 'stages' | 'initialEventName'>
  leads: FormLead[]
  changes: StageChange[]
  now: Date
  windowMs: number
}): PlanResult {
  const { config, now, windowMs } = input
  const nowMs = now.getTime()
  const sinceMs = nowMs - windowMs
  const inWindow = (ms: number) => ms >= sinceMs && ms <= nowMs

  const leadsByContact = groupBy(
    input.leads.filter((l) => LEAD_ID_RE.test(l.leadId) && Number.isFinite(Date.parse(l.createdAt))),
    (l) => l.contactId,
  )
  const changesByContact = groupBy(
    input.changes.filter((c) => Number.isFinite(Date.parse(c.at))),
    (c) => c.contactId,
  )

  const events: PlannedLeadStageEvent[] = []
  const skipped: PlanSkip[] = []
  const seen = new Set<string>()
  const push = (e: PlannedLeadStageEvent) => {
    if (seen.has(e.sourceRef)) return
    seen.add(e.sourceRef)
    events.push(e)
  }

  // 第一档：每条表单线索进来之后 1 秒（Meta：事件时间要晚于线索生成时间）
  if (config.initialEventName) {
    for (const lead of input.leads) {
      if (!LEAD_ID_RE.test(lead.leadId)) continue
      const ms = Date.parse(lead.createdAt)
      if (!Number.isFinite(ms) || !inWindow(ms) || ms + 1000 > nowMs) continue
      push({
        contactId: lead.contactId,
        leadId: lead.leadId,
        eventName: config.initialEventName,
        occurredAt: new Date(ms + 1000).toISOString(),
        sourceRef: leadStageSourceRef(lead.leadId, config.initialEventName),
        order: -1,
      })
    }
  }

  for (const [contactId, changes] of changesByContact) {
    const leads = (leadsByContact.get(contactId) ?? [])
      .slice()
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

    const firstAt = config.stages.map((def) => {
      const keys = new Set(matchKeysOf(def))
      let min = Infinity
      for (const c of changes) {
        if (keys.has(c.toStage)) min = Math.min(min, Date.parse(c.at))
      }
      return min
    })
    // 到了后面的档 → 前面的档也算到过：从后往前取最小值
    const reachAt = firstAt.slice()
    for (let i = reachAt.length - 2; i >= 0; i--) reachAt[i] = Math.min(reachAt[i], reachAt[i + 1])

    config.stages.forEach((def, i) => {
      const reached = reachAt[i]
      if (!Number.isFinite(reached) || !inWindow(reached)) return
      const lead = latestLeadAtOrBefore(leads, reached)
      if (!lead) {
        skipped.push({ contactId, eventName: def.eventName, reason: 'stage_before_any_lead' })
        return
      }
      const occurredMs = Math.max(reached, Date.parse(lead.createdAt) + 1000)
      if (occurredMs > nowMs) return
      push({
        contactId,
        leadId: lead.leadId,
        eventName: def.eventName,
        occurredAt: new Date(occurredMs).toISOString(),
        sourceRef: leadStageSourceRef(lead.leadId, def.eventName),
        order: i,
      })
    })
  }

  events.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.order - b.order)
  return { events, skipped }
}

function latestLeadAtOrBefore(sortedLeads: FormLead[], atMs: number): FormLead | null {
  let hit: FormLead | null = null
  for (const l of sortedLeads) {
    if (Date.parse(l.createdAt) <= atMs) hit = l
    else break
  }
  return hit
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const arr = m.get(k)
    if (arr) arr.push(it)
    else m.set(k, [it])
  }
  return m
}

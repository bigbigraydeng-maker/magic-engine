/**
 * Maps to magic-engine-platform app/impact Check (comparable after evidence).
 *
 * Read-only declaration of what one goal's progress number counts, which table
 * it would be read from, and which missing fields must stay unknown instead of
 * 0. Does not write goals.current_value and does not query the database.
 *
 * The three outcome-level strings below are local stand-ins. Swap them for the
 * shared outcome-level module once that file is on main. contact_success and
 * qualified_lead are not assigned: no current metric separates those two.
 */

import { PRIMARY_METRIC_CATALOG } from '@/types/strategy'

export const CHECK_PLATFORM_STAGE = 'app/impact.Check' as const

export const CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS = 'contact_success'
export const CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD = 'qualified_lead'
export const CHECK_OUTCOME_LEVEL_CLOSED_DEAL = 'closed_deal'

export const CHECK_OUTCOME_LEVELS = [
  CHECK_OUTCOME_LEVEL_CONTACT_SUCCESS,
  CHECK_OUTCOME_LEVEL_QUALIFIED_LEAD,
  CHECK_OUTCOME_LEVEL_CLOSED_DEAL,
] as const

export type CheckOutcomeLevel = (typeof CHECK_OUTCOME_LEVELS)[number]
export type CheckCountKind = 'bookings' | 'seats' | 'other'
export type CheckCountKindLabel = '笔数' | '座位' | '其他'
export type CheckUnitSource = 'metric_default' | 'goal_config'

export interface CheckSourceGoal {
  id: string
  client_id: string
  intent: string
  primary_metric_key: string
  period_start: string | null
  period_end: string | null
}

/** Opt-in seat rule. Nothing here is implied by industry or by a departure list. */
export interface SeatCountRule {
  rule_id: string
  paid_milestone_kind: 'deposit' | 'balance'
  period_date_field: 'booked_on' | 'departure_depart_on'
}

export interface CheckSourceConfig {
  /** Omit to use the metric default. `seats` applies only to signups_count. */
  count_unit?: CheckCountKind
  seat_rule?: SeatCountRule | null
  /** Accepted and ignored. A departure list must not switch the count unit. */
  departure_dates?: readonly string[]
  /** Optional archive stamp. Invalid values make the declaration unknown. */
  as_of?: string | null
}

export interface CheckUnknownField {
  field: string
  effect: 'unknown'
  reason: string
}

export interface CheckSourceFilter {
  table: string
  column: string
  op: 'eq' | 'is_null' | 'is_not_null' | 'neq' | 'gte' | 'lte'
  value: string | null
}

export interface CheckSourceEvidence {
  evidence_version: '1'
  stage: 'check'
  platform_stage: typeof CHECK_PLATFORM_STAGE
  goal_id: string
  client_id: string
  metric_key: string
  intent: string
  status: 'declared' | 'unknown'
  count_kind: CheckCountKind | null
  count_kind_label_zh: CheckCountKindLabel | null
  count_unit_source: CheckUnitSource | null
  outcome_level: CheckOutcomeLevel | null
  /** Single stored table, or null when the read is ordered across more than one. */
  table: string | null
  also_reads: readonly string[]
  source_order: readonly string[]
  filters: readonly CheckSourceFilter[]
  /** Rule id only when the seat unit is actually open. */
  seat_rule_id: string | null
  unknown_when_missing: readonly CheckUnknownField[]
  missing_fields: readonly string[]
  /** An empty or failed read is archived as unknown, never as 0. */
  empty_read: 'unknown'
  unknown_reason: string | null
  caveats: readonly string[]
  period: { start: string; end: string } | null
  as_of: string | null
  writes_current_value: false
}

const COUNT_LABEL: Readonly<Record<CheckCountKind, CheckCountKindLabel>> = {
  bookings: '笔数',
  seats: '座位',
  other: '其他',
}

const WIRING_CAVEAT = '本说明不写目标当前值。检查页和每日刷新还没调用它。'

const GOAL_FIELDS: readonly CheckUnknownField[] = [
  field('goals.id', '没有目标编号，证据无法归档'),
  field('goals.client_id', '没有客户，不能圈定要读的行'),
  field('goals.intent', '没有意图，就无法判断这是不是成交进度'),
  field('goals.primary_metric_key', '没有指标，就不知道数什么'),
  field('goals.period_start', '没有检查开始日，窗口未知'),
  field('goals.period_end', '没有检查结束日，窗口未知'),
]

const BOOKING_CAVEATS: readonly string[] = [
  '数的是成交行的笔数：一行一笔。不是座位，也不是线索。',
  'purchase 这一列的生意含义不在本模块解释，也不把某一种付款当成全行业的成交。',
  '尾款行和线索行不并进这个数。',
  '一条成交行都没有时是未知，不是 0。',
  '未拒绝且未抹掉的成交行都在范围内。',
  '出发日名单不会把笔数改成座位。',
]

const SEAT_CAVEATS: readonly string[] = [
  '数的是座位（人数），不是预订笔数。只有这条目标把单位设为座位才读预订表。',
  '付款节点和用哪一列日期，都来自这条配置，不是全行业默认。',
  '只使用配置指定的那一种付款节点，另一种不并进这个数。',
  '人数空着、为 0 或不是整数时，整次座位进度未知，不把缺的当成 0，也不只加总已填的行。',
  '配置没写明的来源或产品对应保持未知，本模块不补规则。',
  '每日刷新今天仍按成交笔数取报名数。座位说明还没接到刷新上。',
]

interface Period {
  start: string
  end: string
}

interface Gap {
  field: string
  reason: string
}

interface Identity {
  id: string
  clientId: string
  intent: string
  metricKey: string
}

interface ResolvedRead {
  countKind: CheckCountKind
  unitSource: CheckUnitSource
  outcomeLevel: CheckOutcomeLevel | null
  table: string | null
  alsoReads: readonly string[]
  sourceOrder: readonly string[]
  filters: readonly CheckSourceFilter[]
  seatRuleId: string | null
  unknownWhenMissing: readonly CheckUnknownField[]
  caveats: readonly string[]
}

type AskedUnit = CheckCountKind | 'invalid' | undefined

function field(name: string, reason: string): CheckUnknownField {
  return { field: name, effect: 'unknown', reason }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map((part) => Number(part))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function isIsoDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.exec(value)
  return match !== null && isIsoDate(match[1])
}

function requireText(value: unknown, name: string, reason: string, gaps: Gap[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    gaps.push({ field: name, reason })
    return ''
  }
  return value.trim()
}

function dedupeGaps(gaps: readonly Gap[]): Gap[] {
  const seen = new Set<string>()
  return gaps.filter((gap) => {
    if (seen.has(gap.field)) return false
    seen.add(gap.field)
    return true
  })
}

function normalizeGoal(goal: CheckSourceGoal | null | undefined): CheckSourceGoal {
  if (goal == null) {
    return {
      id: '',
      client_id: '',
      intent: '',
      primary_metric_key: '',
      period_start: null,
      period_end: null,
    }
  }
  return goal
}

function requireIdentity(goal: CheckSourceGoal, gaps: Gap[]): Identity {
  return {
    id: requireText(goal.id, 'goals.id', '没有目标编号，证据无法归档', gaps),
    clientId: requireText(goal.client_id, 'goals.client_id', '没有客户，不能圈定要读的行', gaps),
    intent: requireText(goal.intent, 'goals.intent', '没有意图，就无法判断这是不是成交进度', gaps),
    metricKey: requireText(goal.primary_metric_key, 'goals.primary_metric_key', '没有指标，就不知道数什么', gaps),
  }
}

function readPeriod(goal: CheckSourceGoal, gaps: Gap[]): Period | null {
  const start = goal.period_start
  const end = goal.period_end
  const startOk = typeof start === 'string' && isIsoDate(start)
  const endOk = typeof end === 'string' && isIsoDate(end)
  if (!startOk) {
    const blank = start == null || (typeof start === 'string' && start.trim() === '')
    gaps.push({ field: 'goals.period_start', reason: blank ? '没有检查开始日，窗口未知' : '检查开始日不是有效日期' })
  }
  if (!endOk) {
    const blank = end == null || (typeof end === 'string' && end.trim() === '')
    gaps.push({ field: 'goals.period_end', reason: blank ? '没有检查结束日，窗口未知' : '检查结束日不是有效日期' })
  }
  if (!startOk || !endOk || typeof start !== 'string' || typeof end !== 'string') return null
  if (start > end) {
    gaps.push({ field: 'goals.period_end', reason: '结束日早于开始日，窗口未知' })
    return null
  }
  return { start, end }
}

function readAsOf(value: string | null | undefined, gaps: Gap[]): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') {
    gaps.push({ field: 'config.as_of', reason: '留档时间不是有效时间' })
    return null
  }
  const trimmed = value.trim()
  if (isIsoDate(trimmed) || isIsoDateTime(trimmed)) return trimmed
  gaps.push({ field: 'config.as_of', reason: '留档时间不是有效时间' })
  return null
}

function askedUnit(config: CheckSourceConfig, gaps: Gap[]): AskedUnit {
  if (config.count_unit === undefined) return undefined
  if (config.count_unit === 'bookings' || config.count_unit === 'seats' || config.count_unit === 'other') {
    return config.count_unit
  }
  gaps.push({ field: 'config.count_unit', reason: '进度单位只能是笔数、座位或其他' })
  return 'invalid'
}

function clientEq(table: string, clientId: string): CheckSourceFilter[] {
  if (clientId === '') return []
  return [{ table, column: 'client_id', op: 'eq', value: clientId }]
}

function periodOn(table: string, column: string, period: Period | null): CheckSourceFilter[] {
  if (!period) return []
  return [
    { table, column, op: 'gte', value: period.start },
    { table, column, op: 'lte', value: period.end },
  ]
}

function bookingFilters(clientId: string, period: Period | null): CheckSourceFilter[] {
  const filters: CheckSourceFilter[] = [
    ...clientEq('me_sale_outcomes', clientId),
    { table: 'me_sale_outcomes', column: 'outcome_kind', op: 'eq', value: 'purchase' },
    { table: 'me_sale_outcomes', column: 'redacted_at', op: 'is_null', value: null },
    { table: 'me_sale_outcomes', column: 'review_status', op: 'neq', value: 'rejected' },
  ]
  if (!period) return filters
  return [
    ...filters,
    { table: 'me_sale_outcomes', column: 'occurred_at', op: 'gte', value: `${period.start}T00:00:00Z` },
    { table: 'me_sale_outcomes', column: 'occurred_at', op: 'lte', value: `${period.end}T23:59:59Z` },
  ]
}

function declareBookings(
  clientId: string,
  period: Period | null,
  unitSource: CheckUnitSource,
): ResolvedRead {
  return {
    countKind: 'bookings',
    unitSource,
    outcomeLevel: CHECK_OUTCOME_LEVEL_CLOSED_DEAL,
    table: 'me_sale_outcomes',
    alsoReads: [],
    sourceOrder: ['me_sale_outcomes'],
    filters: bookingFilters(clientId, period),
    seatRuleId: null,
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('me_sale_outcomes.client_id', '行上没有客户，不能算进这条目标'),
      field('me_sale_outcomes.outcome_kind', '分不清成交、尾款、线索时不出数'),
      field('me_sale_outcomes.occurred_at', '没有发生时间，就无法判断落不落在目标周期里'),
      field('me_sale_outcomes.review_status', '看不出是否已拒绝时不出数'),
      field('me_sale_outcomes.redacted_at', '看不出是否已抹掉时不出数'),
    ],
    caveats: BOOKING_CAVEATS,
  }
}

function readSeatRule(rule: SeatCountRule | null | undefined, gaps: Gap[]): SeatCountRule | null {
  if (rule == null) {
    gaps.push({ field: 'config.seat_rule', reason: '要数座位就必须写明规则；没有全行业默认' })
    return null
  }
  const idOk = typeof rule.rule_id === 'string' && rule.rule_id.trim() !== ''
  const milestoneOk = rule.paid_milestone_kind === 'deposit' || rule.paid_milestone_kind === 'balance'
  const dateOk = rule.period_date_field === 'booked_on' || rule.period_date_field === 'departure_depart_on'
  if (!idOk) gaps.push({ field: 'config.seat_rule.rule_id', reason: '座位规则没有编号，不能留档' })
  if (!milestoneOk) {
    gaps.push({ field: 'config.seat_rule.paid_milestone_kind', reason: '没有写明哪一种付款节点算数，不能默认成某一种' })
  }
  if (!dateOk) {
    gaps.push({ field: 'config.seat_rule.period_date_field', reason: '没有写明用哪一列日期对齐目标周期' })
  }
  if (!idOk || !milestoneOk || !dateOk) return null
  return { ...rule, rule_id: rule.rule_id.trim() }
}

function seatFilters(clientId: string, rule: SeatCountRule | null, period: Period | null): CheckSourceFilter[] {
  const filters: CheckSourceFilter[] = [
    ...clientEq('crm_bookings', clientId),
    { table: 'crm_bookings', column: 'status', op: 'eq', value: 'active' },
  ]
  if (rule && period) {
    filters.push(
      { table: 'crm_bookings', column: rule.period_date_field, op: 'gte', value: period.start },
      { table: 'crm_bookings', column: rule.period_date_field, op: 'lte', value: period.end },
    )
  }
  if (!rule) return filters
  return [
    ...filters,
    { table: 'crm_booking_milestones', column: 'kind', op: 'eq', value: rule.paid_milestone_kind },
    { table: 'crm_booking_milestones', column: 'state', op: 'eq', value: 'paid' },
    { table: 'crm_booking_milestones', column: 'paid_on', op: 'is_not_null', value: null },
  ]
}

function declareSeats(
  clientId: string,
  rule: SeatCountRule | null | undefined,
  period: Period | null,
  gaps: Gap[],
): ResolvedRead {
  const parsed = readSeatRule(rule, gaps)
  const dateField = parsed ? `crm_bookings.${parsed.period_date_field}` : 'crm_bookings.period_date'
  return {
    countKind: 'seats',
    unitSource: 'goal_config',
    outcomeLevel: CHECK_OUTCOME_LEVEL_CLOSED_DEAL,
    table: 'crm_bookings',
    alsoReads: ['crm_booking_milestones'],
    sourceOrder: ['crm_bookings', 'crm_booking_milestones'],
    filters: seatFilters(clientId, parsed, period),
    seatRuleId: parsed?.rule_id ?? null,
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('config.seat_rule.rule_id', '座位规则没有编号，不能留档'),
      field('config.seat_rule.paid_milestone_kind', '没有写明哪一种付款节点算数，不能默认成某一种'),
      field('config.seat_rule.period_date_field', '没有写明用哪一列日期对齐目标周期'),
      field('crm_bookings.party_size', '人数空着、为 0 或不是整数时，整次座位进度未知，不记 0'),
      field(dateField, '没有配置指定的日期，就无法落在目标周期里'),
      field('crm_booking_milestones.state', '看不出已付还是未付时不出数'),
      field('crm_booking_milestones.paid_on', '标成已付但没有日期时这条不算，不能补 0'),
    ],
    caveats: SEAT_CAVEATS,
  }
}

interface OtherShape {
  table: string | null
  alsoReads: readonly string[]
  sourceOrder: readonly string[]
  filters: readonly CheckSourceFilter[]
  unknownWhenMissing: readonly CheckUnknownField[]
  caveats: readonly string[]
}

function otherRead(partial: OtherShape): ResolvedRead {
  return {
    countKind: 'other',
    unitSource: 'metric_default',
    outcomeLevel: null,
    seatRuleId: null,
    table: partial.table,
    alsoReads: partial.alsoReads,
    sourceOrder: partial.sourceOrder,
    filters: partial.filters,
    unknownWhenMissing: partial.unknownWhenMissing,
    caveats: partial.caveats,
  }
}

function declareOrganic(clientId: string): ResolvedRead {
  return otherRead({
    table: 'ga4_traffic_snapshots',
    alsoReads: [],
    sourceOrder: ['ga4_traffic_snapshots'],
    filters: clientEq('ga4_traffic_snapshots', clientId),
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('ga4_traffic_snapshots.top_sources', '没有来源明细时不能只数自然访问，不用总访问量代替，也不记 0'),
    ],
    caveats: [
      '只说明自然访问这一路。现有取数读最近一张快照，不按目标周期过滤。',
      '来源明细缺失时未知，不用总访问量填数。',
    ],
  })
}

function declareForms(clientId: string): ResolvedRead {
  return otherRead({
    table: 'ga4_traffic_snapshots',
    alsoReads: [],
    sourceOrder: ['ga4_traffic_snapshots'],
    filters: clientEq('ga4_traffic_snapshots', clientId),
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('ga4_traffic_snapshots.top_sources.conversions', '转化次数缺失或加总为 0 时视为追踪没接上，不是 0 次提交'),
    ],
    caveats: [
      '数的是其他：表单提交。不是合格线索，也不是成交。',
      '现有取数读最近一张快照，不按目标周期过滤。加总为 0 时不出数。',
    ],
  })
}

function declareLeads(clientId: string, period: Period | null): ResolvedRead {
  return otherRead({
    table: null,
    alsoReads: [],
    sourceOrder: ['ga4_traffic_snapshots', 'ad_daily_insights'],
    filters: [
      ...clientEq('ga4_traffic_snapshots', clientId),
      ...clientEq('ad_daily_insights', clientId),
      { table: 'ad_daily_insights', column: 'level', op: 'eq', value: 'adset' },
      ...periodOn('ad_daily_insights', 'insight_date', period),
    ],
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('ga4_traffic_snapshots.top_sources', '快照没有来源明细时，这一路不出数'),
      field('ga4_traffic_snapshots.top_sources.conversions', '转化次数缺失或加总为 0 时视为追踪没接上，不是 0 条线索'),
      field('ad_daily_insights.actions', '广告留资这一路里，有一行归不到具体广告时，整次未知，不记 0'),
    ],
    caveats: [
      '数的是其他，不是报名笔数，也不是座位。',
      '不区分联系成功和合格线索，也不能当成成交。',
      '有起止日期时先数广告留资，结束日收到今天，开始日之前的不计。没有起止日期时才先读网站最近快照，读不成才读广告留资。',
      '本模块不选今天用了哪张表，也不出数。',
    ],
  })
}

function declareMessaging(clientId: string, period: Period | null): ResolvedRead {
  return otherRead({
    table: 'ad_daily_insights',
    alsoReads: [],
    sourceOrder: ['ad_daily_insights'],
    filters: [
      ...clientEq('ad_daily_insights', clientId),
      { table: 'ad_daily_insights', column: 'level', op: 'eq', value: 'adset' },
      ...periodOn('ad_daily_insights', 'insight_date', period),
    ],
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('ad_daily_insights.actions', '有一行私信开聊归不到具体广告时，整次未知，不记 0'),
    ],
    caveats: [
      '数的是其他：私信开启次数。它不是联系成功，也不是合格线索，也不是成交。',
      '有一行归不上时整次未知，不把那一行记成 0。',
    ],
  })
}

function declareBrand(clientId: string): ResolvedRead {
  return otherRead({
    table: 'gsc_performance_snapshots',
    alsoReads: ['clients'],
    sourceOrder: ['gsc_performance_snapshots', 'keyword_volume_live'],
    filters: [
      ...clientEq('gsc_performance_snapshots', clientId),
      ...clientEq('clients', clientId),
    ],
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('clients.domain', '抽不出品牌词根，且没有 brand_aliases 时，品牌搜索量未知'),
      field('clients.brand_aliases', '没有品牌别名，且域名也抽不出品牌词根时，品牌搜索量未知'),
      field('gsc_performance_snapshots.top_queries', '快照没有查询词时，这一路不出数，不记 0'),
    ],
    caveats: [
      '先读搜索快照里的品牌词点击。快照不按目标周期过滤。',
      '对不上品牌词时未知。外部搜索量只是取数里的退路，本模块不调用，也不出数。',
    ],
  })
}

function declareAi(clientId: string): ResolvedRead {
  return otherRead({
    table: 'industry_ai_visibility_snapshots',
    alsoReads: ['clients'],
    sourceOrder: ['industry_ai_visibility_snapshots'],
    filters: clientEq('clients', clientId),
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('clients.name', '没有客户名时不能对上可见度快照，不出数'),
      field('clients.industry', '行业对不上可见度题集时未知，不套用别的行业'),
      field('industry_ai_visibility_snapshots.collected_date', '快照不是当天时未知，不用旧快照填 0'),
      field('industry_ai_visibility_snapshots.question_id', '题没有测全时分数不可算，不是 0 分'),
    ],
    caveats: [
      '快照按行业题集，不按目标周期过滤，也不按客户各存一份。',
      '客户名缺失、行业对不上、当天没有完整快照时未知，不是 0 分。',
    ],
  })
}

function declareGsc(clientId: string): ResolvedRead {
  return otherRead({
    table: 'gsc_page_daily',
    alsoReads: [],
    sourceOrder: ['gsc_page_daily'],
    filters: clientEq('gsc_page_daily', clientId),
    unknownWhenMissing: [
      ...GOAL_FIELDS,
      field('gsc_page_daily.day', '没有已入库日、最新日过旧或窗口天数不全时未知，不加总残缺天数'),
      field('gsc_page_daily.clicks', '点击缺失或读取被截断时未知，不把缺的记成 0'),
    ],
    caveats: [
      '数的是其他：全站谷歌点击。不是报名笔数，也不是座位。',
      '现有取数的窗口是最近一个已入库日起往前 28 天，不是目标周期。',
      '没有行、数据过旧、天数不全或读到截断时未知。',
    ],
  })
}

const IMPLEMENTED: Readonly<Record<string, (clientId: string, period: Period | null) => ResolvedRead>> = {
  organic_traffic: (clientId) => declareOrganic(clientId),
  brand_search_volume: (clientId) => declareBrand(clientId),
  form_submissions: (clientId) => declareForms(clientId),
  leads_count: (clientId, period) => declareLeads(clientId, period),
  messaging_started: (clientId, period) => declareMessaging(clientId, period),
  ai_visibility_score: (clientId) => declareAi(clientId),
  seo_gsc_clicks_28d: (clientId) => declareGsc(clientId),
}

function declareNoTable(name: string, reason: string, caveats: readonly string[], gaps: Gap[]): ResolvedRead {
  gaps.push({ field: name, reason })
  return otherRead({
    table: null,
    alsoReads: [],
    sourceOrder: [],
    filters: [],
    unknownWhenMissing: [...GOAL_FIELDS, field(name, reason)],
    caveats,
  })
}

function resolveCatalog(metricKey: string, clientId: string, period: Period | null, gaps: Gap[]): ResolvedRead {
  const implemented = IMPLEMENTED[metricKey]
  if (implemented) return implemented(clientId, period)
  const catalog = PRIMARY_METRIC_CATALOG.find((metric) => metric.key === metricKey)
  if (!catalog) {
    return declareNoTable('metric_source', '不认识这个指标，不出数，也不记 0', ['指标目录里没有这个键'], gaps)
  }
  if (catalog.measurement === 'self_report') {
    return declareNoTable('manual_reading', '这个指标要人填，这里不生成数字；空着不是 0', ['没有自动来源表'], gaps)
  }
  if (catalog.measurement === 'verification') {
    return declareNoTable(
      'verification_evidence',
      '这是验证指标。证据不足时是未知，本模块不出数',
      ['不在这里结算合格提及覆盖'],
      gaps,
    )
  }
  return declareNoTable('auto_fetch_source', '现有取数没有这个指标的表，不出数，不记 0', ['本模块不编一个来源'], gaps)
}

function resolveSignups(
  clientId: string,
  config: CheckSourceConfig,
  period: Period | null,
  asked: AskedUnit,
  gaps: Gap[],
): ResolvedRead | null {
  if (asked === 'other') {
    gaps.push({ field: 'config.count_unit', reason: '报名进度只能是笔数，或由配置显式改为座位' })
    return null
  }
  if (asked === 'seats') return declareSeats(clientId, config.seat_rule, period, gaps)
  const unitSource: CheckUnitSource = asked === 'bookings' ? 'goal_config' : 'metric_default'
  return declareBookings(clientId, period, unitSource)
}

function resolveRead(
  identity: Identity,
  config: CheckSourceConfig,
  period: Period | null,
  asked: AskedUnit,
  gaps: Gap[],
): ResolvedRead | null {
  if (asked === 'invalid' || identity.metricKey === '') return null
  if (identity.metricKey === 'signups_count') {
    return resolveSignups(identity.clientId, config, period, asked, gaps)
  }
  if (asked === 'bookings' || asked === 'seats') {
    gaps.push({
      field: 'config.count_unit',
      reason: asked === 'seats'
        ? '座位只适用于报名/预订指标，不能套到当前指标'
        : '笔数只适用于报名/预订指标，不能套到当前指标',
    })
    return null
  }
  return resolveCatalog(identity.metricKey, identity.clientId, period, gaps)
}

function ignoredSeatCaveat(metricKey: string, asked: AskedUnit, config: CheckSourceConfig): readonly string[] {
  if (metricKey !== 'signups_count') return []
  if (asked !== undefined && asked !== 'bookings') return []
  if (config.seat_rule == null) return []
  return ['配置里写了座位规则，但没有把单位设为座位，所以仍按笔数']
}

function salesCaveat(intent: string, read: ResolvedRead | null): readonly string[] {
  if (intent !== 'sales' || read == null) return []
  if (read.outcomeLevel === CHECK_OUTCOME_LEVEL_CLOSED_DEAL) return []
  return ['销售目标的进度不能用这个数代替成交']
}

function toEvidence(
  identity: Identity,
  period: Period | null,
  asOf: string | null,
  read: ResolvedRead | null,
  extraCaveats: readonly string[],
  gaps: readonly Gap[],
): CheckSourceEvidence {
  const unique = dedupeGaps(gaps)
  const declared = unique.length === 0 && read !== null
  return {
    evidence_version: '1',
    stage: 'check',
    platform_stage: CHECK_PLATFORM_STAGE,
    goal_id: identity.id,
    client_id: identity.clientId,
    metric_key: identity.metricKey,
    intent: identity.intent,
    status: declared ? 'declared' : 'unknown',
    count_kind: read?.countKind ?? null,
    count_kind_label_zh: read ? COUNT_LABEL[read.countKind] : null,
    count_unit_source: read?.unitSource ?? null,
    outcome_level: read?.outcomeLevel ?? null,
    table: read?.table ?? null,
    also_reads: [...(read?.alsoReads ?? [])],
    source_order: [...(read?.sourceOrder ?? [])],
    filters: [...(read?.filters ?? [])],
    seat_rule_id: read?.seatRuleId ?? null,
    unknown_when_missing: [...(read?.unknownWhenMissing ?? GOAL_FIELDS)],
    missing_fields: unique.map((gap) => gap.field),
    empty_read: 'unknown',
    unknown_reason: declared ? null : unique.map((gap) => gap.reason).join('；'),
    caveats: [...(read?.caveats ?? []), ...extraCaveats, WIRING_CAVEAT],
    period,
    as_of: asOf,
    writes_current_value: false,
  }
}

/**
 * Describe the check source for one goal. Pure: no database, no current value.
 * A missing field yields status `unknown` and no progress number.
 */
export function describeCheckSource(
  goal: CheckSourceGoal,
  config: CheckSourceConfig = {},
): CheckSourceEvidence {
  const gaps: Gap[] = []
  const safeGoal = normalizeGoal(goal)
  const safeConfig = config ?? {}
  const identity = requireIdentity(safeGoal, gaps)
  const period = readPeriod(safeGoal, gaps)
  const asOf = readAsOf(safeConfig.as_of, gaps)
  const asked = askedUnit(safeConfig, gaps)
  const read = resolveRead(identity, safeConfig, period, asked, gaps)
  const extraCaveats = [
    ...ignoredSeatCaveat(identity.metricKey, asked, safeConfig),
    ...salesCaveat(identity.intent, read),
  ]
  return toEvidence(identity, period, asOf, read, extraCaveats, gaps)
}

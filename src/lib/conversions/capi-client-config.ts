/**
 * Per-client Meta send settings stored on `clients.leads_config`.
 *
 * Three keys, all optional:
 *   - `capi_allowed_events` — event names that may be sent
 *   - `capi_qualified_lead_stage_key` — which pipeline stage counts as a qualified lead
 *   - `capi_deal_milestone` / `capi_deal_stage_key` — which payment milestone or stage counts as a deal
 *
 * Nothing here is chosen by client id. A missing allowed-event list keeps today's
 * send behaviour. The deal-only list below is documentation for the person who
 * sets production config; this module never applies it on its own.
 *
 * `capi_conversion_leads` turns on Conversion Leads for this client. The quoted
 * event name is `capi_qualified_lead_stage_key`. The later deal step uses
 * `capi_conversion_deal_stage_key`, which is not the hand-entered amount step.
 * Matching the quoted stage does not look at who set it. An absent or unreadable
 * switch stays off.
 */

/** Staff mark and the conversation reader both count. The actor is not an input. */
export function stageCountsAsQualifiedLead(stageKey: string | null, configuredStageKey: string | null): boolean {
  if (stageKey == null || configuredStageKey == null) return false
  return stageKey === configuredStageKey
}

export const DOCUMENTED_DEAL_ONLY_EVENTS = ['Purchase', 'BalancePaid'] as const

/**
 * Business fact → platform event name.
 * A balance payment is its own event. Sending it as Purchase would count one
 * sale twice, and the platform does not merge those events.
 */
export const CAPI_EVENT_BY_KIND = {
  purchase: 'Purchase',
  balance: 'BalancePaid',
  lead: 'Lead',
} as const

export type CapiOutcomeKind = keyof typeof CAPI_EVENT_BY_KIND
export type DealMilestone = 'deposit' | 'balance'

const DEAL_MILESTONES: readonly DealMilestone[] = ['deposit', 'balance']
const STAGE_KEY_RE = /^[a-z0-9_]{1,64}$/

export type CapiClientConfig = {
  /** `null` means the key is absent: the sender keeps today's behaviour. */
  allowedEvents: string[] | null
  allowedEventsMalformed: boolean
  /** Parsed only. Not a permission to send. */
  qualifiedLeadStageKey: string | null
  qualifiedLeadStageMalformed: boolean
  dealMilestone: DealMilestone | null
  dealMilestoneMalformed: boolean
  dealStageKey: string | null
  dealStageKeyMalformed: boolean
  /** Absent, false, or unreadable: do not send Conversion Leads. */
  conversionLeadsEnabled: boolean
  conversionLeadsMalformed: boolean
  /** CRM stage name for a deal that continues the same Meta lead. */
  conversionDealStageKey: string | null
  conversionDealStageMalformed: boolean
}

export type AllowDecision = { allow: true } | { allow: false; reason: string }

export function capiEventNameForKind(kind: CapiOutcomeKind): string {
  return CAPI_EVENT_BY_KIND[kind]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasKey(cfg: Record<string, unknown> | null, key: string): boolean {
  return cfg !== null && Object.prototype.hasOwnProperty.call(cfg, key)
}

export function readCapiClientConfig(leadsConfig: unknown): CapiClientConfig {
  const cfg = isRecord(leadsConfig) ? leadsConfig : null
  const allowed = readAllowedEvents(cfg)
  const qualified = readStageKey(cfg, 'capi_qualified_lead_stage_key')
  const milestone = readDealMilestone(cfg)
  const stage = readStageKey(cfg, 'capi_deal_stage_key')
  const conversion = readFlag(cfg, 'capi_conversion_leads')
  const conversionDeal = readStageKey(cfg, 'capi_conversion_deal_stage_key')
  return {
    allowedEvents: allowed.events,
    allowedEventsMalformed: allowed.malformed,
    qualifiedLeadStageKey: qualified.value,
    qualifiedLeadStageMalformed: qualified.malformed,
    dealMilestone: milestone.value,
    dealMilestoneMalformed: milestone.malformed,
    dealStageKey: stage.value,
    dealStageKeyMalformed: stage.malformed,
    conversionLeadsEnabled: conversion.enabled,
    conversionLeadsMalformed: conversion.malformed,
    conversionDealStageKey: conversionDeal.value,
    conversionDealStageMalformed: conversionDeal.malformed,
  }
}

/**
 * Events missing from a present list stay queued. An absent list does not
 * filter. A present but unreadable list fails closed (hold, do not send).
 * Held rows are not a finished trial run: a later send rechecks the list
 * and can still go out inside the platform window.
 */
export function decideCapiEventAllowed(leadsConfig: unknown, eventName: string): AllowDecision {
  const cfg = readCapiClientConfig(leadsConfig)
  if (cfg.allowedEventsMalformed) {
    return { allow: false, reason: hold('允许发送的事件名单格式不对') }
  }
  if (cfg.allowedEvents === null) return { allow: true }
  if (cfg.allowedEvents.length === 0) {
    return { allow: false, reason: hold('允许发送的事件名单是空的') }
  }
  if (!cfg.allowedEvents.includes(eventName)) {
    return { allow: false, reason: hold(`事件 ${eventName} 不在允许发送的名单里（${cfg.allowedEvents.join('、')}）`) }
  }
  return { allow: true }
}

function hold(why: string): string {
  return `${why}。这条先停在排队里，没有发给广告平台。把这件事加进允许名单之后，只要还在 7 天内，下一次发送会再试。`
}

/** Labels for the settings page. The stored value is the platform event name. */
export const CAPI_EVENT_CHOICES = [
  { name: 'Purchase', label: '成交' },
  { name: 'BalancePaid', label: '尾款' },
  { name: 'Lead', label: '咨询' },
] as const

export const DEAL_MILESTONE_CHOICES = [
  { value: 'deposit' as const, label: '定金' },
  { value: 'balance' as const, label: '尾款' },
]

export type CapiSettingsView = {
  capiAllowedEvents: string[] | null
  capiAllowedEventsMalformed: boolean
  capiDealMilestone: DealMilestone | null
  capiDealMilestoneMalformed: boolean
  capiQualifiedLeadStageKey: string | null
  capiQualifiedLeadStageMalformed: boolean
  capiDealStageKey: string | null
  capiDealStageKeyMalformed: boolean
  capiConversionLeads: boolean
  capiConversionLeadsMalformed: boolean
  capiConversionDealStageKey: string | null
  capiConversionDealStageMalformed: boolean
}

export function capiSettingsView(leadsConfig: unknown): CapiSettingsView {
  const cfg = readCapiClientConfig(leadsConfig)
  return {
    capiAllowedEvents: cfg.allowedEvents,
    capiAllowedEventsMalformed: cfg.allowedEventsMalformed,
    capiDealMilestone: cfg.dealMilestone,
    capiDealMilestoneMalformed: cfg.dealMilestoneMalformed,
    capiQualifiedLeadStageKey: cfg.qualifiedLeadStageKey,
    capiQualifiedLeadStageMalformed: cfg.qualifiedLeadStageMalformed,
    capiDealStageKey: cfg.dealStageKey,
    capiDealStageKeyMalformed: cfg.dealStageKeyMalformed,
    capiConversionLeads: cfg.conversionLeadsEnabled,
    capiConversionLeadsMalformed: cfg.conversionLeadsMalformed,
    capiConversionDealStageKey: cfg.conversionDealStageKey,
    capiConversionDealStageMalformed: cfg.conversionDealStageMalformed,
  }
}

export type CapiSettingsWriteInput = {
  capiAllowedEvents?: unknown
  capiDealMilestone?: unknown
  capiQualifiedLeadStageKey?: unknown
  capiDealStageKey?: unknown
  capiConversionLeads?: unknown
  capiConversionDealStageKey?: unknown
}

export type CapiSettingsWrite =
  | { touched: false }
  | { touched: true; error: string }
  | {
      touched: true
      error?: undefined
      allowed?: string[] | null
      milestone?: DealMilestone | null
      qualified?: string | null
      dealStage?: string | null
      conversionLeads?: boolean | null
      conversionDeal?: string | null
    }

const WRITABLE_EVENTS = new Set<string>(CAPI_EVENT_CHOICES.map((c) => c.name))

/** Partial write. A field left out of the body is not touched. `null` clears the key. */
export function normalizeCapiSettingsWrite(input: CapiSettingsWriteInput): CapiSettingsWrite {
  const allowed = readEventWrite(input.capiAllowedEvents)
  if ('error' in allowed) return { touched: true, error: allowed.error }
  const milestone = readMilestoneWrite(input.capiDealMilestone)
  if ('error' in milestone) return { touched: true, error: milestone.error }
  const qualified = readStageWrite(input.capiQualifiedLeadStageKey, '合格咨询')
  if ('error' in qualified) return { touched: true, error: qualified.error }
  const dealStage = readStageWrite(input.capiDealStageKey, '手录成交')
  if ('error' in dealStage) return { touched: true, error: dealStage.error }
  const conversionLeads = readFlagWrite(input.capiConversionLeads)
  if ('error' in conversionLeads) return { touched: true, error: conversionLeads.error }
  const conversionDeal = readStageWrite(input.capiConversionDealStageKey, '成交阶段')
  if ('error' in conversionDeal) return { touched: true, error: conversionDeal.error }
  const touched =
    allowed.value !== undefined ||
    milestone.value !== undefined ||
    qualified.value !== undefined ||
    dealStage.value !== undefined ||
    conversionLeads.value !== undefined ||
    conversionDeal.value !== undefined
  if (!touched) return { touched: false }
  return {
    touched: true,
    allowed: allowed.value,
    milestone: milestone.value,
    qualified: qualified.value,
    dealStage: dealStage.value,
    conversionLeads: conversionLeads.value,
    conversionDeal: conversionDeal.value,
  }
}

/** Opening the switch needs both stage names. A closed switch does not. */
export function conversionLeadOptInError(leadsConfig: unknown): string | null {
  const cfg = readCapiClientConfig(leadsConfig)
  if (!cfg.conversionLeadsEnabled) return null
  if (!cfg.qualifiedLeadStageKey) return '打开线索阶段回传之前，先选哪一步算合格咨询'
  if (!cfg.conversionDealStageKey) return '打开线索阶段回传之前，先选成交记在这条线索的哪一步'
  return null
}

/** Success arm of {@link CapiSettingsWrite}. `error: ""` is still a failure — a falsy check does not narrow it. */
export function readyCapiSettingsWrite(
  write: CapiSettingsWrite,
): write is Extract<CapiSettingsWrite, { touched: true; error?: undefined }> {
  if (!write.touched) return false
  return !('error' in write && typeof write.error === 'string')
}

export function applyCapiSettingsWrite(
  current: Record<string, unknown>,
  write: Extract<CapiSettingsWrite, { touched: true; error?: undefined }>,
): Record<string, unknown> {
  const next = { ...current }
  assignOrDelete(next, 'capi_allowed_events', write.allowed)
  assignOrDelete(next, 'capi_deal_milestone', write.milestone)
  assignOrDelete(next, 'capi_qualified_lead_stage_key', write.qualified)
  assignOrDelete(next, 'capi_deal_stage_key', write.dealStage)
  assignOrDelete(next, 'capi_conversion_leads', write.conversionLeads)
  assignOrDelete(next, 'capi_conversion_deal_stage_key', write.conversionDeal)
  return next
}

function assignOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) return
  if (value === null) delete target[key]
  else target[key] = value
}

function readEventWrite(value: unknown): { value?: string[] | null; error?: string } {
  if (value === undefined) return {}
  if (value === null) return { value: null }
  if (!Array.isArray(value)) return { error: '允许发送的事件必须是清单，留空表示不限制' }
  const events: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !WRITABLE_EVENTS.has(item)) {
      return { error: '允许发送的事件只能勾选成交、尾款、咨询' }
    }
    if (!events.includes(item)) events.push(item)
  }
  return { value: events }
}

function readMilestoneWrite(value: unknown): { value?: DealMilestone | null; error?: string } {
  if (value === undefined) return {}
  if (value === null || value === '') return { value: null }
  if (value === 'deposit' || value === 'balance') return { value }
  return { error: '哪一笔记成成交只能选定金或尾款，留空表示不自动记' }
}

function readFlagWrite(value: unknown): { value?: boolean | null; error?: string } {
  if (value === undefined) return {}
  if (value === null || value === false) return { value: null }
  if (value === true) return { value: true }
  return { error: '线索阶段回传只能开或关' }
}

function readStageWrite(value: unknown, label: string): { value?: string | null; error?: string } {
  if (value === undefined) return {}
  if (value === null || value === '') return { value: null }
  if (typeof value !== 'string' || !STAGE_KEY_RE.test(value)) {
    return { error: `${label}那一步选得不对，请从跟进步骤里重选` }
  }
  return { value }
}

function readAllowedEvents(cfg: Record<string, unknown> | null): { events: string[] | null; malformed: boolean } {
  if (!hasKey(cfg, 'capi_allowed_events')) return { events: null, malformed: false }
  const raw = cfg?.capi_allowed_events
  if (!Array.isArray(raw)) return { events: null, malformed: true }
  const events: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim() === '' || item.trim() !== item) {
      return { events: null, malformed: true }
    }
    events.push(item)
  }
  return { events, malformed: false }
}

type StageConfigKey =
  | 'capi_qualified_lead_stage_key'
  | 'capi_deal_stage_key'
  | 'capi_conversion_deal_stage_key'

function readFlag(
  cfg: Record<string, unknown> | null,
  key: 'capi_conversion_leads',
): { enabled: boolean; malformed: boolean } {
  if (!hasKey(cfg, key)) return { enabled: false, malformed: false }
  const raw = cfg?.[key]
  if (raw === true) return { enabled: true, malformed: false }
  if (raw === false) return { enabled: false, malformed: false }
  return { enabled: false, malformed: true }
}

function readStageKey(
  cfg: Record<string, unknown> | null,
  key: StageConfigKey,
): { value: string | null; malformed: boolean } {
  if (!hasKey(cfg, key)) return { value: null, malformed: false }
  const raw = cfg?.[key]
  if (typeof raw !== 'string' || !STAGE_KEY_RE.test(raw)) return { value: null, malformed: true }
  return { value: raw, malformed: false }
}

function readDealMilestone(cfg: Record<string, unknown> | null): { value: DealMilestone | null; malformed: boolean } {
  if (!hasKey(cfg, 'capi_deal_milestone')) return { value: null, malformed: false }
  const raw = cfg?.capi_deal_milestone
  if (typeof raw !== 'string' || !(DEAL_MILESTONES as readonly string[]).includes(raw)) {
    return { value: null, malformed: true }
  }
  return { value: raw as DealMilestone, malformed: false }
}

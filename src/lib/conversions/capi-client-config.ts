/**
 * Per-client Meta send settings stored on `clients.leads_config`.
 *
 * Three keys, all optional:
 *   - `capi_allowed_events` — event names that may leave dry-run
 *   - `capi_qualified_lead_stage_key` — which pipeline stage counts as a qualified lead
 *   - `capi_deal_milestone` / `capi_deal_stage_key` — which payment milestone or stage counts as a deal
 *
 * Nothing here is chosen by client id. A missing allowed-event list keeps today's
 * send behaviour. The deal-only list below is documentation for the person who
 * sets production config; this module never applies it on its own.
 *
 * The qualified-lead stage is parsed so the setting has one home. Callers must
 * not send from it until that send path is explicitly approved.
 */

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
  return {
    allowedEvents: allowed.events,
    allowedEventsMalformed: allowed.malformed,
    qualifiedLeadStageKey: qualified.value,
    qualifiedLeadStageMalformed: qualified.malformed,
    dealMilestone: milestone.value,
    dealMilestoneMalformed: milestone.malformed,
    dealStageKey: stage.value,
    dealStageKeyMalformed: stage.malformed,
  }
}

/**
 * Events missing from a present list stay in dry-run. An absent list does not
 * filter. A present but unreadable list fails closed (hold, do not send).
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
  return `${why}，这条先停在试运行，没有发给广告平台。`
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

function readStageKey(
  cfg: Record<string, unknown> | null,
  key: 'capi_qualified_lead_stage_key' | 'capi_deal_stage_key',
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

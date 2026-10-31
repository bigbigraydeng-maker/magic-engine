/**
 * Meta Conversion Leads envelope for one CRM lead.
 *
 * A quoted stage and a later deal are two steps of the same Meta lead when
 * the original form id is present. The stage name always comes from the
 * client's settings or from the row that was recorded with those settings.
 * Nothing here is a production stage name.
 */

import { readCapiClientConfig } from './capi-client-config'

export const CONVERSION_EVENT_SOURCE = 'crm'
export const CONVERSION_CRM_NAME = 'Magic Engine'

export const NO_META_LEAD_MESSAGE =
  '这条不是从 Meta 表单来的，没有原始线索编号，不能按线索阶段回传，也没有改发成普通咨询。'

const QUALIFIED_PREFIX = 'crm_qualified:'
const LEAD_ID_RE = /^\d{15,17}$/
const STAGE_KEY_RE = /^[a-z0-9_]{1,64}$/

export function legalMetaLeadId(value: string | null | undefined): string | null {
  if (!value || !LEAD_ID_RE.test(value)) return null
  return value
}

/** One row per Meta lead id and stage. The stage key is the event name sent later. */
export function qualifiedLeadSourceRef(leadId: string, stageKey: string): string {
  return `${QUALIFIED_PREFIX}${leadId}:${stageKey}`
}

export function isQualifiedLeadSource(sourceRef: string | null | undefined): boolean {
  return typeof sourceRef === 'string' && sourceRef.startsWith(QUALIFIED_PREFIX)
}

export function stageKeyFromQualifiedRef(sourceRef: string | null | undefined): string | null {
  if (!sourceRef || !sourceRef.startsWith(QUALIFIED_PREFIX)) return null
  const rest = sourceRef.slice(QUALIFIED_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep < 0) return null
  const stageKey = rest.slice(sep + 1)
  return STAGE_KEY_RE.test(stageKey) ? stageKey : null
}

export type ConversionLeadResolution =
  | { kind: 'ordinary' }
  | { kind: 'stage'; eventName: string }
  | { kind: 'refuse'; message: string }

/**
 * Qualified-stage rows stay on the conversion-lead shape even after the
 * switch is turned off, so they cannot fall back to an ordinary Lead.
 * A deal stays ordinary here. Its stage step is a second event, chosen by
 * dealStageEventName, so the original purchase or balance is still sent.
 */
export function resolveConversionLead(input: {
  outcomeKind: 'purchase' | 'balance' | 'lead'
  sourceRef: string | null
  metaLeadId: string | null
  leadsConfig: unknown
}): ConversionLeadResolution {
  if (input.outcomeKind === 'lead' && isQualifiedLeadSource(input.sourceRef)) {
    return quotedResolution(input.sourceRef, input.metaLeadId)
  }
  return { kind: 'ordinary' }
}

/** Companion id. Different from the sale row id, so the two events dedupe apart. */
export function dealStageEventId(outcomeId: string): string {
  return `${outcomeId}:conversion-stage`
}

/**
 * Stage name for the companion event on a deal that already has a Meta lead id.
 * Null means do not send the companion. The original purchase or balance still sends.
 */
export function dealStageEventName(leadsConfig: unknown, metaLeadId: string | null): string | null {
  const cfg = readCapiClientConfig(leadsConfig)
  if (!cfg.conversionLeadsEnabled || !cfg.conversionDealStageKey) return null
  if (!legalMetaLeadId(metaLeadId)) return null
  return cfg.conversionDealStageKey
}

/** Latest legal form id. Missing or unreadable times sort last. */
export function latestMetaLeadId(
  rows: Array<{ source_ref?: unknown; occurred_at?: unknown }>,
): string | null {
  const ranked: Array<{ leadId: string; at: number }> = []
  for (const row of rows) {
    const leadId = legalMetaLeadId(typeof row.source_ref === 'string' ? row.source_ref : null)
    if (leadId) ranked.push({ leadId, at: occurredAtMs(row.occurred_at) })
  }
  ranked.sort((a, b) => b.at - a.at)
  return ranked[0]?.leadId ?? null
}

function occurredAtMs(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '') return Number.NEGATIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed
}

/**
 * A quoted row keeps the stage name stored on it. Sending still waits for the
 * current switch: off or unreadable means hold, and never an ordinary Lead.
 */
export function qualifiedLeadHoldReason(leadsConfig: unknown): string | null {
  const cfg = readCapiClientConfig(leadsConfig)
  if (cfg.conversionLeadsEnabled) return null
  const why = cfg.conversionLeadsMalformed
    ? '线索阶段回传的开关读不出来'
    : '这个客户的线索阶段回传现在是关的'
  return `${why}。这条先停住，没有发给广告平台，也没有改成普通咨询。`
}

function quotedResolution(sourceRef: string | null, metaLeadId: string | null): ConversionLeadResolution {
  const eventName = stageKeyFromQualifiedRef(sourceRef)
  if (!eventName) {
    return { kind: 'refuse', message: '这条合格咨询的阶段名读不出来，没有改发成普通咨询。' }
  }
  if (!legalMetaLeadId(metaLeadId)) return { kind: 'refuse', message: NO_META_LEAD_MESSAGE }
  return { kind: 'stage', eventName }
}


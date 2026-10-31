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

/** One row per contact and stage. The stage key is the event name sent later. */
export function qualifiedLeadSourceRef(contactId: string, stageKey: string): string {
  return `${QUALIFIED_PREFIX}${contactId}:${stageKey}`
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
 * A deal with no lead id, or with the switch off, stays on the original event.
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
  if (input.outcomeKind === 'purchase' || input.outcomeKind === 'balance') {
    return dealResolution(input.leadsConfig, input.metaLeadId)
  }
  return { kind: 'ordinary' }
}

function quotedResolution(sourceRef: string | null, metaLeadId: string | null): ConversionLeadResolution {
  const eventName = stageKeyFromQualifiedRef(sourceRef)
  if (!eventName) {
    return { kind: 'refuse', message: '这条合格咨询的阶段名读不出来，没有改发成普通咨询。' }
  }
  if (!legalMetaLeadId(metaLeadId)) return { kind: 'refuse', message: NO_META_LEAD_MESSAGE }
  return { kind: 'stage', eventName }
}

function dealResolution(leadsConfig: unknown, metaLeadId: string | null): ConversionLeadResolution {
  const cfg = readCapiClientConfig(leadsConfig)
  if (!cfg.conversionLeadsEnabled || !cfg.conversionDealStageKey) return { kind: 'ordinary' }
  if (!legalMetaLeadId(metaLeadId)) return { kind: 'ordinary' }
  return { kind: 'stage', eventName: cfg.conversionDealStageKey }
}

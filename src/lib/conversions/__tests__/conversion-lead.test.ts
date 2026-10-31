import { describe, expect, it } from 'vitest'
import {
  dealStageEventId,
  dealStageEventName,
  isQualifiedLeadSource,
  latestMetaLeadId,
  qualifiedLeadSourceRef,
  qualifiedLeadHoldReason,
  resolveConversionLead,
  stageKeyFromQualifiedRef,
} from '../conversion-lead'

const CONTACT = '11111111-2222-3333-4444-555555555555'
const LEAD = '1687504185706630'

describe('resolveConversionLead', () => {
  const on = {
    capi_conversion_leads: true,
    capi_qualified_lead_stage_key: 'quoted',
    capi_conversion_deal_stage_key: 'balance_received',
  }

  it('a deal with no lead id stays on the original event', () => {
    expect(resolveConversionLead({
      outcomeKind: 'purchase',
      sourceRef: 'crm_deal:a:b',
      metaLeadId: null,
      leadsConfig: on,
    })).toEqual({ kind: 'ordinary' })
  })

  it('a deal with a lead id stays a purchase and also names the stage step', () => {
    expect(resolveConversionLead({
      outcomeKind: 'balance',
      sourceRef: 'crm_deal:a:b',
      metaLeadId: LEAD,
      leadsConfig: on,
    })).toEqual({ kind: 'ordinary' })
    expect(dealStageEventName(on, LEAD)).toBe('balance_received')
    expect(dealStageEventId('11111111-2222-3333-4444-555555555555')).toBe(
      '11111111-2222-3333-4444-555555555555:conversion-stage',
    )
  })

  it('a deal with the switch off does not name a stage step', () => {
    expect(dealStageEventName({}, LEAD)).toBeNull()
    expect(dealStageEventName(on, null)).toBeNull()
  })

  it('several form ids: the latest readable time wins', () => {
    const older = '111111111111111'
    expect(latestMetaLeadId([
      { source_ref: older, occurred_at: '2026-10-01T00:00:00.000Z' },
      { source_ref: 'not-a-lead', occurred_at: '2026-10-03T00:00:00.000Z' },
      { source_ref: LEAD, occurred_at: '2026-10-02T00:00:00.000Z' },
      { source_ref: '222222222222222', occurred_at: 'not-a-time' },
    ])).toBe(LEAD)
  })

  it('a closed or unreadable switch holds a qualified row without renaming it', () => {
    expect(qualifiedLeadHoldReason({ capi_conversion_leads: true })).toBeNull()
    expect(qualifiedLeadHoldReason({ capi_conversion_leads: false })).toContain('现在是关的')
    expect(qualifiedLeadHoldReason({ capi_conversion_leads: 'yes' })).toContain('读不出来')
    expect(qualifiedLeadHoldReason({})).toContain('现在是关的')
  })

  it('a qualified row keeps its stage name even after the switch is turned off', () => {
    const sourceRef = qualifiedLeadSourceRef(CONTACT, 'quoted')
    expect(isQualifiedLeadSource(sourceRef)).toBe(true)
    expect(stageKeyFromQualifiedRef(sourceRef)).toBe('quoted')
    const resolved = resolveConversionLead({
      outcomeKind: 'lead',
      sourceRef,
      metaLeadId: LEAD,
      leadsConfig: {},
    })
    expect(resolved).toEqual({ kind: 'stage', eventName: 'quoted' })
  })

  it('an ordinary messenger lead is not a conversion lead', () => {
    expect(resolveConversionLead({
      outcomeKind: 'lead',
      sourceRef: 'messenger:1',
      metaLeadId: LEAD,
      leadsConfig: on,
    })).toEqual({ kind: 'ordinary' })
  })
})

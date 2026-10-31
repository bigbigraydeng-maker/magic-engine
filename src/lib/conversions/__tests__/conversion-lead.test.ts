import { describe, expect, it } from 'vitest'
import {
  isQualifiedLeadSource,
  qualifiedLeadSourceRef,
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

  it('a deal with a lead id uses the configured stage name', () => {
    expect(resolveConversionLead({
      outcomeKind: 'balance',
      sourceRef: 'crm_deal:a:b',
      metaLeadId: LEAD,
      leadsConfig: on,
    })).toEqual({ kind: 'stage', eventName: 'balance_received' })
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

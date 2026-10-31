import { describe, expect, it } from 'vitest'
import {
  DOCUMENTED_DEAL_ONLY_EVENTS,
  applyCapiSettingsWrite,
  capiEventNameForKind,
  decideCapiEventAllowed,
  normalizeCapiSettingsWrite,
  readCapiClientConfig,
  readyCapiSettingsWrite,
  stageCountsAsQualifiedLead,
} from '../capi-client-config'

describe('capi event names', () => {
  it('maps the three business facts onto the platform names', () => {
    expect(capiEventNameForKind('purchase')).toBe('Purchase')
    expect(capiEventNameForKind('balance')).toBe('BalancePaid')
    expect(capiEventNameForKind('lead')).toBe('Lead')
  })
})

describe('allowed events gate', () => {
  it('a missing list keeps today behaviour, including the documented deal-only list not being applied', () => {
    expect(decideCapiEventAllowed(null, 'Lead').allow).toBe(true)
    expect(decideCapiEventAllowed({}, 'Lead').allow).toBe(true)
    expect(decideCapiEventAllowed({ booking_schedule: { enabled: true } }, 'Purchase').allow).toBe(true)
    expect(DOCUMENTED_DEAL_ONLY_EVENTS).toEqual(['Purchase', 'BalancePaid'])
  })

  it('an event outside the list is held', () => {
    const decision = decideCapiEventAllowed(
      { capi_allowed_events: ['Purchase', 'BalancePaid'] },
      'Lead',
    )
    expect(decision.allow).toBe(false)
    if (!decision.allow) {
      expect(decision.reason).toContain('Lead')
      expect(decision.reason).toContain('排队')
      expect(decision.reason).toContain('7 天')
      expect(decision.reason).not.toContain('试运行')
    }
  })

  it('an event inside the list may proceed', () => {
    expect(decideCapiEventAllowed({ capi_allowed_events: ['Purchase', 'BalancePaid'] }, 'Purchase').allow).toBe(true)
    expect(decideCapiEventAllowed({ capi_allowed_events: ['Purchase', 'BalancePaid'] }, 'BalancePaid').allow).toBe(true)
  })

  it('an empty list holds every event', () => {
    expect(decideCapiEventAllowed({ capi_allowed_events: [] }, 'Purchase').allow).toBe(false)
  })

  it.each([
    ['string', 'Purchase'],
    ['padded', [' Purchase']],
    ['blank', ['']],
    ['number', [1]],
    ['null item', [null]],
  ])('a malformed list fails closed (%s)', (_label, value) => {
    const decision = decideCapiEventAllowed({ capi_allowed_events: value }, 'Purchase')
    expect(decision.allow).toBe(false)
    if (!decision.allow) expect(decision.reason).toContain('格式不对')
  })
})

describe('qualified lead and deal settings', () => {
  it('reads the stage and milestone without changing the send decision', () => {
    const cfg = readCapiClientConfig({
      capi_qualified_lead_stage_key: 'quoted',
      capi_deal_milestone: 'deposit',
      capi_deal_stage_key: 'won',
    })
    expect(cfg.qualifiedLeadStageKey).toBe('quoted')
    expect(cfg.dealMilestone).toBe('deposit')
    expect(cfg.dealStageKey).toBe('won')
    expect(decideCapiEventAllowed({ capi_qualified_lead_stage_key: 'quoted' }, 'Lead').allow).toBe(true)
  })

  it('a bad milestone or stage key is malformed and does not invent a default', () => {
    const cfg = readCapiClientConfig({
      capi_deal_milestone: 'won',
      capi_deal_stage_key: 'Won',
      capi_qualified_lead_stage_key: ' quoted',
    })
    expect(cfg.dealMilestone).toBeNull()
    expect(cfg.dealMilestoneMalformed).toBe(true)
    expect(cfg.dealStageKey).toBeNull()
    expect(cfg.dealStageKeyMalformed).toBe(true)
    expect(cfg.qualifiedLeadStageKey).toBeNull()
    expect(cfg.qualifiedLeadStageMalformed).toBe(true)
  })

  it('a quoted stage counts with no actor argument, so a person and the conversation reader are the same', () => {
    expect(stageCountsAsQualifiedLead('quoted', 'quoted')).toBe(true)
    expect(stageCountsAsQualifiedLead('quoted', 'won')).toBe(false)
    expect(stageCountsAsQualifiedLead(null, 'quoted')).toBe(false)
    expect(stageCountsAsQualifiedLead('quoted', null)).toBe(false)
    expect(decideCapiEventAllowed({ capi_qualified_lead_stage_key: 'quoted' }, 'Lead').allow).toBe(true)
  })

  it('absent deal keys stay unset', () => {
    const cfg = readCapiClientConfig({})
    expect(cfg.dealMilestone).toBeNull()
    expect(cfg.dealStageKey).toBeNull()
    expect(cfg.qualifiedLeadStageKey).toBeNull()
    expect(cfg.dealMilestoneMalformed).toBe(false)
  })
})

describe('settings write', () => {
  it('null clears only the keys that were sent', () => {
    const write = normalizeCapiSettingsWrite({ capiAllowedEvents: null })
    expect(write.touched).toBe(true)
    if (!readyCapiSettingsWrite(write)) throw new Error('expected a clear')
    const next = applyCapiSettingsWrite(
      { capi_allowed_events: ['Purchase'], capi_deal_milestone: 'deposit', trade_domains: ['hot.co.nz'] },
      write,
    )
    expect(next.capi_allowed_events).toBeUndefined()
    expect(next.capi_deal_milestone).toBe('deposit')
    expect(next.trade_domains).toEqual(['hot.co.nz'])
  })

  it('rejects an event name the settings page does not offer', () => {
    const write = normalizeCapiSettingsWrite({ capiAllowedEvents: ['ViewContent'] })
    expect(write.touched && write.error).toBeTruthy()
  })
})

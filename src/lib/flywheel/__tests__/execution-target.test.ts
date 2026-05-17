/**
 * Unit tests for deriveExecutionTarget (P12.A.11).
 * Validates the dimension/fix_type → ExecutionTarget mapping stays in sync
 * with the SQL backfill rules.
 */

import { describe, it, expect } from 'vitest'
import { deriveExecutionTarget } from '../execution-target'
import { GEO_ACTION_TYPE } from '../vocabulary'

describe('deriveExecutionTarget', () => {
  it('maps seo + me_auto → seo flywheel, in_house', () => {
    expect(deriveExecutionTarget('seo', 'me_auto')).toEqual({
      flywheel: 'seo',
      mode: 'in_house',
    })
  })

  it('maps ai_visibility + me_auto → geo flywheel, in_house, geo.compose_directive', () => {
    expect(deriveExecutionTarget('ai_visibility', 'me_auto')).toEqual({
      flywheel: 'geo',
      mode: 'in_house',
      action_type: GEO_ACTION_TYPE.COMPOSE_DIRECTIVE,
    })
  })

  it('maps ads + third_party → ads flywheel, third_party', () => {
    expect(deriveExecutionTarget('ads', 'third_party')).toEqual({
      flywheel: 'ads',
      mode: 'third_party',
    })
  })

  it('maps social + third_party → social flywheel, third_party', () => {
    expect(deriveExecutionTarget('social', 'third_party')).toEqual({
      flywheel: 'social',
      mode: 'third_party',
    })
  })

  it('maps reputation + fde_manual → geo flywheel, external_manual, vendor=fde', () => {
    expect(deriveExecutionTarget('reputation', 'fde_manual')).toEqual({
      flywheel: 'geo',
      mode: 'external_manual',
      vendor: 'fde',
      action_type: GEO_ACTION_TYPE.BUILD_CITATIONS,
    })
  })

  it('maps competitor + fde_manual → seo flywheel, external_manual, vendor=fde', () => {
    expect(deriveExecutionTarget('competitor', 'fde_manual')).toEqual({
      flywheel: 'seo',
      mode: 'external_manual',
      vendor: 'fde',
    })
  })

  it('maps ai_visibility + third_party → geo.submit_entity hint', () => {
    expect(deriveExecutionTarget('ai_visibility', 'third_party')).toEqual({
      flywheel: 'geo',
      mode: 'third_party',
      action_type: GEO_ACTION_TYPE.SUBMIT_ENTITY,
    })
  })

  it('fde_manual without geo/reputation context still gets vendor=fde, no action_type', () => {
    const t = deriveExecutionTarget('seo', 'fde_manual')
    expect(t.flywheel).toBe('seo')
    expect(t.mode).toBe('external_manual')
    expect(t.vendor).toBe('fde')
    expect(t.action_type).toBeUndefined()
  })
})

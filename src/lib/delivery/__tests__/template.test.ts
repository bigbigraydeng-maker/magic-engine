import { describe, it, expect } from 'vitest'
import {
  DELIVERY_PHASES, DELIVERY_STEPS, resolveToolHref, stepsForTrack,
  type DeliveryStep,
} from '../template'

const byKey = (k: string) => DELIVERY_STEPS.find(s => s.key === k) as DeliveryStep

describe('delivery template', () => {
  it('has unique step keys and strictly increasing order', () => {
    const keys = DELIVERY_STEPS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    const orders = DELIVERY_STEPS.map(s => s.order)
    expect([...orders].sort((a, b) => a - b)).toEqual(orders)
  })

  it('references only declared phases', () => {
    const phases = new Set(DELIVERY_PHASES.map(p => p.key))
    for (const s of DELIVERY_STEPS) expect(phases.has(s.phase)).toBe(true)
  })

  it('every step either has a tool link or is explicitly external (both label+href null together)', () => {
    for (const s of DELIVERY_STEPS) {
      expect(Boolean(s.toolLabel) === Boolean(s.toolHrefPattern)).toBe(true)
    }
  })

  it('resolveToolHref substitutes the client id, incl. non-standard positions (geo-composer)', () => {
    expect(resolveToolHref(byKey('enquiry_form'), 'abc')).toBe('/dashboard/clients/abc/lead-form')
    expect(resolveToolHref(byKey('geo'), 'abc')).toBe('/dashboard/geo-composer/abc')
  })

  it('returns null href for external-work steps', () => {
    expect(resolveToolHref(byKey('website_refresh'), 'abc')).toBeNull()
    expect(resolveToolHref(byKey('review_engine'), 'abc')).toBeNull()
  })

  it('search track includes review engine, excludes video ads; nurture is the mirror', () => {
    const search = stepsForTrack('search').map(s => s.key)
    expect(search).toContain('review_engine')
    expect(search).not.toContain('video_ads')

    const nurture = stepsForTrack('nurture').map(s => s.key)
    expect(nurture).toContain('video_ads')
    expect(nurture).not.toContain('review_engine')
  })

  it('both tracks include all the shared foundation steps in order', () => {
    for (const track of ['search', 'nurture'] as const) {
      const keys = stepsForTrack(track).map(s => s.key)
      for (const shared of ['onboarding', 'website_refresh', 'enquiry_form', 'analytics', 'gbp', 'seo', 'geo', 'proof_report']) {
        expect(keys).toContain(shared)
      }
      // ordering preserved
      expect(keys.indexOf('onboarding')).toBeLessThan(keys.indexOf('geo'))
      expect(keys.indexOf('geo')).toBeLessThan(keys.indexOf('proof_report'))
    }
  })
})

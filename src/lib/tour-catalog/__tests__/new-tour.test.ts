import { describe, it, expect } from 'vitest'
import { newTourToDbRow, validateNewTour } from '../new-tour'
import { patchContext } from './content-fixture'

const base = {
  destination: 'china',
  tier: 'signature',
  slug: 'china-unveiled',
  tour: { name: 'China Unveiled', durationText: '14 days', displayPriceText: 'From NZD $4,999 per person' },
  departures: [{ departOn: '2027-03-22', returnOn: '2027-04-04' }],
}

describe('validateNewTour', () => {
  it('accepts a complete body and keeps the departures', () => {
    const result = validateNewTour(base, patchContext())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.slug).toBe('china-unveiled')
      expect(result.value.patch.name).toBe('China Unveiled')
      expect(result.value.departures).toEqual([
        { departOn: '2027-03-22', returnOn: '2027-04-04', status: 'open', priceTextOverride: null },
      ])
    }
  })

  it('rejects non-object bodies and unknown keys', () => {
    expect(validateNewTour('x', patchContext())).toEqual({ ok: false, errors: [{ field: '*', code: 'invalid_body' }] })
    const result = validateNewTour({ ...base, id: 'abc' }, patchContext())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({ field: 'id', code: 'field_not_editable' })
  })

  it('requires destination, tier, slug and a tour name', () => {
    const result = validateNewTour({ departures: [], tour: { durationText: '3 days' } }, patchContext())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const fields = result.errors.map(e => e.field)
      expect(fields).toEqual(expect.arrayContaining(['destination', 'tier', 'slug', 'tour.name']))
    }
  })

  it('rejects a slug that is not lower-case kebab', () => {
    for (const slug of ['China Unveiled', 'china_unveiled', '-china', 'china--x', '']) {
      const result = validateNewTour({ ...base, slug }, patchContext())
      expect(result.ok, slug).toBe(false)
    }
  })

  it('rejects a return date before departure and repeated departure dates', () => {
    const bad = validateNewTour({ ...base, departures: [{ departOn: '2027-03-22', returnOn: '2027-03-01' }] }, patchContext())
    expect(bad.ok).toBe(false)
    const dup = validateNewTour(
      { ...base, departures: [{ departOn: '2027-03-22', returnOn: '2027-04-04' }, { departOn: '2027-03-22', returnOn: '2027-04-05' }] },
      patchContext(),
    )
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.errors).toContainEqual({ field: 'departures[1].departOn', code: 'duplicate' })
  })

  it('refuses site-only fields from someone who may not edit the site', () => {
    const result = validateNewTour({ ...base, tour: { ...base.tour, rating: 4.5 } }, patchContext({ canEditSite: false }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.forbidden).toBe(true)
  })
})

describe('newTourToDbRow', () => {
  it('maps to columns, manages departures by default and appends after existing tours', () => {
    const result = validateNewTour(base, patchContext())
    if (!result.ok) throw new Error('expected ok')
    const row = newTourToDbRow('client-1', result.value, 7)
    expect(row).toMatchObject({
      client_id: 'client-1',
      destination: 'china',
      tier: 'signature',
      slug: 'china-unveiled',
      name: 'China Unveiled',
      duration_text: '14 days',
      manages_departures: true,
      sort_order: 7,
    })
  })
})

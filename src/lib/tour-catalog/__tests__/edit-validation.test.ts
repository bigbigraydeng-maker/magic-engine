import { describe, it, expect } from 'vitest'
import {
  validateTourPatch,
  tourPatchToDb,
  validateNewDeparture,
  validateDeparturePatch,
  departurePatchToDb,
} from '../edit-validation'

describe('validateTourPatch', () => {
  it('rejects non-object bodies', () => {
    const result = validateTourPatch('nope')
    expect(result).toEqual({ ok: false, errors: [{ field: '*', code: 'invalid_body' }] })
  })

  it('rejects an empty object with empty_patch', () => {
    const result = validateTourPatch({})
    expect(result).toEqual({ ok: false, errors: [{ field: '*', code: 'empty_patch' }] })
  })

  it('rejects non-editable keys like slug', () => {
    const result = validateTourPatch({ slug: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'slug', code: 'field_not_editable' })
    }
  })

  it('rejects id, clientId, destination, tier', () => {
    const result = validateTourPatch({ id: 'a', clientId: 'b', destination: 'c', tier: 'd' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const fields = result.errors.filter((e) => e.code === 'field_not_editable').map((e) => e.field).sort()
      expect(fields).toEqual(['clientId', 'destination', 'id', 'tier'])
    }
  })

  it('collects multiple errors at once', () => {
    const result = validateTourPatch({ name: '', maxGroupSize: 0, isActive: 'yes' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'name', code: 'required' })
      expect(result.errors).toContainEqual({ field: 'maxGroupSize', code: 'invalid_number' })
      expect(result.errors).toContainEqual({ field: 'isActive', code: 'invalid_type' })
    }
  })

  it('trims strings and accepts a valid name', () => {
    const result = validateTourPatch({ name: '  Great Tour  ' })
    expect(result).toEqual({ ok: true, value: { name: 'Great Tour' } })
  })

  it('rejects a name over 200 chars', () => {
    const result = validateTourPatch({ name: 'a'.repeat(201) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'name', code: 'too_long' })
    }
  })

  it('turns empty nullable strings into null', () => {
    const result = validateTourPatch({ title: '   ', shortDescription: '' })
    expect(result).toEqual({ ok: true, value: { title: null, shortDescription: null } })
  })

  it('accepts TBC price text', () => {
    const result = validateTourPatch({ displayPriceText: 'TBC' })
    expect(result).toEqual({ ok: true, value: { displayPriceText: 'TBC' } })
  })

  it('rejects multiple currencies in price text', () => {
    const result = validateTourPatch({ displayPriceText: 'From AUD 5 (NZD 4)' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'displayPriceText',
        code: 'invalid_price:multiple_currencies',
      })
    }
  })

  it('trims arrays and drops empty entries', () => {
    const result = validateTourPatch({ highlights: ['  a  ', '', '   ', 'b'] })
    expect(result).toEqual({ ok: true, value: { highlights: ['a', 'b'] } })
  })

  it('rejects non-array string lists', () => {
    const result = validateTourPatch({ inclusions: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'inclusions', code: 'invalid_type' })
    }
  })

  it('rejects too many items', () => {
    const result = validateTourPatch({ tourCities: Array.from({ length: 51 }, (_, i) => `c${i}`) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'tourCities', code: 'too_many_items' })
    }
  })

  it('rejects an over-long array item', () => {
    const result = validateTourPatch({ exclusions: ['a'.repeat(501)] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'exclusions', code: 'item_too_long' })
    }
  })

  it('sorts itinerary by day ascending', () => {
    const result = validateTourPatch({
      itinerary: [
        { day: 3, title: 'C', description: 'third' },
        { day: 1, title: 'A', description: 'first' },
        { day: 2, title: 'B', description: 'second' },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.itinerary?.map((d) => d.day)).toEqual([1, 2, 3])
    }
  })

  it('rejects duplicate itinerary days', () => {
    const result = validateTourPatch({
      itinerary: [
        { day: 1, title: 'A', description: 'a' },
        { day: 1, title: 'B', description: 'b' },
      ],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'itinerary', code: 'duplicate_day' })
    }
  })

  it('reports per-item itinerary errors with indexed fields', () => {
    const result = validateTourPatch({
      itinerary: [{ day: 0, title: '', description: 'x' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'itinerary[0].day', code: 'invalid_day' })
      expect(result.errors).toContainEqual({ field: 'itinerary[0].title', code: 'required' })
    }
  })

  it('omits meals when absent and trims meals when present', () => {
    const result = validateTourPatch({
      itinerary: [
        { day: 1, title: 'A', description: 'a' },
        { day: 2, title: 'B', description: 'b', meals: ['  Breakfast ', ''] },
      ],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.itinerary?.[0]).toEqual({ day: 1, title: 'A', description: 'a' })
      expect(result.value.itinerary?.[1].meals).toEqual(['Breakfast'])
    }
  })

  it('rejects maxGroupSize 0, 501 and 2.5 but accepts null', () => {
    for (const bad of [0, 501, 2.5]) {
      const result = validateTourPatch({ maxGroupSize: bad })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors).toContainEqual({ field: 'maxGroupSize', code: 'invalid_number' })
      }
    }
    expect(validateTourPatch({ maxGroupSize: null })).toEqual({
      ok: true,
      value: { maxGroupSize: null },
    })
  })

  it('only returns keys that were provided', () => {
    const result = validateTourPatch({ name: 'X', isActive: true })
    expect(result).toEqual({ ok: true, value: { name: 'X', isActive: true } })
  })
})

describe('tourPatchToDb', () => {
  it('maps camelCase keys to snake_case columns', () => {
    const db = tourPatchToDb({
      name: 'X',
      shortDescription: 's',
      durationText: '10 days',
      displayPriceText: 'TBC',
      tourCities: ['A'],
      singleSupplement: 'n',
      maxGroupSize: 12,
      isActive: true,
      managesDepartures: false,
    })
    expect(db).toEqual({
      name: 'X',
      short_description: 's',
      duration_text: '10 days',
      display_price_text: 'TBC',
      tour_cities: ['A'],
      single_supplement: 'n',
      max_group_size: 12,
      is_active: true,
      manages_departures: false,
    })
  })

  it('only includes keys present in the patch', () => {
    expect(tourPatchToDb({ name: 'X' })).toEqual({ name: 'X' })
  })
})

describe('validateNewDeparture', () => {
  it('defaults status to open', () => {
    const result = validateNewDeparture({ departOn: '2027-05-13', returnOn: '2027-05-20' })
    expect(result).toEqual({
      ok: true,
      value: {
        departOn: '2027-05-13',
        returnOn: '2027-05-20',
        status: 'open',
        priceTextOverride: null,
      },
    })
  })

  it('requires departOn and returnOn', () => {
    const result = validateNewDeparture({})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'departOn', code: 'required' })
      expect(result.errors).toContainEqual({ field: 'returnOn', code: 'required' })
    }
  })

  it('rejects invalid ISO dates', () => {
    const result = validateNewDeparture({ departOn: '2027-02-30', returnOn: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'departOn', code: 'invalid_date' })
      expect(result.errors).toContainEqual({ field: 'returnOn', code: 'invalid_date' })
    }
  })

  it('rejects returnOn before departOn', () => {
    const result = validateNewDeparture({ departOn: '2027-05-20', returnOn: '2027-05-13' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'returnOn', code: 'return_before_depart' })
    }
  })

  it('rejects an invalid status', () => {
    const result = validateNewDeparture({
      departOn: '2027-05-13',
      returnOn: '2027-05-20',
      status: 'bogus',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'status', code: 'invalid_status' })
    }
  })

  it('rejects unknown keys', () => {
    const result = validateNewDeparture({
      departOn: '2027-05-13',
      returnOn: '2027-05-20',
      capacity: 10,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'capacity', code: 'field_not_editable' })
    }
  })

  it('validates priceTextOverride', () => {
    const result = validateNewDeparture({
      departOn: '2027-05-13',
      returnOn: '2027-05-20',
      priceTextOverride: 'From AUD 5 (NZD 4)',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'priceTextOverride',
        code: 'invalid_price:multiple_currencies',
      })
    }
  })
})

describe('validateDeparturePatch', () => {
  it('rejects departOn', () => {
    const result = validateDeparturePatch({ departOn: '2027-05-13' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'departOn', code: 'depart_on_not_editable' })
    }
  })

  it('rejects an empty patch', () => {
    expect(validateDeparturePatch({})).toEqual({
      ok: false,
      errors: [{ field: '*', code: 'empty_patch' }],
    })
  })

  it('rejects unknown keys', () => {
    const result = validateDeparturePatch({ capacity: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'capacity', code: 'field_not_editable' })
    }
  })

  it('accepts returnOn null and a valid ISO date', () => {
    expect(validateDeparturePatch({ returnOn: null })).toEqual({
      ok: true,
      value: { returnOn: null },
    })
    expect(validateDeparturePatch({ returnOn: '2027-05-20' })).toEqual({
      ok: true,
      value: { returnOn: '2027-05-20' },
    })
  })

  it('rejects an invalid returnOn date', () => {
    const result = validateDeparturePatch({ returnOn: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'returnOn', code: 'invalid_date' })
    }
  })

  it('rejects an invalid status', () => {
    const result = validateDeparturePatch({ status: 'bogus' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'status', code: 'invalid_status' })
    }
  })
})

describe('departurePatchToDb', () => {
  it('maps to snake_case columns', () => {
    expect(
      departurePatchToDb({ returnOn: '2027-05-20', status: 'limited', priceTextOverride: null }),
    ).toEqual({
      return_on: '2027-05-20',
      status: 'limited',
      price_text_override: null,
    })
  })

  it('only includes keys present in the patch', () => {
    expect(departurePatchToDb({ status: 'open' })).toEqual({ status: 'open' })
  })
})

describe('itinerary day numbering', () => {
  it('requires days to run 1, 2, 3 with no gaps', () => {
    const gap = validateTourPatch({ itinerary: [
      { day: 1, title: 'A', description: '' },
      { day: 3, title: 'C', description: '' },
    ] })
    expect(gap.ok).toBe(false)
    if (!gap.ok) expect(gap.errors).toContainEqual({ field: 'itinerary', code: 'non_consecutive_days' })
    const ok = validateTourPatch({ itinerary: [
      { day: 2, title: 'B', description: '' },
      { day: 1, title: 'A', description: '' },
    ] })
    expect(ok.ok).toBe(true)
  })

  it('keeps the forbidden-key error even when nothing editable is sent', () => {
    const r = validateTourPatch({ slug: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContainEqual({ field: 'slug', code: 'field_not_editable' })
      expect(r.errors).toContainEqual({ field: '*', code: 'empty_patch' })
    }
  })
})

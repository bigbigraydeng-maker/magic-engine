import { describe, it, expect } from 'vitest'
import {
  hasForbiddenChars,
  validateTourPatch,
  tourPatchToDb,
  validateNewDeparture,
  validateDeparturePatch,
  departurePatchToDb,
} from '../edit-validation'

import { patchContext } from './content-fixture'

/** Existing cases run as a global admin on a blank tour; the two permission tiers are covered in content-validation.test.ts and edit-validation-tiers.test.ts. */
const vtp = (input: unknown) => validateTourPatch(input, patchContext())

describe('validateTourPatch', () => {
  it('rejects non-object bodies', () => {
    const result = vtp('nope')
    expect(result).toEqual({ ok: false, errors: [{ field: '*', code: 'invalid_body' }] })
  })

  it('rejects an empty object with empty_patch', () => {
    const result = vtp({})
    expect(result).toEqual({ ok: false, errors: [{ field: '*', code: 'empty_patch' }] })
  })

  it('rejects non-editable keys like slug', () => {
    const result = vtp({ slug: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'slug', code: 'field_not_editable' })
    }
  })

  it('rejects id, clientId, destination, tier', () => {
    const result = vtp({ id: 'a', clientId: 'b', destination: 'c', tier: 'd' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const fields = result.errors.filter((e) => e.code === 'field_not_editable').map((e) => e.field).sort()
      expect(fields).toEqual(['clientId', 'destination', 'id', 'tier'])
    }
  })

  it('collects multiple errors at once', () => {
    const result = vtp({ name: '', maxGroupSize: 0, isActive: 'yes' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'name', code: 'required' })
      expect(result.errors).toContainEqual({ field: 'maxGroupSize', code: 'invalid_number' })
      expect(result.errors).toContainEqual({ field: 'isActive', code: 'invalid_type' })
    }
  })

  it('trims strings and accepts a valid name', () => {
    const result = vtp({ name: '  Great Tour  ' })
    expect(result).toEqual({ ok: true, value: { name: 'Great Tour' } })
  })

  it('rejects a name over 200 chars', () => {
    const result = vtp({ name: 'a'.repeat(201) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'name', code: 'too_long' })
    }
  })

  it('turns empty nullable strings into null', () => {
    const result = vtp({ title: '   ', shortDescription: '' })
    expect(result).toEqual({ ok: true, value: { title: null, shortDescription: null } })
  })

  it('accepts TBC price text', () => {
    const result = vtp({ displayPriceText: 'TBC' })
    expect(result).toEqual({ ok: true, value: { displayPriceText: 'TBC' } })
  })

  it('rejects multiple currencies in price text', () => {
    const result = vtp({ displayPriceText: 'From AUD 5 (NZD 4)' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'displayPriceText',
        code: 'invalid_price:multiple_currencies',
      })
    }
  })

  it('trims arrays and drops empty entries', () => {
    const result = vtp({ highlights: ['  a  ', '', '   ', 'b'] })
    expect(result).toEqual({ ok: true, value: { highlights: ['a', 'b'] } })
  })

  it('rejects non-array string lists', () => {
    const result = vtp({ inclusions: 'nope' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'inclusions', code: 'invalid_type' })
    }
  })

  it('rejects too many items', () => {
    const result = vtp({ tourCities: Array.from({ length: 51 }, (_, i) => `c${i}`) })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'tourCities', code: 'too_many_items' })
    }
  })

  it('rejects an over-long array item', () => {
    const result = vtp({ exclusions: ['a'.repeat(501)] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'exclusions', code: 'item_too_long' })
    }
  })

  it('sorts itinerary by day ascending', () => {
    const result = vtp({
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
    const result = vtp({
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
    const result = vtp({
      itinerary: [{ day: 0, title: '', description: 'x' }],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'itinerary[0].day', code: 'invalid_day' })
      expect(result.errors).toContainEqual({ field: 'itinerary[0].title', code: 'required' })
    }
  })

  it('omits meals when absent and trims meals when present', () => {
    const result = vtp({
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
      const result = vtp({ maxGroupSize: bad })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors).toContainEqual({ field: 'maxGroupSize', code: 'invalid_number' })
      }
    }
    expect(vtp({ maxGroupSize: null })).toEqual({
      ok: true,
      value: { maxGroupSize: null },
    })
  })

  it('only returns keys that were provided', () => {
    const result = vtp({ name: 'X', isActive: true })
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
    const gap = vtp({ itinerary: [
      { day: 1, title: 'A', description: '' },
      { day: 3, title: 'C', description: '' },
    ] })
    expect(gap.ok).toBe(false)
    if (!gap.ok) expect(gap.errors).toContainEqual({ field: 'itinerary', code: 'non_consecutive_days' })
    const ok = vtp({ itinerary: [
      { day: 2, title: 'B', description: '' },
      { day: 1, title: 'A', description: '' },
    ] })
    expect(ok.ok).toBe(true)
  })

  it('keeps the forbidden-key error even when nothing editable is sent', () => {
    const r = vtp({ slug: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContainEqual({ field: 'slug', code: 'field_not_editable' })
      expect(r.errors).toContainEqual({ field: '*', code: 'empty_patch' })
    }
  })
})

describe('input hardening (design §6.10.1 item 7)', () => {
  const HIDDEN: Array<[string, string]> = [
    ['NUL', '\u0000'],
    ['bell', '\u0007'],
    ['escape', '\u001b'],
    ['DEL', '\u007f'],
    ['zero-width space', '\u200b'],
    ['zero-width joiner', '\u200d'],
    ['right-to-left mark', '\u200f'],
    ['left-to-right embedding', '\u202a'],
    ['right-to-left override', '\u202e'],
    ['word joiner', '\u2060'],
    ['pop directional isolate', '\u2069'],
    ['byte-order mark', '\ufeff'],
  ]

  function codesOf(result: ReturnType<typeof validateTourPatch>): string[] {
    return result.ok ? [] : result.errors.map((e) => `${e.field}:${e.code}`)
  }

  describe.each(HIDDEN)('a %s inside the text', (_label, ch) => {
    it('is refused in every single-line tour field', () => {
      expect(codesOf(vtp({ name: `Gol${ch}den` }))).toEqual(['name:invalid_characters'])
      expect(codesOf(vtp({ title: `Gol${ch}den` }))).toEqual(['title:invalid_characters'])
      expect(codesOf(vtp({ durationText: `10${ch} days` }))).toEqual(['durationText:invalid_characters'])
      expect(codesOf(vtp({ singleSupplement: `NZD${ch} $400` }))).toEqual(['singleSupplement:invalid_characters'])
      expect(codesOf(vtp({ displayPriceText: `From NZD${ch} $4,080 per person` }))).toEqual([
        'displayPriceText:invalid_characters',
      ])
    })

    it('is refused in multi-line fields too', () => {
      expect(codesOf(vtp({ shortDescription: `Line one${ch}` + ' more' }))).toEqual([
        'shortDescription:invalid_characters',
      ])
      expect(
        codesOf(vtp({ itinerary: [{ day: 1, title: 'Arrive', description: `Fly${ch} in` }] })),
      ).toEqual(['itinerary[0].description:invalid_characters'])
    })

    it('is refused in list items, day titles and meals', () => {
      for (const field of ['highlights', 'inclusions', 'exclusions', 'tourCities']) {
        expect(codesOf(vtp({ [field]: ['fine', `bad${ch}item`] })), field).toEqual([
          `${field}:invalid_characters`,
        ])
      }
      expect(codesOf(vtp({ itinerary: [{ day: 1, title: `Arr${ch}ive`, description: '' }] }))).toEqual([
        'itinerary[0].title:invalid_characters',
      ])
      expect(
        codesOf(vtp({ itinerary: [{ day: 1, title: 'Arrive', description: '', meals: [`Din${ch}ner`] }] })),
      ).toEqual(['itinerary[0].meals:invalid_characters'])
    })

    it('is refused in a departure price', () => {
      const created = validateNewDeparture({
        departOn: '2027-03-11',
        returnOn: '2027-03-25',
        priceTextOverride: `From NZD${ch} $4,080 per person`,
      })
      expect(created.ok ? [] : created.errors).toEqual([{ field: 'priceTextOverride', code: 'invalid_characters' }])
      const patched = validateDeparturePatch({ priceTextOverride: `From NZD${ch} $4,080 per person` })
      expect(patched.ok ? [] : patched.errors).toEqual([{ field: 'priceTextOverride', code: 'invalid_characters' }])
    })
  })

  it('line breaks and tabs are allowed only in multi-line fields', () => {
    const multi = vtp({
      shortDescription: 'Line one\nLine two\twith a tab',
      itinerary: [{ day: 1, title: 'Arrive', description: 'Morning\nAfternoon\tEvening' }],
    })
    expect(multi.ok).toBe(true)
    expect(codesOf(vtp({ name: 'Golden\nChina' }))).toEqual(['name:invalid_characters'])
    expect(codesOf(vtp({ title: 'Golden\tChina' }))).toEqual(['title:invalid_characters'])
    expect(codesOf(vtp({ highlights: ['one\ntwo'] }))).toEqual(['highlights:invalid_characters'])
    expect(codesOf(vtp({ itinerary: [{ day: 1, title: 'A\nB', description: '' }] }))).toEqual([
      'itinerary[0].title:invalid_characters',
    ])
  })

  it('Windows line endings are normalised, a lone carriage return is refused', () => {
    const result = vtp({
      shortDescription: 'one\r\ntwo',
      itinerary: [{ day: 1, title: 'Arrive', description: 'a\r\nb' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.shortDescription).toBe('one\ntwo')
    expect(result.value.itinerary?.[0].description).toBe('a\nb')
    expect(codesOf(vtp({ shortDescription: 'one\rtwo' }))).toEqual(['shortDescription:invalid_characters'])
  })

  it('ordinary text in any language, accents, emoji and non-breaking spaces still pass', () => {
    const result = vtp({
      name: '中国全景 Panorama — Zürich café',
      title: 'Xi’an & Chengdu\u00a0(10 days) 🐼',
      highlights: ['长城', 'Terracotta Warriors'],
      itinerary: [{ day: 1, title: '抵达北京', description: '全天自由活动。', meals: ['Dinner'] }],
    })
    expect(result.ok).toBe(true)
  })

  it('hasForbiddenChars: single-line vs multi-line', () => {
    expect(hasForbiddenChars('plain text')).toBe(false)
    expect(hasForbiddenChars('a\nb')).toBe(true)
    expect(hasForbiddenChars('a\nb', true)).toBe(false)
    expect(hasForbiddenChars('a\tb', true)).toBe(false)
    expect(hasForbiddenChars('a\u000bb', true)).toBe(true)
    expect(hasForbiddenChars('a\u202eb', true)).toBe(true)
  })

  describe('price-like strings', () => {
    it.each(['From NZD $4,080 per person', 'NZD $2,699 per person', 'TBC'])('still accepts %s as a display price', (text) => {
      const result = vtp({ displayPriceText: text })
      expect(result).toEqual({ ok: true, value: { displayPriceText: text } })
    })

    it('refuses a display price over 100 characters', () => {
      const long = 'From NZD $4,080 per person ' + 'x'.repeat(80)
      expect(codesOf(vtp({ displayPriceText: long }))).toEqual(['displayPriceText:invalid_price:too_long'])
    })

    it.each(['NZD $4,080 http://x.example', 'NZD $4,080 https://x.example', 'NZD $4,080 www.x.example'])(
      'refuses a link in a display price: %s',
      (text) => {
        expect(codesOf(vtp({ displayPriceText: text }))).toEqual(['displayPriceText:invalid_price:forbidden_content'])
      },
    )

    // Angle brackets are now refused in every editable text, before the price rules are reached (design §6.11.1 item 5).
    it.each(['NZD $4,080 <b>', 'NZD $4,080 > x'])('refuses an angle bracket in a display price: %s', (text) => {
      expect(codesOf(vtp({ displayPriceText: text }))).toEqual(['displayPriceText:invalid_characters'])
    })

    it('applies the same rules to a departure price (new and patch)', () => {
      const created = validateNewDeparture({ departOn: '2027-03-11', returnOn: '2027-03-25', priceTextOverride: 'NZD $1 www.x.example' })
      expect(created.ok ? [] : created.errors).toEqual([{ field: 'priceTextOverride', code: 'invalid_price:forbidden_content' }])
      const patched = validateDeparturePatch({ priceTextOverride: 'NZD $1 ' + 'x'.repeat(100) })
      expect(patched.ok ? [] : patched.errors).toEqual([{ field: 'priceTextOverride', code: 'invalid_price:too_long' }])
    })

    it('single supplement: plain amounts pass, markup, links and over-long text are refused', () => {
      expect(vtp({ singleSupplement: 'NZD $400' })).toEqual({ ok: true, value: { singleSupplement: 'NZD $400' } })
      expect(vtp({ singleSupplement: '  ' })).toEqual({ ok: true, value: { singleSupplement: null } })
      expect(vtp({ singleSupplement: null })).toEqual({ ok: true, value: { singleSupplement: null } })
      expect(vtp({ singleSupplement: 'x'.repeat(100) }).ok).toBe(true)
      expect(codesOf(vtp({ singleSupplement: 'x'.repeat(101) }))).toEqual(['singleSupplement:too_long'])
      expect(codesOf(vtp({ singleSupplement: 'NZD $400 <i>' }))).toEqual(['singleSupplement:invalid_characters'])
      expect(codesOf(vtp({ singleSupplement: 'see https://x.example' }))).toEqual([
        'singleSupplement:invalid_price:forbidden_content',
      ])
      expect(codesOf(vtp({ singleSupplement: 'www.x.example' }))).toEqual([
        'singleSupplement:invalid_price:forbidden_content',
      ])
    })
  })

  describe('meals', () => {
    const day = (meals: unknown) => ({ itinerary: [{ day: 1, title: 'Arrive', description: '', meals }] })

    it('accepts up to 8 meals of up to 30 characters each', () => {
      const meals = Array.from({ length: 8 }, (_, i) => `${'m'.repeat(29)}${i}`)
      const result = vtp(day(meals))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.itinerary?.[0].meals).toEqual(meals)
    })

    it('refuses a ninth meal', () => {
      expect(codesOf(vtp(day(Array.from({ length: 9 }, (_, i) => `meal ${i}`))))).toEqual([
        'itinerary[0].meals:too_many_items',
      ])
    })

    it('refuses a meal of 61 characters and accepts the longest real one', () => {
      expect(codesOf(vtp(day(['Breakfast', 'm'.repeat(61)])))).toEqual(['itinerary[0].meals:item_too_long'])
      expect(vtp(day(['Dinner (Tibetan Dinner with Cultural Show)'])).ok).toBe(true)
    })

    it('other lists keep their own, larger limits (50 items of up to 500 characters)', () => {
      const result = vtp({ highlights: Array.from({ length: 50 }, () => 'h'.repeat(500)) })
      expect(result.ok).toBe(true)
      expect(codesOf(vtp({ highlights: Array.from({ length: 51 }, () => 'h') }))).toEqual(['highlights:too_many_items'])
    })
  })
})


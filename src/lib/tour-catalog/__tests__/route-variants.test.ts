import { describe, expect, it } from 'vitest'
import { validateTourPatch } from '../edit-validation'
import { readRouteVariants } from '../route-variants'
import { blankTour, patchContext } from './content-fixture'

const admin = () => patchContext({ canEditSite: true, existingTour: blankTour() })
const editor = () => patchContext({ canEditSite: false, existingTour: blankTour() })

const DAYS = [
  { day: 1, title: 'Fly', description: 'Depart' },
  { day: 2, title: 'Beijing', description: 'Arrive', accommodation: 'Sofitel Beijing Central', meals: ['Dinner'] },
]
const variant = (extra: Record<string, unknown> = {}) => ({
  id: 'oct-2027',
  label: '16 Oct 2027',
  note: 'Chengdu, Chongqing and Zhangjiajie replace Yunnan.',
  departOn: ['2027-10-16'],
  mapSlug: 'grand-tour-oct-2027',
  itinerary: DAYS,
  ...extra,
})
const patch = (variants: unknown) => validateTourPatch({ siteExtras: { route_variants: variants } }, admin())

describe('route variants in siteExtras', () => {
  it('accepts a well-formed variant and keeps it as sent', () => {
    expect(patch([variant()])).toEqual({ ok: true, value: { siteExtras: { route_variants: [variant()] } } })
  })

  it('keeps related_blog_slugs next to the variants', () => {
    const result = validateTourPatch(
      { siteExtras: { related_blog_slugs: ['best-time-to-visit-china'], route_variants: [variant()] } },
      admin(),
    )
    expect(result).toEqual({
      ok: true,
      value: { siteExtras: { related_blog_slugs: ['best-time-to-visit-china'], route_variants: [variant()] } },
    })
  })

  it('an empty list removes the key (variants are switched off)', () => {
    expect(patch([])).toEqual({ ok: true, value: { siteExtras: {} } })
  })

  it('is for a global admin only', () => {
    expect(validateTourPatch({ siteExtras: { route_variants: [variant()] } }, editor())).toEqual({
      ok: false,
      forbidden: true,
      errors: [{ field: '*', code: 'forbidden' }],
    })
  })

  it.each([
    ['a bad id', { id: 'Oct 2027!' }, 'siteExtras.route_variants[0].id', 'invalid_id'],
    ['an empty label', { label: ' ' }, 'siteExtras.route_variants[0].label', 'required'],
    ['no departure dates', { departOn: [] }, 'siteExtras.route_variants[0].departOn', 'required'],
    ['a made-up date', { departOn: ['2027-02-30'] }, 'siteExtras.route_variants[0].departOn', 'invalid_date'],
    ['a repeated date', { departOn: ['2027-10-16', '2027-10-16'] }, 'siteExtras.route_variants[0].departOn', 'duplicate_date'],
    ['a bad map name', { mapSlug: '../x' }, 'siteExtras.route_variants[0].mapSlug', 'invalid_map_slug'],
    ['angle brackets in the note', { note: '<b>hi</b>' }, 'siteExtras.route_variants[0].note', 'invalid_characters'],
  ])('rejects %s', (_name, extra, field, code) => {
    const result = patch([variant(extra)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContainEqual({ field, code })
  })

  it('rejects an itinerary with a gap in the day numbers, naming the variant', () => {
    const result = patch([variant({ itinerary: [DAYS[0], { day: 3, title: 'X', description: 'Y' }] })])
    expect(result).toEqual({
      ok: false,
      errors: [{ field: 'siteExtras.route_variants[0].itinerary', code: 'non_consecutive_days' }],
    })
  })

  it('rejects one date used by two variants, and the same id twice', () => {
    const second = variant({ id: 'second' })
    expect(patch([variant(), second])).toEqual({
      ok: false,
      errors: [{ field: 'siteExtras.route_variants', code: 'date_in_two_variants' }],
    })
    expect(patch([variant(), variant({ departOn: ['2027-11-01'] })])).toEqual({
      ok: false,
      errors: [{ field: 'siteExtras.route_variants', code: 'duplicate_id' }],
    })
  })

  it('rejects unknown keys, a non-object, and a value that is too big', () => {
    expect(validateTourPatch({ siteExtras: { surprise: 1 } }, admin())).toEqual({
      ok: false,
      errors: [{ field: 'siteExtras.surprise', code: 'unknown_key' }],
    })
    expect(validateTourPatch({ siteExtras: [] }, admin())).toEqual({
      ok: false,
      errors: [{ field: 'siteExtras', code: 'invalid_type' }],
    })
    const long = 'x'.repeat(190)
    const days = Array.from({ length: 60 }, (_v, i) => ({ day: i + 1, title: 'T', description: long }))
    const result = patch([variant({ itinerary: days }), variant({ id: 'second', departOn: ['2027-11-01'], itinerary: days })])
    expect(result).toEqual({ ok: false, errors: [{ field: 'siteExtras', code: 'too_large' }] })
  })
})

describe('readRouteVariants', () => {
  it('reads what was stored, and skips damaged entries without throwing', () => {
    const read = readRouteVariants({ route_variants: [variant(), { id: 'broken' }, 'nope', variant({ id: 'empty', itinerary: [] })] })
    expect(read).toHaveLength(1)
    expect(read[0].id).toBe('oct-2027')
    expect(read[0].itinerary[1].accommodation).toBe('Sofitel Beijing Central')
  })

  it('reads nothing when the key is absent or not a list', () => {
    expect(readRouteVariants({})).toEqual([])
    expect(readRouteVariants({ route_variants: 'x' })).toEqual([])
  })
})

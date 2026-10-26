/**
 * The same list of tour fields is written by hand in several places: the database function's
 * column whitelist, the editor's patch keys, the two camelCase → column mappers, the admin-only
 * keys, what the AI assistant may change, and the lists inside the assistant's tool description.
 * Adding a field to one and forgetting another fails silently in production ("field_not_editable",
 * or an edit judged unchanged and dropped). This file pins them to each other: forget one, and a
 * test here goes red.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSISTANT_CONTENT_KEYS, checkProposal } from '../assistant'
import { CONTENT_PATCH_KEYS, SITE_ONLY_PATCH_KEYS, contentPatchToDb, type TourContentPatch } from '../content-validation'
import { TOUR_PATCH_KEYS, tourPatchToDb, type TourPatch } from '../edit-validation'
import type { CatalogSnapshot } from '../store'
import { blankTour } from './content-fixture'

const ROOT = process.cwd()
const MIGRATION = join(ROOT, 'supabase/migrations/20261010400000_tour_catalog_content.sql')
const ASSISTANT_SOURCE = join(ROOT, 'src/lib/tour-catalog/assistant.ts')

/** Keys that carry image addresses. */
const IMAGE_KEYS: readonly string[] = ['heroImage', 'gallery']

/** The `c_editable` array constant of tour_catalog_update_tour, read from the migration itself. */
function editableColumns(): string[] {
  const sql = readFileSync(MIGRATION, 'utf-8')
  const match = /c_editable\s+constant\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i.exec(sql)
  if (match === null) throw new Error('c_editable not found in the migration')
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g), (m) => m[1])
}

/** A comma-separated key list that follows `label` in the assistant's tool description. */
function promptKeyList(label: string): string[] {
  const source = readFileSync(ASSISTANT_SOURCE, 'utf-8')
  const at = source.indexOf(label)
  if (at < 0) throw new Error(`"${label}" not found in assistant.ts`)
  const rest = source.slice(at + label.length)
  const list = /^[A-Za-z, ]+/.exec(rest)
  if (list === null) throw new Error(`no key list after "${label}"`)
  return list[0].split(',').map((key) => key.trim()).filter((key) => key !== '')
}

/** A value the validator accepts for each editable key, so that only the permission decides. */
const SAMPLE: Readonly<Record<string, unknown>> = {
  name: 'Sample Tour',
  title: 'Sample title',
  shortDescription: 'Intro',
  durationText: '10 Days',
  displayPriceText: 'From NZD $4,999 per person',
  highlights: ['Great Wall'],
  itinerary: [{ day: 1, title: 'Arrive', description: 'Welcome' }],
  inclusions: ['Meals'],
  exclusions: ['Flights'],
  tourCities: ['Beijing'],
  singleSupplement: 'NZD $900',
  maxGroupSize: 16,
  isActive: true,
  managesDepartures: true,
  heroImage: '/images/a.jpg',
  gallery: ['/images/a.jpg'],
  metaTitle: 'Meta',
  metaDescription: 'Meta description',
  tags: ['culture'],
  faqs: [{ question: 'Q', answer: 'A', link: null }],
  soldOut: true,
  singleSupplementNote: 'Limited',
  rating: 4.8,
  reviewCount: 12,
  reviewSummary: 'Loved it',
  quickAnswer: 'Ten days.',
}

/** What the assistant is actually allowed to change, found by asking checkProposal key by key. */
function assistantAllowedKeys(): string[] {
  const tour = blankTour({ id: 'tour-1', heroImage: '/images/a.jpg', gallery: ['/images/a.jpg'] })
  const snapshot: CatalogSnapshot = { tours: [tour], departures: [], aliases: [] }
  return TOUR_PATCH_KEYS.filter((key) => {
    const result = checkProposal(snapshot, { kind: 'update_tour', tourId: 'tour-1', summary: 's', patch: { [key]: SAMPLE[key] } })
    if (result === null) throw new Error('unusable proposal for ' + key)
    if (result.check.ok) return true
    expect(result.check.errors, key).toEqual([{ field: key, code: 'assistant_field_not_allowed' }])
    return false
  })
}

function sorted(values: Iterable<string>): string[] {
  return Array.from(values).sort()
}

function isSubset(part: readonly string[], whole: readonly string[]): boolean {
  return part.every((key) => whole.includes(key))
}

describe('the hand-written lists of tour fields agree with each other', () => {
  const columns = editableColumns()

  it('reads a plausible whitelist out of the migration', () => {
    expect(columns.length).toBeGreaterThanOrEqual(26)
    expect(new Set(columns).size).toBe(columns.length)
    expect(columns).toContain('name')
    expect(columns).toContain('quick_answer')
  })

  it('has a sample value for every editable key, and no editable key twice', () => {
    expect(sorted(Object.keys(SAMPLE))).toEqual(sorted(TOUR_PATCH_KEYS))
    expect(new Set(TOUR_PATCH_KEYS).size).toBe(TOUR_PATCH_KEYS.length)
  })

  it('every editable patch key maps to exactly one whitelisted column, and every column is reached', () => {
    const reached = new Map<string, string>()
    for (const key of TOUR_PATCH_KEYS) {
      const row = tourPatchToDb({ [key]: SAMPLE[key] } as TourPatch)
      const written = Object.keys(row)
      expect(written.length, `${key} must map to exactly one column`).toBe(1)
      expect(columns, `${key} → ${written[0]} is not in c_editable`).toContain(written[0])
      expect(reached.has(written[0]), `${written[0]} is written by two keys`).toBe(false)
      expect(row[written[0]]).toBe(SAMPLE[key])
      reached.set(written[0], key)
    }
    expect(sorted(reached.keys())).toEqual(sorted(columns))
  })

  it('the content mapper covers exactly the content keys, each to one whitelisted column', () => {
    const reached = new Set<string>()
    for (const key of CONTENT_PATCH_KEYS) {
      const written = Object.keys(contentPatchToDb({ [key]: SAMPLE[key] } as TourContentPatch))
      expect(written.length, `${key} must map to exactly one column`).toBe(1)
      expect(columns).toContain(written[0])
      reached.add(written[0])
    }
    expect(reached.size).toBe(CONTENT_PATCH_KEYS.length)
    expect(isSubset(CONTENT_PATCH_KEYS, TOUR_PATCH_KEYS)).toBe(true)
    const outside = TOUR_PATCH_KEYS.filter((key) => !CONTENT_PATCH_KEYS.includes(key))
    for (const key of outside) expect(contentPatchToDb({ [key]: SAMPLE[key] } as TourContentPatch), key).toEqual({})
  })

  it('a key that is not editable maps to no column at all', () => {
    for (const key of ['slug', 'destination', 'tier', 'sortOrder', 'siteExtras', 'id', 'clientId']) {
      expect(tourPatchToDb({ [key]: 'x' } as TourPatch), key).toEqual({})
    }
  })

  it('admin-only keys and image keys are editable keys', () => {
    expect(isSubset(SITE_ONLY_PATCH_KEYS, TOUR_PATCH_KEYS)).toBe(true)
    expect(isSubset(SITE_ONLY_PATCH_KEYS, CONTENT_PATCH_KEYS)).toBe(true)
    expect(isSubset(IMAGE_KEYS, CONTENT_PATCH_KEYS)).toBe(true)
    expect(SITE_ONLY_PATCH_KEYS.filter((key) => IMAGE_KEYS.includes(key))).toEqual([])
    expect(new Set(SITE_ONLY_PATCH_KEYS).size).toBe(SITE_ONLY_PATCH_KEYS.length)
  })

  it('what the assistant may change is editable, and touches neither admin-only keys nor images', () => {
    const allowed = assistantAllowedKeys()
    expect(isSubset(allowed, TOUR_PATCH_KEYS)).toBe(true)
    expect(allowed.filter((key) => SITE_ONLY_PATCH_KEYS.includes(key))).toEqual([])
    expect(allowed.filter((key) => IMAGE_KEYS.includes(key))).toEqual([])
    expect(isSubset(ASSISTANT_CONTENT_KEYS, CONTENT_PATCH_KEYS)).toBe(true)
    const expected = TOUR_PATCH_KEYS.filter((key) => !CONTENT_PATCH_KEYS.includes(key) || ASSISTANT_CONTENT_KEYS.includes(key))
    expect(sorted(allowed)).toEqual(sorted(expected))
  })

  it('the key lists in the assistant\'s tool description say the same thing', () => {
    const allowed = assistantAllowedKeys()
    expect(sorted(promptKeyList('update_tour 允许的键：'))).toEqual(sorted(allowed))
    const blocked = TOUR_PATCH_KEYS.filter((key) => !allowed.includes(key))
    expect(sorted(promptKeyList('不能改的键（写了这条改动会被拒）：'))).toEqual(sorted(blocked))
  })
})

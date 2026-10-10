import { describe, it, expect } from 'vitest'
import {
  computeDiffHash,
  diffCatalog,
  keepCurrentStatuses,
  parsePublishedSnapshot,
  projectCatalog,
  type CatalogContent,
} from '../publish'
import type { CatalogDeparture, CatalogItineraryDay, CatalogTour } from '../types'

const today = '2026-10-10'

function tour(overrides: Partial<CatalogTour> = {}): CatalogTour {
  return {
    id: 't1',
    clientId: 'c1',
    slug: 's1',
    destination: 'china',
    tier: 'discovery',
    name: 'Golden China',
    title: null,
    shortDescription: null,
    durationText: '10 days',
    displayPriceText: 'From NZD $4,999 per person',
    highlights: [],
    itinerary: [],
    inclusions: [],
    exclusions: [],
    tourCities: [],
    singleSupplement: null,
    maxGroupSize: null,
    isActive: true,
    managesDepartures: true,
    sortOrder: 1,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function departure(overrides: Partial<CatalogDeparture> = {}): CatalogDeparture {
  return {
    id: 'd1',
    tourId: 't1',
    clientId: 'c1',
    departOn: '2027-03-11',
    returnOn: '2027-03-25',
    priceTextOverride: null,
    status: 'open',
    internal: {},
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function toSnapshot(content: CatalogContent): Record<string, unknown> {
  return {
    schema_version: 1,
    tours: content.tours.map((t) => ({
      id: t.id,
      client_id: t.clientId,
      slug: t.slug,
      destination: t.destination,
      tier: t.tier,
      name: t.name,
      title: t.title,
      short_description: t.shortDescription,
      duration_text: t.durationText,
      display_price_text: t.displayPriceText,
      highlights: t.highlights,
      itinerary: t.itinerary,
      inclusions: t.inclusions,
      exclusions: t.exclusions,
      tour_cities: t.tourCities,
      single_supplement: t.singleSupplement,
      max_group_size: t.maxGroupSize,
      is_active: t.isActive,
      manages_departures: t.managesDepartures,
      sort_order: t.sortOrder,
      updated_at: t.updatedAt,
    })),
    departures: content.departures.map((d) => ({
      id: d.id,
      tour_id: d.tourId,
      client_id: d.clientId,
      depart_on: d.departOn,
      return_on: d.returnOn,
      price_text_override: d.priceTextOverride,
      status: d.status,
      updated_at: d.updatedAt,
    })),
  }
}

function day(overrides: Partial<CatalogItineraryDay> = {}): CatalogItineraryDay {
  return { day: 1, title: 'Arrive', description: 'Welcome', ...overrides }
}

function richDraft(): CatalogContent {
  return {
    tours: [
      tour({
        id: 't1',
        name: 'Golden China',
        itinerary: [day({ day: 1, title: 'Arrive', description: 'Welcome', meals: ['dinner'] })],
      }),
      tour({ id: 't2', name: 'Silk Road', sortOrder: 2 }),
    ],
    departures: [
      departure({ id: 'd1', tourId: 't1', departOn: '2027-03-11', internal: { airline: 'CA' } }),
      departure({ id: 'd2', tourId: 't1', departOn: '2027-04-11' }),
      departure({ id: 'd3', tourId: 't2', departOn: '2027-05-11' }),
    ],
  }
}

describe('diffCatalog', () => {
  it('publish then compare immediately yields zero differences', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    const diff = diffCatalog(parsed, draft, today)
    expect(diff.changes).toEqual([])
    expect(diff.highRiskCount).toBe(0)
  })

  it('changing only internal and updatedAt yields zero differences and equal hashes', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: draft.departures.map((d) =>
        d.id === 'd1'
          ? { ...d, internal: { airline: 'MU', capacity: 20 }, updatedAt: '2026-02-02T00:00:00Z' }
          : d,
      ),
    }
    const diff = diffCatalog(parsed, changed, today)
    expect(diff.changes).toEqual([])
    const hashA = computeDiffHash({
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projectCatalog(parsed),
      draftProjection: projectCatalog(draft),
      highRiskCount: 0,
    })
    const hashB = computeDiffHash({
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projectCatalog(parsed),
      draftProjection: projectCatalog(changed),
      highRiskCount: 0,
    })
    expect(hashA).toBe(hashB)
  })

  it('flags a displayPriceText change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, displayPriceText: 'From NZD $5,999' } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'displayPriceText')
    expect(change).toEqual({
      kind: 'tour_field',
      tourId: 't1',
      tourName: 'Golden China',
      field: 'displayPriceText',
      fieldLabel: '展示价',
      before: 'From NZD $4,999 per person',
      after: 'From NZD $5,999',
      risk: 'high',
    })
  })

  it('flags a singleSupplement change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, singleSupplement: 'NZD 900' } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'singleSupplement')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('单房差')
    expect(change?.before).toBeNull()
    expect(change?.after).toBe('NZD 900')
  })

  it('flags a name change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, name: 'Golden China Deluxe' } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'name')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('团名')
    expect(change?.before).toBe('Golden China')
    expect(change?.after).toBe('Golden China Deluxe')
  })

  it('flags a title change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, title: 'The Golden Route' } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'title')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('对外标题')
    expect(change?.before).toBeNull()
    expect(change?.after).toBe('The Golden Route')
  })

  it('flags an isActive change as high risk with 在售/停售 labels', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, isActive: false } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'isActive')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('是否在售')
    expect(change?.before).toBe('在售')
    expect(change?.after).toBe('停售')
  })

  it('flags a managesDepartures change as high risk with 是/否 labels', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, managesDepartures: false } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'managesDepartures')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('是否管理班期')
    expect(change?.before).toBe('是')
    expect(change?.after).toBe('否')
  })

  it('flags a tour_added change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [...draft.tours, tour({ id: 't3', name: 'New Tour', sortOrder: 3 })],
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.kind === 'tour_added')
    expect(change).toEqual({
      kind: 'tour_added',
      tourId: 't3',
      tourName: 'New Tour',
      fieldLabel: '新增团',
      before: null,
      after: 'New Tour',
      risk: 'high',
    })
  })

  it('flags a tour_removed change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.filter((t) => t.id !== 't2'),
      departures: draft.departures.filter((d) => d.tourId !== 't2'),
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.kind === 'tour_removed')
    expect(change).toEqual({
      kind: 'tour_removed',
      tourId: 't2',
      tourName: 'Silk Road',
      fieldLabel: '移除团',
      before: 'Silk Road',
      after: null,
      risk: 'high',
    })
  })

  it('flags a departure_added change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: [...draft.departures, departure({ id: 'd9', tourId: 't1', departOn: '2027-06-11' })],
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.kind === 'departure_added')
    expect(change).toEqual({
      kind: 'departure_added',
      tourId: 't1',
      tourName: 'Golden China',
      departOn: '2027-06-11',
      fieldLabel: '新增班期',
      before: null,
      after: '2027-06-11（可订）',
      risk: 'high',
    })
  })

  it('flags a departure_removed change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: draft.departures.filter((d) => d.id !== 'd2'),
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.kind === 'departure_removed')
    expect(change).toEqual({
      kind: 'departure_removed',
      tourId: 't1',
      tourName: 'Golden China',
      departOn: '2027-04-11',
      fieldLabel: '移除班期',
      before: '2027-04-11（可订）',
      after: null,
      risk: 'high',
    })
  })

  it('flags a departure status change as high risk with labels', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: draft.departures.map((d) => (d.id === 'd1' ? { ...d, status: 'sold_out' } : d)),
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'status')
    expect(change?.kind).toBe('departure_field')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('班期状态')
    expect(change?.before).toBe('可订')
    expect(change?.after).toBe('已满团')
  })

  it('flags a departure priceTextOverride change as high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: draft.departures.map((d) => (d.id === 'd1' ? { ...d, priceTextOverride: 'NZD 5,199' } : d)),
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'priceTextOverride')
    expect(change?.kind).toBe('departure_field')
    expect(change?.risk).toBe('high')
    expect(change?.fieldLabel).toBe('班期单独价')
    expect(change?.before).toBeNull()
    expect(change?.after).toBe('NZD 5,199')
  })

  it('flags a shortDescription change as normal risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, shortDescription: 'A short trip' } : t)),
      departures: draft.departures,
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'shortDescription')
    expect(change?.risk).toBe('normal')
    expect(change?.fieldLabel).toBe('行程简介')
  })

  it('labels an itinerary change on the 3rd day', () => {
    const draft: CatalogContent = {
      tours: [
        tour({
          id: 't1',
          itinerary: [day({ day: 1 }), day({ day: 2 }), day({ day: 3, title: 'Old' })],
        }),
      ],
      departures: [],
    }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [
        tour({
          id: 't1',
          itinerary: [day({ day: 1 }), day({ day: 2 }), day({ day: 3, title: 'New' })],
        }),
      ],
      departures: [],
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'itinerary')
    expect(change?.fieldLabel).toBe('行程 第 3 天')
    expect(change?.risk).toBe('normal')
  })

  it('flags a returnOn change as normal risk with 返程日期 label', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: draft.departures.map((d) => (d.id === 'd1' ? { ...d, returnOn: '2027-03-30' } : d)),
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'returnOn')
    expect(change?.risk).toBe('normal')
    expect(change?.fieldLabel).toBe('返程日期')
  })

  it('emits both a status change and a sellable_flip when the only future departure sells out', () => {
    const draft: CatalogContent = {
      tours: [tour({ id: 't1', managesDepartures: true })],
      departures: [departure({ id: 'd1', tourId: 't1', departOn: '2027-03-11', status: 'open' })],
    }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours,
      departures: draft.departures.map((d) => ({ ...d, status: 'sold_out' as const })),
    }
    const diff = diffCatalog(parsed, changed, today)
    const statusChange = diff.changes.find((c) => c.field === 'status')
    const flip = diff.changes.find((c) => c.kind === 'sellable_flip')
    expect(statusChange?.kind).toBe('departure_field')
    expect(flip?.before).toBe('可售')
    expect(flip?.after).toBe('不可售')
    expect(diff.sellable).toEqual({ before: 1, after: 0, needsCountConfirm: true })
  })

  it('computes needsCountConfirm boundaries', () => {
    const make = (count: number): CatalogContent => ({
      tours: Array.from({ length: count }, (_, i) =>
        tour({ id: `t${i}`, name: `Tour ${i}`, managesDepartures: false, sortOrder: i }),
      ),
      departures: [],
    })
    const ten = make(10)
    const parsedTen = parsePublishedSnapshot(toSnapshot(ten))
    if (parsedTen === null) throw new Error('parse failed')
    expect(diffCatalog(parsedTen, make(7), today).sellable).toEqual({ before: 10, after: 7, needsCountConfirm: false })
    expect(diffCatalog(parsedTen, make(6), today).sellable).toEqual({ before: 10, after: 6, needsCountConfirm: true })

    const empty = make(0)
    const parsedEmpty = parsePublishedSnapshot(toSnapshot(empty))
    if (parsedEmpty === null) throw new Error('parse failed')
    expect(diffCatalog(parsedEmpty, make(3), today).sellable).toEqual({ before: 0, after: 3, needsCountConfirm: false })
    expect(diffCatalog(parsedEmpty, make(0), today).sellable).toEqual({ before: 0, after: 0, needsCountConfirm: true })
  })

  it('treats a first publish as no changes with sellable.before 0', () => {
    const draft = richDraft()
    const diff = diffCatalog(null, draft, today)
    expect(diff.changes).toEqual([])
    expect(diff.sellable.before).toBe(0)
  })

  it('truncates long text to 200 characters but still detects the change', () => {
    const base = 'x'.repeat(250)
    const draft: CatalogContent = {
      tours: [tour({ id: 't1', shortDescription: base })],
      departures: [],
    }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [tour({ id: 't1', shortDescription: base.slice(0, 249) + 'y' })],
      departures: [],
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'shortDescription')
    expect(change).toBeDefined()
    expect(change?.before?.length).toBe(200)
    expect(change?.after?.length).toBe(200)
  })

  it('lists each changed tour once in changedTourIds', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, name: 'Renamed', displayPriceText: 'New' } : t)),
      departures: draft.departures.map((d) => (d.id === 'd1' ? { ...d, status: 'sold_out' } : d)),
    }
    const diff = diffCatalog(parsed, changed, today)
    expect(diff.changedTourIds).toEqual(['t1'])
  })
})

describe('computeDiffHash', () => {
  const draft = richDraft()
  const projection = projectCatalog(draft)

  it('is stable for identical input', () => {
    const input = {
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projection,
      draftProjection: projection,
      highRiskCount: 0,
    }
    expect(computeDiffHash(input)).toBe(computeDiffHash(input))
  })

  it('changes when publishedVersion changes', () => {
    const base = {
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projection,
      draftProjection: projection,
      highRiskCount: 0,
    }
    expect(computeDiffHash(base)).not.toBe(computeDiffHash({ ...base, publishedVersion: 2 }))
  })

  it('changes when draftVersion changes', () => {
    const base = {
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projection,
      draftProjection: projection,
      highRiskCount: 0,
    }
    expect(computeDiffHash(base)).not.toBe(computeDiffHash({ ...base, draftVersion: 3 }))
  })

  it('changes when highRiskCount changes', () => {
    const base = {
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projection,
      draftProjection: projection,
      highRiskCount: 0,
    }
    expect(computeDiffHash(base)).not.toBe(computeDiffHash({ ...base, highRiskCount: 1 }))
  })

  it('changes when a projected field changes', () => {
    const base = {
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projection,
      draftProjection: projection,
      highRiskCount: 0,
    }
    const other = projectCatalog({
      tours: draft.tours.map((t) => (t.id === 't1' ? { ...t, name: 'Other' } : t)),
      departures: draft.departures,
    })
    expect(computeDiffHash(base)).not.toBe(computeDiffHash({ ...base, draftProjection: other }))
  })

  it('changes when revertTargetVersion is set', () => {
    const base = {
      publishedVersion: 1,
      draftVersion: 2,
      publishedProjection: projection,
      draftProjection: projection,
      highRiskCount: 0,
    }
    expect(computeDiffHash(base)).not.toBe(computeDiffHash({ ...base, revertTargetVersion: 1 }))
  })
})

describe('parsePublishedSnapshot', () => {
  it('returns null for an unknown schema_version', () => {
    const snapshot = { ...toSnapshot(richDraft()), schema_version: 2 }
    expect(parsePublishedSnapshot(snapshot)).toBeNull()
  })

  it('returns null when schema_version is missing', () => {
    const snapshot = toSnapshot(richDraft())
    delete snapshot.schema_version
    expect(parsePublishedSnapshot(snapshot)).toBeNull()
  })

  it('returns null for a non-object', () => {
    expect(parsePublishedSnapshot(null)).toBeNull()
    expect(parsePublishedSnapshot('nope')).toBeNull()
    expect(parsePublishedSnapshot([])).toBeNull()
  })

  it('drops departures with unknown or missing status but keeps valid siblings', () => {
    const snapshot = toSnapshot(richDraft())
    const departures = snapshot.departures as Array<Record<string, unknown>>
    departures.push({ id: 'bad1', tour_id: 't1', client_id: 'c1', depart_on: '2027-07-01', return_on: null, price_text_override: null, status: 'weird', updated_at: '2026-01-01T00:00:00Z' })
    departures.push({ id: 'bad2', tour_id: 't1', client_id: 'c1', depart_on: '2027-08-01', return_on: null, price_text_override: null, updated_at: '2026-01-01T00:00:00Z' })
    const parsed = parsePublishedSnapshot(snapshot)
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    const ids = parsed.departures.map((d) => d.id)
    expect(ids).not.toContain('bad1')
    expect(ids).not.toContain('bad2')
    expect(ids).toContain('d1')
  })

  it('ignores internal data present in the raw departure', () => {
    const snapshot = toSnapshot(richDraft())
    const departures = snapshot.departures as Array<Record<string, unknown>>
    departures[0].internal = { airline: 'CA', capacity: 30 }
    const parsed = parsePublishedSnapshot(snapshot)
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.departures[0].internal).toEqual({})
  })
})

describe('keepCurrentStatuses', () => {
  it('keeps the current status of a shared departure and reports it', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1', name: 'Golden China' })],
      departures: [departure({ id: 'd1', tourId: 't1', status: 'open' })],
    }
    const current: CatalogContent = {
      tours: [tour({ id: 't1', name: 'Golden China' })],
      departures: [departure({ id: 'd1', tourId: 't1', status: 'sold_out' })],
    }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures[0].status).toBe('sold_out')
    expect(result.kept).toEqual([
      { tourName: 'Golden China', departOn: '2027-03-11', currentStatus: '已满团', oldStatus: '可订' },
    ])
  })

  it('keeps the target status for a departure only in target', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'd1', status: 'limited' })],
    }
    const current: CatalogContent = { tours: [tour({ id: 't1' })], departures: [] }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures[0].status).toBe('limited')
    expect(result.kept).toEqual([])
  })

  it('produces no kept row when statuses are equal', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'd1', status: 'open' })],
    }
    const current: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'd1', status: 'open' })],
    }
    const result = keepCurrentStatuses(target, current)
    expect(result.kept).toEqual([])
  })

  it('takes tour fields from target and does not mutate inputs', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1', name: 'Target Name' })],
      departures: [departure({ id: 'd1', status: 'open' })],
    }
    const current: CatalogContent = {
      tours: [tour({ id: 't1', name: 'Current Name' })],
      departures: [departure({ id: 'd1', status: 'sold_out' })],
    }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.tours[0].name).toBe('Target Name')
    expect(target.departures[0].status).toBe('open')
    expect(current.departures[0].status).toBe('sold_out')
  })
})

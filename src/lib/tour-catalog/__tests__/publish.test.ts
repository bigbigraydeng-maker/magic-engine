import { describe, it, expect } from 'vitest'
import {
  computeDiffHash,
  diffCatalog,
  parsePublishedSnapshot,
  projectCatalog,
  type CatalogContent,
} from '../publish'
import { day, departure, richDraft, today, toSnapshot, tour } from './publish.fixtures'

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

  it('shows a window around the first difference when long texts share a 250-character prefix', () => {
    const base = 'x'.repeat(250)
    const draft: CatalogContent = {
      tours: [tour({ id: 't1', shortDescription: base + 'OLD-ENDING' })],
      departures: [],
    }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [tour({ id: 't1', shortDescription: base + 'NEW-ENDING' })],
      departures: [],
    }
    const diff = diffCatalog(parsed, changed, today)
    const change = diff.changes.find((c) => c.field === 'shortDescription')
    expect(change).toBeDefined()
    expect(change?.before).not.toBe(change?.after)
    expect(change?.before).toContain('OLD-ENDING')
    expect(change?.after).toContain('NEW-ENDING')
    // 40 characters of shared context before the difference, cut marked with an ellipsis.
    expect(change?.before).toBe('…' + 'x'.repeat(40) + 'OLD-ENDING')
    expect(change?.after).toBe('…' + 'x'.repeat(40) + 'NEW-ENDING')
  })

  it('caps a long value at about 200 characters and marks both cut ends', () => {
    const head = 'a'.repeat(300)
    const tail = 'z'.repeat(300)
    const draft: CatalogContent = {
      tours: [tour({ id: 't1', shortDescription: head + 'B' + tail })],
      departures: [],
    }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [tour({ id: 't1', shortDescription: head + 'C' + tail })],
      departures: [],
    }
    const change = diffCatalog(parsed, changed, today).changes.find((c) => c.field === 'shortDescription')
    expect(change?.before).toBe('…' + 'a'.repeat(40) + 'B' + 'z'.repeat(159) + '…')
    expect(change?.after).toBe('…' + 'a'.repeat(40) + 'C' + 'z'.repeat(159) + '…')
  })

  it('shows short values whole and cuts a long one from the start when the other side is empty', () => {
    const long = 'q'.repeat(250)
    const draft: CatalogContent = { tours: [tour({ id: 't1', shortDescription: null })], departures: [] }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = { tours: [tour({ id: 't1', shortDescription: long })], departures: [] }
    const change = diffCatalog(parsed, changed, today).changes.find((c) => c.field === 'shortDescription')
    expect(change?.before).toBeNull()
    expect(change?.after).toBe('q'.repeat(200) + '…')

    const exact = 'k'.repeat(200)
    const shortChanged: CatalogContent = { tours: [tour({ id: 't1', shortDescription: exact })], departures: [] }
    const shortChange = diffCatalog(parsed, shortChanged, today).changes.find((c) => c.field === 'shortDescription')
    expect(shortChange?.after).toBe(exact)
  })

  it('shows different before/after when only the day number of an itinerary day changes', () => {
    const draft: CatalogContent = {
      tours: [tour({ id: 't1', itinerary: [day({ day: 1 }), day({ day: 2, title: 'Xi an' })] })],
      departures: [],
    }
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [tour({ id: 't1', itinerary: [day({ day: 1 }), day({ day: 3, title: 'Xi an' })] })],
      departures: [],
    }
    const changes = diffCatalog(parsed, changed, today).changes.filter((c) => c.field === 'itinerary')
    expect(changes).toHaveLength(1)
    expect(changes[0].before).not.toBe(changes[0].after)
    expect(changes[0].before).toBe('第 2 天｜Xi an｜Welcome')
    expect(changes[0].after).toBe('第 3 天｜Xi an｜Welcome')
  })

  it('spells out a new tour: the tour, its prices and every departure, all high risk', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const changed: CatalogContent = {
      tours: [
        ...draft.tours,
        tour({ id: 't3', name: 'New Tour', sortOrder: 3, displayPriceText: 'From NZD $3,999 per person', singleSupplement: 'NZD $800' }),
      ],
      departures: [
        ...draft.departures,
        departure({ id: 'n2', tourId: 't3', departOn: '2027-10-10', status: 'limited' }),
        departure({ id: 'n1', tourId: 't3', departOn: '2027-09-09', priceTextOverride: 'NZD $4,080' }),
      ],
    }
    const diff = diffCatalog(parsed, changed, today)
    const forTour = diff.changes.filter((c) => c.tourId === 't3')
    expect(forTour).toEqual([
      { kind: 'tour_added', tourId: 't3', tourName: 'New Tour', fieldLabel: '新增团', before: null, after: 'New Tour', risk: 'high' },
      { kind: 'tour_field', tourId: 't3', tourName: 'New Tour', field: 'displayPriceText', fieldLabel: '展示价', before: null, after: 'From NZD $3,999 per person', risk: 'high' },
      { kind: 'tour_field', tourId: 't3', tourName: 'New Tour', field: 'singleSupplement', fieldLabel: '单房差', before: null, after: 'NZD $800', risk: 'high' },
      { kind: 'departure_added', tourId: 't3', tourName: 'New Tour', departOn: '2027-09-09', fieldLabel: '新增班期', before: null, after: '2027-09-09（可订，NZD $4,080）', risk: 'high' },
      { kind: 'departure_added', tourId: 't3', tourName: 'New Tour', departOn: '2027-10-10', fieldLabel: '新增班期', before: null, after: '2027-10-10（少量余位）', risk: 'high' },
    ])
    expect(diff.highRiskCount).toBe(5)
  })

  it('lists only the tour line for a new tour without prices or departures; a removed tour stays one line', () => {
    const draft = richDraft()
    const parsed = parsePublishedSnapshot(toSnapshot(draft))
    if (parsed === null) throw new Error('parse failed')
    const added: CatalogContent = {
      tours: [...draft.tours, tour({ id: 't3', name: 'Bare', sortOrder: 3, displayPriceText: null, singleSupplement: null })],
      departures: draft.departures,
    }
    expect(diffCatalog(parsed, added, today).changes.filter((c) => c.tourId === 't3').map((c) => c.kind)).toEqual(['tour_added'])

    const removed: CatalogContent = {
      tours: draft.tours.filter((t) => t.id !== 't1'),
      departures: draft.departures.filter((d) => d.tourId !== 't1'),
    }
    expect(diffCatalog(parsed, removed, today).changes.filter((c) => c.tourId === 't1').map((c) => c.kind)).toEqual(['tour_removed'])
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

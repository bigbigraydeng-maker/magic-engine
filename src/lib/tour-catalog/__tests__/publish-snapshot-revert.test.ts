import { describe, it, expect, vi } from 'vitest'
import { diffCatalog, keepCurrentStatuses, parsePublishedSnapshot, type CatalogContent } from '../publish'
import { departure, richDraft, today, toSnapshot, tour } from './publish.fixtures'

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

  it('drops a tour (and its departures) when manages_departures is missing, a string, or the id is empty', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const base = toSnapshot(richDraft())
    const baseTours = base.tours as Array<Record<string, unknown>>
    const cases: Array<{ label: string; mutate: (t1: Record<string, unknown>) => void; departuresTourId: string }> = [
      { label: 'missing manages_departures', mutate: (t1) => { delete t1.manages_departures }, departuresTourId: 't1' },
      { label: 'manages_departures "true"', mutate: (t1) => { t1.manages_departures = 'true' }, departuresTourId: 't1' },
      { label: 'is_active missing', mutate: (t1) => { delete t1.is_active }, departuresTourId: 't1' },
      { label: 'empty id', mutate: (t1) => { t1.id = '' }, departuresTourId: 't1' },
    ]
    for (const testCase of cases) {
      spy.mockClear()
      const t1 = { ...baseTours[0] }
      testCase.mutate(t1)
      const parsed = parsePublishedSnapshot({ ...base, tours: [t1, baseTours[1]] })
      expect(parsed, testCase.label).not.toBeNull()
      if (parsed === null) continue
      expect(parsed.tours.map((t) => t.id), testCase.label).toEqual(['t2'])
      expect(parsed.departures.map((d) => d.id), testCase.label).toEqual(['d3'])
      expect(spy, testCase.label).toHaveBeenCalled()
    }
    spy.mockRestore()
  })

  it('drops a departure with an impossible date without throwing, and keeps its siblings', () => {
    const snapshot = toSnapshot(richDraft())
    const departures = snapshot.departures as Array<Record<string, unknown>>
    departures.push({ id: 'badDate', tour_id: 't1', client_id: 'c1', depart_on: '2027-13-45', return_on: null, price_text_override: null, status: 'open', updated_at: '2026-01-01T00:00:00Z' })
    departures.push({ id: 'noDate', tour_id: 't1', client_id: 'c1', return_on: null, price_text_override: null, status: 'open', updated_at: '2026-01-01T00:00:00Z' })
    const parsed = parsePublishedSnapshot(snapshot)
    expect(parsed).not.toBeNull()
    if (parsed === null) return
    expect(parsed.departures.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(() => diffCatalog(parsed, richDraft(), today)).not.toThrow()
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

  it('brings back a departure that no longer exists outward as closed, and reports it', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'd1', status: 'limited' })],
    }
    const current: CatalogContent = { tours: [tour({ id: 't1' })], departures: [] }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures[0].status).toBe('closed')
    expect(result.kept).toEqual([
      { tourName: 'Golden China', departOn: '2027-03-11', currentStatus: '已关闭（现在对外已没有这个班期）', oldStatus: '少量余位' },
    ])
  })

  it('does not report a missing departure that was already closed in the target', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'd1', status: 'closed' })],
    }
    const current: CatalogContent = { tours: [tour({ id: 't1' })], departures: [] }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures[0].status).toBe('closed')
    expect(result.kept).toEqual([])
  })

  it('matches by tour + date when the same day was re-created under a new id (stays cancelled)', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'old-id', tourId: 't1', departOn: '2027-06-01', status: 'open' })],
    }
    const current: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'new-id', tourId: 't1', departOn: '2027-06-01', status: 'cancelled' })],
    }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures).toHaveLength(1)
    expect(result.content.departures[0].id).toBe('old-id')
    expect(result.content.departures[0].status).toBe('cancelled')
    expect(result.kept).toEqual([
      { tourName: 'Golden China', departOn: '2027-06-01', currentStatus: '已取消', oldStatus: '可订' },
    ])
  })

  it('prefers the id match over a tour + date match, and never matches another tour on the same date', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' }), tour({ id: 't2', name: 'Silk Road' })],
      departures: [
        departure({ id: 'a', tourId: 't1', departOn: '2027-06-01', status: 'open' }),
        departure({ id: 'b', tourId: 't2', departOn: '2027-06-01', status: 'open' }),
      ],
    }
    const current: CatalogContent = {
      tours: [tour({ id: 't1' }), tour({ id: 't2', name: 'Silk Road' })],
      departures: [
        // Same id as target "a" but moved to another day, and sold out.
        departure({ id: 'a', tourId: 't1', departOn: '2027-07-01', status: 'sold_out' }),
        // Another departure now sits on a's old day.
        departure({ id: 'z', tourId: 't1', departOn: '2027-06-01', status: 'cancelled' }),
      ],
    }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures.map((d) => [d.id, d.status])).toEqual([
      ['a', 'sold_out'],
      ['b', 'closed'],
    ])
  })

  it('drops departures added after the target version (they are simply not in the result)', () => {
    const target: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [departure({ id: 'd1', departOn: '2027-06-01' })],
    }
    const current: CatalogContent = {
      tours: [tour({ id: 't1' })],
      departures: [
        departure({ id: 'd1', departOn: '2027-06-01' }),
        departure({ id: 'd-new', departOn: '2027-08-01' }),
      ],
    }
    const result = keepCurrentStatuses(target, current)
    expect(result.content.departures.map((d) => d.id)).toEqual(['d1'])
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

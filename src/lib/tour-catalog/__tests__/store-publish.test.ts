import { describe, expect, it, vi } from 'vitest'
import {
  buildPublishPreview,
  getPublishState,
  loadPublished,
  loadPublishedProducts,
  PublishedUnreadableError,
  publishDraft,
} from '../store-publish'
import {
  CLIENT_ID,
  TODAY,
  asDb,
  departureRow,
  makeFakeDb,
  publishedRow,
  stateRow,
  tourRow,
  validReq,
} from './store-publish.fixtures'

// ---------------------------------------------------------------------------
// getPublishState
// ---------------------------------------------------------------------------

describe('getPublishState', () => {
  it('returns zeros when the state row is missing', async () => {
    const db = makeFakeDb({ state: null })
    const state = await getPublishState(asDb(db), CLIENT_ID)
    expect(state).toEqual({ draftVersion: 0, publishedVersion: 0 })
  })

  it('maps both numbers from an existing row', async () => {
    const db = makeFakeDb({ state: stateRow(7, 3) })
    const state = await getPublishState(asDb(db), CLIENT_ID)
    expect(state).toEqual({ draftVersion: 7, publishedVersion: 3 })
  })

  it('throws on a read error', async () => {
    const db = makeFakeDb({ state: stateRow(1, 1), failTable: 'tour_catalog_state' })
    await expect(getPublishState(asDb(db), CLIENT_ID)).rejects.toThrow('boom')
  })
})

// ---------------------------------------------------------------------------
// loadPublished
// ---------------------------------------------------------------------------

describe('loadPublished', () => {
  it('returns { published: false } when nothing is published', async () => {
    const db = makeFakeDb({ published: [] })
    const read = await loadPublished(asDb(db), CLIENT_ID)
    expect(read).toEqual({ published: false })
  })

  it('returns the highest version and its content together', async () => {
    const db = makeFakeDb({
      published: [
        publishedRow(1, [tourRow({ name: 'Old' })], [departureRow()]),
        publishedRow(2, [tourRow({ name: 'New' })], [departureRow()]),
      ],
    })
    const read = await loadPublished(asDb(db), CLIENT_ID)
    expect(read.published).toBe(true)
    if (read.published) {
      expect(read.version).toBe(2)
      expect(read.tours[0].name).toBe('New')
    }
  })

  it('fails closed and logs when the latest snapshot is unreadable', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      published: [
        publishedRow(1, [tourRow()], [departureRow()]),
        publishedRow(2, [tourRow()], [departureRow()], {
          snapshot: { schema_version: 99, tours: [], departures: [] },
        }),
      ],
    })
    const read = await loadPublished(asDb(db), CLIENT_ID)
    expect(read).toEqual({ published: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('drops a departure with an unknown status', async () => {
    const db = makeFakeDb({
      published: [publishedRow(1, [tourRow()], [departureRow({ status: 'weird' })])],
    })
    const read = await loadPublished(asDb(db), CLIENT_ID)
    expect(read.published).toBe(true)
    if (read.published) {
      expect(read.departures).toHaveLength(0)
    }
  })
})

// ---------------------------------------------------------------------------
// loadPublishedProducts
// ---------------------------------------------------------------------------

describe('loadPublishedProducts', () => {
  it('returns { published: false } when never published', async () => {
    const db = makeFakeDb({ tours: [tourRow()], published: [] })
    const read = await loadPublishedProducts(asDb(db), CLIENT_ID, TODAY)
    expect(read).toEqual({ published: false })
  })

  it('returns the version and feed tours when published', async () => {
    const db = makeFakeDb({
      published: [publishedRow(4, [tourRow()], [departureRow()])],
    })
    const read = await loadPublishedProducts(asDb(db), CLIENT_ID, TODAY)
    expect(read.published).toBe(true)
    if (read.published) {
      expect(read.version).toBe(4)
      expect(read.tours).toHaveLength(1)
      expect(read.tours[0].departure_dates).toEqual(['11 March 2027'])
    }
  })

  it('never reads the draft tables', async () => {
    const db = makeFakeDb({
      tours: [tourRow({ id: 't2', name: 'Draft Only' })],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const read = await loadPublishedProducts(asDb(db), CLIENT_ID, TODAY)
    expect(read.published).toBe(true)
    if (read.published) {
      expect(read.tours.map((t) => t.id)).toEqual(['t1'])
    }
    expect(db.fromCalls).not.toContain('tour_catalog_tours')
  })
})

// ---------------------------------------------------------------------------
// buildPublishPreview
// ---------------------------------------------------------------------------

describe('buildPublishPreview', () => {
  it('describes a first publish', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.firstPublish).toBe(true)
    expect(preview.changes).toEqual([])
    expect(preview.publishedVersion).toBe(0)
    expect(preview.afterRevert).toBeNull()
    expect(preview.sellable).toEqual({ before: 0, after: 1, needsCountConfirm: true })
    expect(preview.firstPublishRows).toHaveLength(1)
    expect(preview.firstPublishRows[0]).toEqual({
      tourId: 't1',
      tourName: 'Golden China',
      displayPriceText: 'From NZD $4,999 per person',
      upcomingDepartures: 1,
      nextDepartOn: '2027-03-11',
      sellable: true,
    })
  })

  it('reads state, then tours, then published', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const stateIdx = db.fromCalls.indexOf('tour_catalog_state')
    const toursIdx = db.fromCalls.indexOf('tour_catalog_tours')
    const publishedIdx = db.fromCalls.indexOf('tour_catalog_published')
    expect(stateIdx).toBeGreaterThanOrEqual(0)
    expect(stateIdx).toBeLessThan(toursIdx)
    expect(toursIdx).toBeLessThan(publishedIdx)
  })

  it('reports no changes when the draft equals what is published', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 1),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.firstPublish).toBe(false)
    expect(preview.changes).toEqual([])
  })

  it('reports a price change as high risk', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 1),
      tours: [tourRow({ display_price_text: 'From NZD $5,999 per person' })],
      departures: [departureRow()],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.changes).toHaveLength(1)
    expect(preview.highRiskCount).toBe(1)
    expect(preview.changedTourIds).toEqual(['t1'])
  })

  it('does not force the typed sellable count on an ordinary (non-first) publish', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 1),
      tours: [tourRow({ display_price_text: 'From NZD $5,999 per person' })],
      departures: [departureRow()],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.sellable).toEqual({ before: 1, after: 1, needsCountConfirm: false })
  })

  it('throws instead of treating an unreadable published version as a first publish', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      state: stateRow(3, 2),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [
        publishedRow(2, [tourRow()], [departureRow()], {
          snapshot: { schema_version: 99, tours: [], departures: [] },
        }),
      ],
    })
    await expect(buildPublishPreview(asDb(db), CLIENT_ID, TODAY)).rejects.toBeInstanceOf(PublishedUnreadableError)
    spy.mockRestore()
  })

  it('throws when the state says published but the published row is missing', async () => {
    const db = makeFakeDb({ state: stateRow(3, 2), tours: [tourRow()], departures: [departureRow()], published: [] })
    await expect(buildPublishPreview(asDb(db), CLIENT_ID, TODAY)).rejects.toBeInstanceOf(PublishedUnreadableError)
  })

  it('flags afterRevert when the latest version came from a revert', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 2),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [publishedRow(2, [tourRow()], [departureRow()], { source_version: 1 })],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.afterRevert).toEqual({ toVersion: 1 })
  })
})

// ---------------------------------------------------------------------------
// publishDraft
// ---------------------------------------------------------------------------

describe('publishDraft', () => {
  it('publishes a first publish', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)
    expect(result).toEqual({ ok: true, version: 99 })
    expect(db.rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = db.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('tour_catalog_publish')
    expect(args.p_client_id).toBe('c1')
    expect(args.p_expected_draft_version).toBe(1)
    expect(args.p_expected_published_version).toBe(0)
    expect(args.p_actor).toBe('pm@x')
    expect(args.p_note).toBe('n')
    const summary = args.p_summary as Record<string, unknown>
    expect(summary.changeCount).toBe(0)
  })

  it('requires the typed sellable count on a first publish', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const missing = await publishDraft(asDb(db), CLIENT_ID, validReq(preview, { confirmSellableCount: null }), 'pm@x', TODAY)
    expect(missing).toEqual({ ok: false, error: 'sellable_count_mismatch' })
    const wrong = await publishDraft(asDb(db), CLIENT_ID, validReq(preview, { confirmSellableCount: 2 }), 'pm@x', TODAY)
    expect(wrong).toEqual({ ok: false, error: 'sellable_count_mismatch' })
    expect(db.rpc).not.toHaveBeenCalled()
    const ok = await publishDraft(asDb(db), CLIENT_ID, validReq(preview, { confirmSellableCount: 1 }), 'pm@x', TODAY)
    expect(ok).toEqual({ ok: true, version: 99 })
  })

  it('refuses to publish (publish_failed, no rpc) when the published version cannot be read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      state: stateRow(3, 2),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [
        publishedRow(2, [tourRow()], [departureRow()], {
          snapshot: { schema_version: 99, tours: [], departures: [] },
        }),
      ],
    })
    const req = {
      draftVersion: 3,
      publishedVersion: 2,
      diffHash: 'whatever',
      acknowledgeHighRisk: true,
      acknowledgeAfterRevert: true,
      confirmSellableCount: 1,
      note: '',
    }
    const result = await publishDraft(asDb(db), CLIENT_ID, req, 'pm@x', TODAY)
    expect(result).toEqual({ ok: false, error: 'publish_failed' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rejects a stale draftVersion', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { draftVersion: 999 }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('rejects a stale publishedVersion', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { publishedVersion: 999 }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(db.rpc).not.toHaveBeenCalled()
  }) 

  it('rejects a stale diffHash', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { diffHash: 'nope' }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('reports nothing_to_publish when the draft equals what is published', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 1),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)
    expect(result).toEqual({ ok: false, error: 'nothing_to_publish' })
  })

  it('reports nothing_to_publish on a first publish with zero tours', async () => {
    const db = makeFakeDb({ state: stateRow(1, 0), tours: [], departures: [], published: [] })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)
    expect(result).toEqual({ ok: false, error: 'nothing_to_publish' })
  })

  it('requires high-risk acknowledgement', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 1),
      tours: [tourRow({ display_price_text: 'From NZD $5,999 per person' })],
      departures: [departureRow()],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { acknowledgeHighRisk: false }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'high_risk_unacknowledged' })
  })

  it('requires after-revert acknowledgement', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 2),
      tours: [tourRow({ short_description: 'New blurb' })],
      departures: [departureRow()],
      published: [
        publishedRow(2, [tourRow()], [departureRow()], { source_version: 1 }),
      ],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.highRiskCount).toBe(0)
    const result = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { acknowledgeAfterRevert: false }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'after_revert_unacknowledged' })
  })

  it('requires the sellable count to be confirmed', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 1),
      tours: [tourRow({ is_active: false })],
      departures: [departureRow()],
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    expect(preview.sellable.needsCountConfirm).toBe(true)
    const mismatch = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { confirmSellableCount: null }),
      'pm@x',
      TODAY,
    )
    expect(mismatch).toEqual({ ok: false, error: 'sellable_count_mismatch' })

    const ok = await publishDraft(
      asDb(db),
      CLIENT_ID,
      validReq(preview, { confirmSellableCount: 0, acknowledgeHighRisk: true }),
      'pm@x',
      TODAY,
    )
    expect(ok).toEqual({ ok: true, version: 99 })
  })

  it('maps a stale rpc error', async () => {
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
      rpc: () => ({ data: null, error: { message: 'conflict:stale' } }),
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)
    expect(result).toEqual({ ok: false, error: 'stale' })
  })

  it('maps an unknown rpc error to publish_failed and logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      state: stateRow(1, 0),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [],
      rpc: () => ({ data: null, error: { message: 'permission denied for table x' } }),
    })
    const preview = await buildPublishPreview(asDb(db), CLIENT_ID, TODAY)
    const result = await publishDraft(asDb(db), CLIENT_ID, validReq(preview), 'pm@x', TODAY)
    expect(result).toEqual({ ok: false, error: 'publish_failed' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

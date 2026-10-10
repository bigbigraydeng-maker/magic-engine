import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPublishPreview,
  buildRevertPreview,
  getPublishState,
  listPublishedVersions,
  loadPublished,
  loadPublishedProducts,
  publishDraft,
  revertPublished,
} from '../store-publish'
import {
  CLIENT_ID,
  TODAY,
  asDb,
  departureRow,
  makeFakeDb,
  publishedRow,
  stateRow,
  tableRows,
  tourRow,
  validReq,
  validRevertReq,
  type FakeSeed,
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

// ---------------------------------------------------------------------------
// buildRevertPreview / revertPublished
// ---------------------------------------------------------------------------

function revertSeed(): FakeSeed {
  return {
    state: stateRow(2, 2),
    tours: [tourRow({ display_price_text: 'From NZD $5,999 per person' })],
    departures: [departureRow({ status: 'sold_out' })],
    published: [
      publishedRow(1, [tourRow()], [departureRow({ status: 'open' })]),
      publishedRow(2, [tourRow({ display_price_text: 'From NZD $5,999 per person' })], [
        departureRow({ status: 'sold_out' }),
      ]),
    ],
  }
}

describe('buildRevertPreview', () => {
  it('restores text and prices but keeps current statuses', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    expect(preview.targetVersion).toBe(1)
    expect(preview.publishedVersion).toBe(2)
    const priceChange = preview.changes.find((c) => c.field === 'displayPriceText')
    expect(priceChange).toBeDefined()
    expect(priceChange?.before).toBe('From NZD $5,999 per person')
    expect(priceChange?.after).toBe('From NZD $4,999 per person')
    expect(preview.changes.some((c) => c.field === 'status')).toBe(false)
    expect(preview.keptStatuses).toEqual([
      { tourName: 'Golden China', departOn: '2027-03-11', currentStatus: '已满团', oldStatus: '可订' },
    ])
  })

  it('reports already_current when the target is the current version', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 2, TODAY)
    expect(preview).toEqual({ error: 'already_current' })
  })

  it('reports version_not_found for a missing target', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 99, TODAY)
    expect(preview).toEqual({ error: 'version_not_found' })
  })

  it('reports version_not_found when nothing is published', async () => {
    const db = makeFakeDb({ published: [] })
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    expect(preview).toEqual({ error: 'version_not_found' })
  })

  it('produces a different diff hash per target version', async () => {
    const db = makeFakeDb({
      state: stateRow(3, 3),
      tours: [tourRow({ display_price_text: 'From NZD $7,999 per person' })],
      departures: [departureRow({ status: 'sold_out' })],
      published: [
        publishedRow(1, [tourRow()], [departureRow({ status: 'open' })]),
        publishedRow(2, [tourRow({ display_price_text: 'From NZD $5,999 per person' })], [
          departureRow({ status: 'sold_out' }),
        ]),
        publishedRow(3, [tourRow({ display_price_text: 'From NZD $7,999 per person' })], [
          departureRow({ status: 'sold_out' }),
        ]),
      ],
    })
    const toOne = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    const toTwo = await buildRevertPreview(asDb(db), CLIENT_ID, 2, TODAY)
    if ('error' in toOne || 'error' in toTwo) {
      throw new Error('unexpected error')
    }
    expect(toOne.diffHash).not.toBe(toTwo.diffHash)
  })
})

describe('revertPublished', () => {
  it('reverts successfully', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      validRevertReq(preview, 1),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: true, version: 99 })
    const [fn, args] = db.rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('tour_catalog_revert_published')
    expect(args.p_target_version).toBe(1)
    expect(args.p_expected_published_version).toBe(2)
    expect(args.p_actor).toBe('pm@x')
  })

  it('rejects a stale publishedVersion', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      validRevertReq(preview, 1, { publishedVersion: 999 }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('rejects a stale diffHash', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      validRevertReq(preview, 1, { diffHash: 'nope' }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'stale' })
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('requires high-risk acknowledgement', async () => {
    const db = makeFakeDb(revertSeed())
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      validRevertReq(preview, 1, { acknowledgeHighRisk: false }),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'high_risk_unacknowledged' })
  })

  it('reports nothing_to_publish when the versions are identical', async () => {
    const db = makeFakeDb({
      state: stateRow(2, 2),
      tours: [tourRow()],
      departures: [departureRow()],
      published: [
        publishedRow(1, [tourRow()], [departureRow()]),
        publishedRow(2, [tourRow()], [departureRow()]),
      ],
    })
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      validRevertReq(preview, 1),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'nothing_to_publish' })
  })

  it('passes through already_current from the preview', async () => {
    const db = makeFakeDb(revertSeed())
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      { version: 2, publishedVersion: 2, diffHash: 'x', acknowledgeHighRisk: true, confirmSellableCount: null },
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'already_current' })
  })

  it('passes through version_not_found from the preview', async () => {
    const db = makeFakeDb(revertSeed())
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      { version: 99, publishedVersion: 2, diffHash: 'x', acknowledgeHighRisk: true, confirmSellableCount: null },
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'version_not_found' })
  })

  it('maps rpc errors', async () => {
    const cases: Array<{ message: string; expected: string }> = [
      { message: 'already_current', expected: 'already_current' },
      { message: 'version_not_found', expected: 'version_not_found' },
      { message: 'conflict:stale', expected: 'stale' },
    ]
    for (const c of cases) {
      const db = makeFakeDb({
        ...revertSeed(),
        rpc: () => ({ data: null, error: { message: c.message } }),
      })
      const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
      if ('error' in preview) {
        throw new Error('unexpected error')
      }
      const result = await revertPublished(
        asDb(db),
        CLIENT_ID,
        validRevertReq(preview, 1),
        'pm@x',
        TODAY,
      )
      expect(result).toEqual({ ok: false, error: c.expected })
    }
  })

  it('maps an unknown rpc error to publish_failed and logs', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      ...revertSeed(),
      rpc: () => ({ data: null, error: { message: 'kaboom' } }),
    })
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      validRevertReq(preview, 1),
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'publish_failed' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// listPublishedVersions
// ---------------------------------------------------------------------------

describe('listPublishedVersions', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns rows newest first with isCurrent only on the highest version', async () => {
    const db = makeFakeDb({
      published: [
        publishedRow(1, [tourRow()], [departureRow()], {
          summary: { changeCount: 3, highRiskCount: 1 },
          source_version: null,
        }),
        publishedRow(2, [tourRow()], [departureRow()], {
          summary: { changeCount: 5, highRiskCount: 2 },
          source_version: 1,
        }),
      ],
    })
    const versions = await listPublishedVersions(asDb(db), CLIENT_ID)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(versions[0].isCurrent).toBe(true)
    expect(versions[1].isCurrent).toBe(false)
    expect(versions[0].changeCount).toBe(5)
    expect(versions[0].highRiskCount).toBe(2)
    expect(versions[0].sourceVersion).toBe(1)
    expect(versions[1].sourceVersion).toBeNull()
  })

  it('defaults missing summary counts to 0', async () => {
    const db = makeFakeDb({
      published: [publishedRow(1, [tourRow()], [departureRow()], { summary: {} })],
    })
    const versions = await listPublishedVersions(asDb(db), CLIENT_ID)
    expect(versions[0].changeCount).toBe(0)
    expect(versions[0].highRiskCount).toBe(0)
  })

  it('never selects the snapshot column', async () => {
    const db = makeFakeDb({
      published: [publishedRow(1, [tourRow()], [departureRow()])],
    })
    await listPublishedVersions(asDb(db), CLIENT_ID)
    const publishedSelects = db.selects.filter((s) => s.table === 'tour_catalog_published')
    expect(publishedSelects.length).toBeGreaterThan(0)
    for (const s of publishedSelects) {
      expect(s.cols).not.toContain('snapshot')
    }
  })
})

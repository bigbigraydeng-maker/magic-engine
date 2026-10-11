import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildRevertPreview,
  listPublishedVersions,
  PublishedUnreadableError,
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
  tourRow,
  validRevertReq,
  type FakeSeed,
} from './store-publish.fixtures'

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

  it('keeps a re-created day cancelled, brings a deleted departure back closed, drops a later addition', async () => {
    const db = makeFakeDb({
      state: stateRow(5, 2),
      tours: [tourRow()],
      departures: [],
      published: [
        publishedRow(1, [tourRow()], [
          departureRow({ id: 'june-old', depart_on: '2027-06-01', status: 'open' }),
          departureRow({ id: 'july', depart_on: '2027-07-01', status: 'open' }),
        ]),
        publishedRow(2, [tourRow()], [
          departureRow({ id: 'june-new', depart_on: '2027-06-01', status: 'cancelled' }),
          departureRow({ id: 'august', depart_on: '2027-08-01', status: 'open' }),
        ]),
      ],
    })
    const preview = await buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)
    if ('error' in preview) {
      throw new Error('unexpected error')
    }
    expect(preview.keptStatuses).toEqual([
      { tourName: 'Golden China', departOn: '2027-06-01', currentStatus: '已取消', oldStatus: '可订' },
      { tourName: 'Golden China', departOn: '2027-07-01', currentStatus: '已关闭（现在对外已没有这个班期）', oldStatus: '可订' },
    ])
    // Nothing comes back bookable: the tour goes from sellable (August) to not sellable.
    expect(preview.sellable.after).toBe(0)
    const added = preview.changes.filter((c) => c.kind === 'departure_added')
    expect(added.map((c) => c.after)).toEqual(['2027-06-01（已取消）', '2027-07-01（已关闭）'])
    const removed = preview.changes.filter((c) => c.kind === 'departure_removed')
    expect(removed.map((c) => c.departOn)).toEqual(['2027-06-01', '2027-08-01'])
  })

  it('throws when the current published version cannot be read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      state: stateRow(3, 2),
      published: [
        publishedRow(1, [tourRow()], [departureRow()]),
        publishedRow(2, [tourRow()], [departureRow()], {
          snapshot: { schema_version: 99, tours: [], departures: [] },
        }),
      ],
    })
    await expect(buildRevertPreview(asDb(db), CLIENT_ID, 1, TODAY)).rejects.toBeInstanceOf(PublishedUnreadableError)
    spy.mockRestore()
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

  it('refuses to revert (publish_failed, no rpc) when the current published version cannot be read', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = makeFakeDb({
      state: stateRow(3, 2),
      published: [
        publishedRow(1, [tourRow()], [departureRow()]),
        publishedRow(2, [tourRow()], [departureRow()], {
          snapshot: { schema_version: 99, tours: [], departures: [] },
        }),
      ],
    })
    const result = await revertPublished(
      asDb(db),
      CLIENT_ID,
      { version: 1, publishedVersion: 2, diffHash: 'x', acknowledgeHighRisk: true, confirmSellableCount: 0 },
      'pm@x',
      TODAY,
    )
    expect(result).toEqual({ ok: false, error: 'publish_failed' })
    expect(db.rpc).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
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

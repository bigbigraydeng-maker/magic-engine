import { describe, expect, it } from 'vitest'
import {
  PM_EMAILS,
  measuredSecondsFromChecklist,
  proposeRegistryEntries,
  formatRowsTable,
} from './backfill-music-vocals.mjs'
import { parseMusicVocalRegistry } from '../music-vocal-gate.mjs'

const PM = PM_EMAILS[0]

function checklist(seconds) {
  return {
    quality_checklist_auto: [
      { key: 'other', detail: 'irrelevant' },
      { key: 'resolution_aspect_ratio_correct', detail: `Measured 1920×1080, ${seconds}s` },
    ],
  }
}

function order(over = {}) {
  return {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    status: 'published',
    brief: { remotion: { props: { musicFile: 'bgm/track.mp3', musicStartSec: 0 } } },
    output: checklist(15.019),
    review_ref: { approved_by: PM, approved_at: '2026-10-16T00:00:00.000Z' },
    ...over,
  }
}

const locate = () => '/abs/track.mp3'
const sha = async () => 'a'.repeat(64)

describe('measuredSecondsFromChecklist', () => {
  it('parses seconds from the resolution item', () => {
    expect(measuredSecondsFromChecklist(checklist(15.019))).toBe(15.019)
  })
  it('returns null when item missing', () => {
    expect(measuredSecondsFromChecklist({ quality_checklist_auto: [] })).toBeNull()
  })
  it('returns null when detail does not match', () => {
    expect(measuredSecondsFromChecklist({
      quality_checklist_auto: [{ key: 'resolution_aspect_ratio_correct', detail: 'nope' }],
    })).toBeNull()
  })
  it('returns null when output is undefined', () => {
    expect(measuredSecondsFromChecklist(undefined)).toBeNull()
  })
})

describe('proposeRegistryEntries approvers', () => {
  for (const bad of ['admin', 'unknown', 'someone@example.com']) {
    it(`never yields entries for approver ${bad}`, async () => {
      const o = order({ review_ref: { approved_by: bad, approved_at: '2026-10-16T00:00:00.000Z' } })
      const res = await proposeRegistryEntries({
        orders: [o], existingRegistry: [], locateFileFn: locate, shaFn: sha,
      })
      expect(res.entries).toHaveLength(0)
      expect(res.skipped).toHaveLength(1)
    })
  }
})

describe('proposeRegistryEntries skips', () => {
  it('skips unpublished orders', async () => {
    const res = await proposeRegistryEntries({
      orders: [order({ status: 'draft' })], existingRegistry: [], locateFileFn: locate, shaFn: sha,
    })
    expect(res.entries).toHaveLength(0)
    expect(res.skipped[0].reason).toBe('not published')
  })

  it('skips orders with no measured duration', async () => {
    const res = await proposeRegistryEntries({
      orders: [order({ output: { quality_checklist_auto: [] } })],
      existingRegistry: [], locateFileFn: locate, shaFn: sha,
    })
    expect(res.entries).toHaveLength(0)
    expect(res.skipped[0].reason).toBe('no measured duration')
  })

  it('skips when music file not found', async () => {
    const res = await proposeRegistryEntries({
      orders: [order()], existingRegistry: [], locateFileFn: () => null, shaFn: sha,
    })
    expect(res.entries).toHaveLength(0)
    expect(res.skipped[0].reason).toBe('music file not found')
  })
})

describe('proposeRegistryEntries grouping', () => {
  it('groups by sha and uses window maximum with ceil(end)+1', async () => {
    const o1 = order({ id: 'aaaaaaaa-0000-0000-0000-000000000000' })
    const o2 = order({
      id: 'bbbbbbbb-0000-0000-0000-000000000000',
      brief: { remotion: { props: { musicFile: 'bgm/track.mp3', musicStartSec: 20 } } },
      output: checklist(14),
    })
    const res = await proposeRegistryEntries({
      orders: [o1, o2], existingRegistry: [], locateFileFn: locate, shaFn: sha,
    })
    expect(res.entries).toHaveLength(1)
    // max(0+15.019, 20+14) = 34 -> ceil(34)+1 = 35
    expect(res.entries[0].cleanUntilSec).toBe(35)
  })

  it('computes cleanUntilSec = ceil(end)+1 for a single order', async () => {
    const res = await proposeRegistryEntries({
      orders: [order()], existingRegistry: [], locateFileFn: locate, shaFn: sha,
    })
    // 0 + 15.019 = 15.019 -> ceil = 16 -> +1 = 17
    expect(res.entries[0].cleanUntilSec).toBe(17)
  })

  it('signedBy uses the LATEST-approved order id', async () => {
    const older = order({
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      review_ref: { approved_by: PM, approved_at: '2026-01-01T00:00:00.000Z' },
    })
    const newer = order({
      id: 'bbbbbbbb-0000-0000-0000-000000000000',
      review_ref: { approved_by: PM, approved_at: '2026-10-16T00:00:00.000Z' },
    })
    const res = await proposeRegistryEntries({
      orders: [older, newer], existingRegistry: [], locateFileFn: locate, shaFn: sha,
    })
    expect(res.entries[0].signedBy).toBe('PM审片@bbbbbbbb')
    expect(res.entries[0].signedAt).toBe('2026-10-16T00:00:00.000Z')
  })
})

describe('proposeRegistryEntries existing registry', () => {
  const presentEntry = {
    sha256: 'a'.repeat(64),
    name: 'bgm/track.mp3',
    verdict: 'present',
    signedBy: 'human:pm',
    signedAt: '2026-01-01T00:00:00.000Z',
    evidence: 'x',
  }
  const noneEntry = {
    sha256: 'a'.repeat(64),
    name: 'bgm/track.mp3',
    verdict: 'none',
    cleanUntilSec: 100,
    signedBy: 'human:pm',
    signedAt: '2026-01-01T00:00:00.000Z',
    evidence: 'x',
  }

  it('produces a conflict and no entry when already registered present', async () => {
    const res = await proposeRegistryEntries({
      orders: [order()], existingRegistry: [presentEntry], locateFileFn: locate, shaFn: sha,
    })
    expect(res.entries).toHaveLength(0)
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0].sha256).toBe('a'.repeat(64))
    expect(res.rows[0].result).toBe('CONFLICT: vocal track in approved video')
  })

  it('skips when already registered with verdict none', async () => {
    const res = await proposeRegistryEntries({
      orders: [order()], existingRegistry: [noneEntry], locateFileFn: locate, shaFn: sha,
    })
    expect(res.entries).toHaveLength(0)
    expect(res.conflicts).toHaveLength(0)
    expect(res.rows[0].result).toBe('already registered')
  })
})

describe('proposeRegistryEntries validation', () => {
  it('output entries pass parseMusicVocalRegistry with existing registry', async () => {
    const res = await proposeRegistryEntries({
      orders: [order()], existingRegistry: [], locateFileFn: locate, shaFn: sha,
    })
    expect(() => parseMusicVocalRegistry([...[], ...res.entries])).not.toThrow()
  })
})

describe('formatRowsTable', () => {
  it('has one line per row plus header and separator', () => {
    const rows = [
      { musicFile: 'a.mp3', sha8: 'aaaaaaaa', orderIds8: 'x', windowEndSec: 15, cleanUntilSec: 17, result: 'proposed' },
      { musicFile: 'b.mp3', sha8: 'bbbbbbbb', orderIds8: 'y', windowEndSec: null, cleanUntilSec: null, result: 'already registered' },
    ]
    const table = formatRowsTable(rows)
    const lines = table.split('\n')
    expect(lines).toHaveLength(rows.length + 2)
  })
})

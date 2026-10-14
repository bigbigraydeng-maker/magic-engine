import { describe, expect, it } from 'vitest'
import { orderContactIdsByLatestTouch, scanLatestTouchContactIds, type TouchRowLite } from '../contact-touch-order'

const C = (id: string, firstSeenAt: string | null = null) => ({ id, firstSeenAt })

/** 假触点流：已按 occurred_at 倒序，按 pageSize 切批，并记下被读了几批。 */
function stream(all: TouchRowLite[], pageSize: number) {
  const reads: number[] = []
  return {
    reads,
    fetchTouchPage: async (i: number) => {
      reads.push(i)
      return all.slice(i * pageSize, (i + 1) * pageSize)
    },
  }
}

const T = (contact_id: string, occurred_at: string): TouchRowLite => ({ contact_id, occurred_at })

describe('orderContactIdsByLatestTouch', () => {
  it('an old guest with a new message today comes before a newer guest with no activity', async () => {
    const contacts = [C('old', '2026-01-01T00:00:00Z'), C('newer', '2026-10-01T00:00:00Z')]
    const s = stream([T('old', '2026-10-14T01:00:00Z'), T('newer', '2026-10-02T00:00:00Z')], 10)
    const ids = await orderContactIdsByLatestTouch({ contacts, need: 10, ...s, pageSize: 10, maxPages: 5 })
    expect(ids).toEqual(['old', 'newer'])
  })

  it('uses the latest touch per person (a person who appears twice counts once, at the first = latest sight)', async () => {
    const contacts = [C('a'), C('b')]
    const s = stream([T('b', '2026-10-14T00:00:00Z'), T('a', '2026-10-13T00:00:00Z'), T('b', '2026-01-01T00:00:00Z')], 10)
    expect(await orderContactIdsByLatestTouch({ contacts, need: 10, ...s, pageSize: 10, maxPages: 5 })).toEqual(['b', 'a'])
  })

  it('people without any touch follow, newest first_seen first', async () => {
    const contacts = [C('x', '2026-01-01T00:00:00Z'), C('y', '2026-09-01T00:00:00Z'), C('z', '2026-05-01T00:00:00Z')]
    const s = stream([T('z', '2026-10-01T00:00:00Z')], 10)
    expect(await orderContactIdsByLatestTouch({ contacts, need: 10, ...s, pageSize: 10, maxPages: 5 })).toEqual(['z', 'y', 'x'])
  })

  it('ignores touches of people outside the filtered set', async () => {
    const contacts = [C('a')]
    const s = stream([T('outsider', '2026-10-14T00:00:00Z'), T('a', '2026-10-01T00:00:00Z')], 10)
    expect(await orderContactIdsByLatestTouch({ contacts, need: 10, ...s, pageSize: 10, maxPages: 5 })).toEqual(['a'])
  })

  it('stops reading as soon as enough people for the requested page are found', async () => {
    const contacts = [C('a'), C('b'), C('c'), C('d')]
    const all = [T('a', '2026-10-14T05:00:00Z'), T('b', '2026-10-14T04:00:00Z'), T('c', '2026-10-14T03:00:00Z'), T('d', '2026-10-14T02:00:00Z')]
    const s = stream(all, 2)
    const ids = await orderContactIdsByLatestTouch({ contacts, need: 2, ...s, pageSize: 2, maxPages: 5 })
    expect(ids.slice(0, 2)).toEqual(['a', 'b'])
    expect(s.reads).toEqual([0])
  })

  it('never reads more than maxPages batches; the rest fall back to first_seen order', async () => {
    const contacts = [C('a', '2026-01-01T00:00:00Z'), C('b', '2026-02-01T00:00:00Z'), C('c', '2026-03-01T00:00:00Z')]
    const all = [T('a', '2026-10-14T05:00:00Z'), T('x1', '2026-10-14T04:00:00Z'), T('x2', '2026-10-14T03:00:00Z'), T('b', '2026-10-14T02:00:00Z')]
    const s = stream(all, 1)
    const ids = await orderContactIdsByLatestTouch({ contacts, need: 3, ...s, pageSize: 1, maxPages: 2 })
    expect(s.reads.length).toBe(2)
    expect(ids[0]).toBe('a')
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('scanLatestTouchContactIds (no-filter fast path)', () => {
  it('returns the first `need` distinct people, newest first, and stops reading', async () => {
    const all = [T('a', '5'), T('a', '4'), T('b', '3'), T('c', '2'), T('d', '1')]
    const s = stream(all, 2)
    const ids = await scanLatestTouchContactIds({ need: 2, ...s, pageSize: 2, maxPages: 5 })
    expect(ids).toEqual(['a', 'b'])
    expect(s.reads).toEqual([0, 1])
  })

  it('returns null when there are not enough distinct people (caller falls back to the full path)', async () => {
    const s = stream([T('a', '2'), T('a', '1')], 10)
    expect(await scanLatestTouchContactIds({ need: 2, ...s, pageSize: 10, maxPages: 5 })).toBeNull()
  })

  it('returns null at the page limit instead of a short list', async () => {
    const all = [T('a', '4'), T('a', '3'), T('a', '2'), T('a', '1')]
    const s = stream(all, 1)
    expect(await scanLatestTouchContactIds({ need: 2, ...s, pageSize: 1, maxPages: 2 })).toBeNull()
  })
})

/**
 * The stranded-action audit and its handoff — Issue #859, Codex P1 on PR #862.
 *
 * Counting unattributable actions in a cron summary is not reporting them.
 * CLAUDE.md §3: a finding the system cannot fix itself has to reach a human
 * through the same pipeline as everything else, carrying what / how / href.
 */

import { describe, it, expect, vi } from 'vitest'
import { auditUnattributableActions } from '../unattributable-audit'

interface Row {
  id: string
  client_id: string
  flywheel: string
  expected_metric: string
  action_type: string | null
  payload: Record<string, unknown> | null
  executed_at: string | null
}

/**
 * Models PostgREST's paging, including the part that makes this worth testing:
 * a request without `.range()` is capped at PAGE_SIZE rows and reports no
 * error. A fake that always returns everything would make the pagination fix
 * invisible.
 */
const PAGE_SIZE = 1000

function fakeSupabase(rows: Row[] | null, error: { message: string } | null = null) {
  const inSpy = vi.fn()
  const rangeSpy = vi.fn()
  const orderSpy = vi.fn()

  function makeBuilder() {
    let from: number | null = null
    let to: number | null = null
    const orders: string[] = []

    const builder: Record<string, unknown> = {
      select: () => builder,
      not: () => builder,
      order: (col: string) => {
        orders.push(col)
        orderSpy(col)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        inSpy(col, vals)
        return builder
      },
      range: (f: number, t: number) => {
        rangeSpy(f, t)
        from = f
        to = t
        return builder
      },
      then: (res: (v: { data: Row[] | null; error: unknown }) => unknown) => {
        if (error) return Promise.resolve({ data: null, error }).then(res)
        const all = rows ?? []
        const slice =
          from === null
            ? all.slice(0, PAGE_SIZE) // no .range() → silently truncated
            : all.slice(from, (to ?? from) + 1)
        return Promise.resolve({ data: slice, error: null, orders }).then(res)
      },
    }
    return builder
  }

  return {
    client: { from: () => makeBuilder() } as never,
    inSpy,
    rangeSpy,
    orderSpy,
  }
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'a1',
    client_id: 'c1',
    flywheel: 'geo',
    expected_metric: 'seo.gsc.clicks',
    action_type: 'geo.deploy_directive',
    payload: null,
    executed_at: '2026-06-01T00:00:00.000Z',
    ...over,
  }
}

describe('auditUnattributableActions', () => {
  it('finds an action whose metric owner cannot load its flywheel', async () => {
    const { client } = fakeSupabase([row()])

    const found = await auditUnattributableActions(client)

    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      action_id: 'a1',
      client_id: 'c1',
      flywheel: 'geo',
      expected_metric: 'seo.gsc.clicks',
    })
  })

  it('ignores actions the flywheel_metrics evaluator owns', async () => {
    const { client } = fakeSupabase([
      row({ id: 'a2', expected_metric: 'geo.query.mention_rate' }),
      row({ id: 'a3', flywheel: 'ads', expected_metric: 'ads.account.roas' }),
    ])

    expect(await auditUnattributableActions(client)).toEqual([])
  })

  it('ignores a GSC metric on a flywheel the bridge does load', async () => {
    const { client } = fakeSupabase([row({ flywheel: 'seo' })])

    expect(await auditUnattributableActions(client)).toEqual([])
  })

  it('scopes to the given clients when asked', async () => {
    const { client, inSpy } = fakeSupabase([])

    await auditUnattributableActions(client, ['c1', 'c2'])

    expect(inSpy).toHaveBeenCalledWith('client_id', ['c1', 'c2'])
  })

  it('does not filter by client when no ids are given', async () => {
    const { client, inSpy } = fakeSupabase([])

    await auditUnattributableActions(client)

    expect(inSpy).not.toHaveBeenCalled()
  })

  it('throws on a query failure instead of reporting "none found"', async () => {
    // "nothing is stranded" and "we could not check" must not look the same.
    const { client } = fakeSupabase(null, { message: 'connection reset' })

    await expect(auditUnattributableActions(client)).rejects.toThrow(/connection reset/)
  })

  it('uses the same routing rule as the writers, not a copy of it', async () => {
    // Feed it one of each state; only the unattributable one comes back.
    const { client } = fakeSupabase([
      row({ id: 'own', flywheel: 'geo', expected_metric: 'geo.query.mention_rate' }),
      row({ id: 'defer', flywheel: 'seo', expected_metric: 'seo.gsc.clicks' }),
      row({ id: 'stranded', flywheel: 'social', expected_metric: 'seo.gsc.impressions' }),
    ])

    const found = await auditUnattributableActions(client)

    expect(found.map(f => f.action_id)).toEqual(['stranded'])
  })
})

// ── The reason has to survive into the handoff ──────────────────────────────
//
// Three causes, three fixes. A note that names the wrong one sends the reader
// looking in the wrong place, which is the same as not reporting it.

describe('unattributable reasons', () => {
  it('labels a metric on a flywheel the owner cannot load as cross_flywheel', async () => {
    const { client } = fakeSupabase([row({ flywheel: 'geo', expected_metric: 'seo.gsc.clicks' })])

    const [found] = await auditUnattributableActions(client)

    expect(found.reason).toBe('cross_flywheel')
    expect(found.suggested_metric).toBeNull() // no counterpart makes sense here
  })

  it('labels a page key on a domain-scope action as scope_mismatch, with the swap', async () => {
    const { client } = fakeSupabase([
      row({
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        payload: null,
        expected_metric: 'seo.gsc.page_clicks',
      }),
    ])

    const [found] = await auditUnattributableActions(client)

    expect(found.reason).toBe('scope_mismatch')
    expect(found.suggested_metric).toBe('seo.gsc.clicks')
  })

  it('labels a domain key on a page-scope action as scope_mismatch, with the swap', async () => {
    const { client } = fakeSupabase([
      row({
        flywheel: 'seo',
        action_type: 'cms_update_existing',
        payload: { status: 'live', page_url: 'https://example.com/g' },
        expected_metric: 'seo.gsc.impressions',
      }),
    ])

    const [found] = await auditUnattributableActions(client)

    expect(found.reason).toBe('scope_mismatch')
    expect(found.suggested_metric).toBe('seo.gsc.page_impressions')
  })

  it('labels a not-yet-live page upgrade as scope_skip', async () => {
    const { client } = fakeSupabase([
      row({
        flywheel: 'seo',
        action_type: 'cms_update_existing',
        payload: { status: 'pr_open' },
        expected_metric: 'seo.gsc.page_clicks',
      }),
    ])

    const [found] = await auditUnattributableActions(client)

    expect(found.reason).toBe('scope_skip')
    // Nothing to swap to — the action simply is not live yet.
    expect(found.suggested_metric).toBeNull()
  })

  it('never suggests a metric the owner still would not produce', async () => {
    const { client } = fakeSupabase([
      row({ flywheel: 'seo', action_type: 'seo.publish_blog', payload: null, expected_metric: 'seo.gsc.page_avg_position' }),
      row({ id: 'a2', flywheel: 'seo', action_type: 'cms_update_existing', payload: { status: 'live', page_url: 'https://e.com/x' }, expected_metric: 'seo.gsc.avg_position' }),
    ])

    const found = await auditUnattributableActions(client)

    expect(found[0].suggested_metric).toBe('seo.gsc.avg_position')
    expect(found[1].suggested_metric).toBe('seo.gsc.page_avg_position')
  })
})

// ── The scan must reach every action, not just the first page ───────────────
//
// PostgREST caps one response at 1000 rows and reports no error. Ordered
// newest-first, an unpaginated read drops the OLDEST actions — and a stranded
// action only gets older, so exactly the ones most overdue would be the ones
// that never reach the todo.

describe('pagination', () => {
  function manyActions(n: number): Row[] {
    return Array.from({ length: n }, (_, i) =>
      row({
        id: `a${i}`,
        // Every one of them is stranded: geo flywheel carrying a GSC metric.
        flywheel: 'geo',
        expected_metric: 'seo.gsc.clicks',
      }),
    )
  }

  it('finds stranded actions beyond the first page', async () => {
    const { client } = fakeSupabase(manyActions(2500))

    const found = await auditUnattributableActions(client)

    expect(found).toHaveLength(2500)
  })

  it('reaches the oldest action, which is last under newest-first ordering', async () => {
    const { client } = fakeSupabase(manyActions(1500))

    const found = await auditUnattributableActions(client)

    // a1499 sits well past the 1000-row cap — the exact row an unpaginated
    // read would lose, and the one that has been stranded longest.
    expect(found.map(f => f.action_id)).toContain('a1499')
  })

  it('requests successive ranges rather than one unbounded read', async () => {
    const { client, rangeSpy } = fakeSupabase(manyActions(2500))

    await auditUnattributableActions(client)

    expect(rangeSpy.mock.calls[0]).toEqual([0, 999])
    expect(rangeSpy.mock.calls[1]).toEqual([1000, 1999])
    expect(rangeSpy.mock.calls[2]).toEqual([2000, 2999])
  })

  it('stops as soon as a page comes back short', async () => {
    const { client, rangeSpy } = fakeSupabase(manyActions(10))

    await auditUnattributableActions(client)

    expect(rangeSpy).toHaveBeenCalledTimes(1)
  })

  it('orders by a unique tiebreak so page boundaries cannot drop or repeat rows', async () => {
    // `executed_at` is not unique, and PostgREST gives no ordering guarantee
    // between equal keys — so the row sitting on a page boundary can come back
    // twice or not at all. Asserted structurally: this fake slices a stable
    // array, so it cannot reproduce an unstable sort; what it CAN pin is that
    // the query asks for a unique secondary key at all.
    const { client, orderSpy } = fakeSupabase(manyActions(1200))

    const found = await auditUnattributableActions(client)

    expect(orderSpy).toHaveBeenCalledWith('executed_at')
    expect(orderSpy).toHaveBeenCalledWith('id')
    expect(new Set(found.map(f => f.action_id)).size).toBe(found.length)
  })

  it('still surfaces a query failure instead of a partial result', async () => {
    const { client } = fakeSupabase(null, { message: 'statement timeout' })

    await expect(auditUnattributableActions(client)).rejects.toThrow(/statement timeout/)
  })
})

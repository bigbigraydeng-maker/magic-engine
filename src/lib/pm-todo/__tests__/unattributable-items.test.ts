/**
 * The stranded-action todo must name the right cause — Issue #859, Codex P2.
 *
 * Three causes, three different fixes. The first version asserted "wrong
 * flywheel" for all of them, which is false for a scope mismatch inside the SEO
 * flywheel and sends the reader looking in the wrong place. CLAUDE.md §3 is
 * explicit that `how` has to be concrete enough to act on without asking; a
 * confidently wrong `how` is worse than none.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  OrphanedOutcome,
  UnattributableAction,
} from '@/lib/flywheel/attribution/unattributable-audit'

const stranded: UnattributableAction[] = []

const orphans: OrphanedOutcome[] = []

vi.mock('@/lib/flywheel/attribution/unattributable-audit', () => ({
  auditUnattributableActions: vi.fn(async () => stranded),
  auditOrphanedOutcomes: vi.fn(async () => orphans),
}))

// Everything else `loadManualItems` reaches is out of scope here; only the
// unattributable lane is exercised, through the exported loader.
import { loadManualItems } from '../manual-items'

function action(over: Partial<UnattributableAction> = {}): UnattributableAction {
  return {
    action_id: 'a1',
    client_id: 'c1',
    flywheel: 'geo',
    expected_metric: 'seo.gsc.clicks',
    action_type: 'geo.deploy_directive',
    executed_at: '2026-06-01T00:00:00.000Z',
    reason: 'cross_flywheel',
    suggested_metric: null,
    ...over,
  }
}

/**
 * Minimal Supabase stub: one active client, everything else empty.
 *
 * `rawStub` keeps its real shape so the failure variants below can delegate to
 * it for the tables they don't override; `stubSupabase` is the `as never` cast
 * the loader's parameter needs.
 */
/**
 * The clients query is paginated now, so the stub has to answer the real chain:
 * `.select().eq().order().range()`. A stub that still ends at `.eq()` would make
 * the pagination fix untestable — and would have passed while production
 * truncated at 1000 rows.
 */
function clientsQuery(result: { data: unknown; error: unknown }) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    range: async () => result,
  }
  return q as never
}

function rawStub() {
  const builder: Record<string, unknown> = {}
  const chain = new Proxy(builder, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res)
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return async () => ({ data: null, error: null })
      }
      return () => chain
    },
  })
  return {
    from: (table: string) => {
      if (table === 'clients') {
        return clientsQuery({
          data: [{ id: 'c1', name: 'CTS Tours', domain: 'ctstours.co.nz' }],
          error: null,
        })
      }
      return chain
    },
  }
}

function stubSupabase() {
  return rawStub() as never
}

async function itemsFor(rows: UnattributableAction[]) {
  stranded.length = 0
  orphans.length = 0
  stranded.push(...rows)
  const all = await loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z'))
  return all.filter(i => i.kind === 'action_unattributable')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('unattributable todo wording', () => {
  it('says "wrong flywheel" only for a cross-flywheel action', async () => {
    const [item] = await itemsFor([action({ reason: 'cross_flywheel' })])

    expect(item.what).toContain('战线')
    expect(item.how).toContain('改指标')
    expect(item.client_name).toBe('CTS Tours')
    expect(item.href).toContain('/dashboard/clients/c1/execution')
  })

  it('does NOT blame the flywheel for a scope mismatch, and names the swap', async () => {
    const [item] = await itemsFor([
      action({
        reason: 'scope_mismatch',
        flywheel: 'seo',
        action_type: 'seo.publish_blog',
        expected_metric: 'seo.gsc.page_clicks',
        suggested_metric: 'seo.gsc.clicks',
      }),
    ])

    // The old text asserted the flywheel was misconfigured. It is not.
    expect(item.how).not.toContain('错的战线')
    expect(item.how).toContain('战线没配错')
    // And it says exactly what to change it to.
    expect(item.how).toContain('seo.gsc.page_clicks → seo.gsc.clicks')
  })

  it('says nothing at all about a page upgrade that is simply still in flight', async () => {
    // scope_skip only means "not marked live yet". The next attribution run
    // picks it up the moment it is. Putting that in the 「需要你动手」 lane every
    // day — with a `how` that says it will fix itself — is noise that trains the
    // reader to skim. (Codex P2, round 17.)
    const items = await itemsFor([
      action({
        reason: 'scope_skip',
        flywheel: 'seo',
        action_type: 'cms_update_existing',
        expected_metric: 'seo.gsc.page_clicks',
        executed_at: '2026-08-05T00:00:00.000Z', // 3 days before `now`
      }),
    ])

    expect(items).toEqual([])
  })

  it('does surface a page upgrade that has been waiting too long, as a stall', async () => {
    const [item] = await itemsFor([
      action({
        reason: 'scope_skip',
        flywheel: 'seo',
        action_type: 'cms_update_existing',
        expected_metric: 'seo.gsc.page_clicks',
        executed_at: '2026-06-01T00:00:00.000Z', // 68 days
      }),
    ])

    expect(item.what).toContain('68 天')
    expect(item.how).toContain('卡住')
    // It must no longer read as "nothing to do".
    expect(item.how).not.toContain('自己好')
    // And still must not ask for a metric change — that is not the fix here.
    expect(item.how).not.toContain('改指标')
    expect(item.how).not.toContain('改口径')
  })

  it('splits one client into one item per cause', async () => {
    const items = await itemsFor([
      action({ action_id: 'a1', reason: 'cross_flywheel' }),
      action({ action_id: 'a2', reason: 'scope_mismatch', flywheel: 'seo', suggested_metric: 'seo.gsc.clicks' }),
      action({ action_id: 'a3', reason: 'scope_skip', flywheel: 'seo' }),
    ])

    expect(items).toHaveLength(3)
    expect(new Set(items.map(i => i.how)).size).toBe(3) // three distinct instructions
  })

  it('produces nothing when no action is stranded', async () => {
    expect(await itemsFor([])).toEqual([])
  })
})

// ── The check failing is itself a finding ──────────────────────────────────

describe('when the audit itself fails', () => {
  it('emits an infra todo instead of swallowing it', async () => {
    // The audit throws deliberately on a query failure so that "nothing is
    // stranded" and "we could not check" never look the same. Catching that
    // into a console.warn undoes the distinction one layer up: the todo list
    // returns cleanly with no attribution item, and the whole detection
    // pipeline disappears into a developer log.
    const { auditUnattributableActions } = await import(
      '@/lib/flywheel/attribution/unattributable-audit'
    )
    vi.mocked(auditUnattributableActions).mockRejectedValueOnce(
      new Error('column "payload" does not exist'),
    )

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = await loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z'))
    warn.mockRestore()

    const item = all.find(i => i.kind === 'attribution_audit_failed')
    expect(item).toBeDefined()
    // The message has to carry the actual cause, not just "something failed".
    expect(item!.what).toContain('column "payload" does not exist')
    // And it must not read as "all clear".
    expect(item!.what).toContain('不是「今天没问题」')
    expect(item!.how).toContain('查不了')
    expect(item!.href).toBeTruthy()
  })

  it('does not emit the failure item on a clean run', async () => {
    const all = await itemsFor([])
    expect(all.find(i => i.kind === 'attribution_audit_failed')).toBeUndefined()
  })

  it('a failed CLIENT LIST query does not produce a clean-looking list', async () => {
    // One layer above the audit, and the same shape: the clients query's
    // `error` was destructured away, so a failed query arrived as zero active
    // clients and returned early — before the audit and before its own failure
    // item. The list came back tidy with the entire per-client half missing.
    const failingSupabase = {
      from: (table: string) => {
        if (table === 'clients') {
          return clientsQuery({
            data: null,
            error: { message: 'permission denied for table clients' },
          })
        }
        return rawStub().from(table)
      },
    } as never

    const all = await loadManualItems(failingSupabase, new Date('2026-08-08T00:00:00Z'))

    const item = all.find(i => i.kind === 'client_list_unreadable')
    expect(item).toBeDefined()
    expect(item!.what).toContain('permission denied for table clients')
    // Must read as "only half checked", not as "nothing wrong today".
    expect(item!.what).toContain('只查了一半')
    // And it must not silently claim the per-client checks ran.
    expect(all.find(i => i.kind === 'action_unattributable')).toBeUndefined()
  })

  it('reads the WHOLE client list, not just the first page', async () => {
    // PostgREST caps a response at 1000 rows without saying so. Truncating here
    // is not just "a few clients missing from the list" — `ids` is the input to
    // every per-client check including both attribution audits, and their own
    // internal pagination cannot recover a client the caller never mentioned.
    // (Codex P2, round 23.)
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `c${String(i).padStart(4, '0')}`, name: `Client ${i}`, domain: null,
    }))
    const page2 = [{ id: 'c1000', name: 'Last Client', domain: null }]
    const seen: Array<[number, number]> = []
    const pagedSupabase = {
      from: (table: string) => {
        if (table === 'clients') {
          const q: Record<string, unknown> = {}
          q.select = () => q
          q.eq = () => q
          q.order = () => q
          q.range = async (from: number, to: number) => {
            seen.push([from, to])
            return { data: from === 0 ? page1 : page2, error: null }
          }
          return q
        }
        return rawStub().from(table)
      },
    } as never

    stranded.length = 0
    orphans.length = 0
    stranded.push(action({ client_id: 'c1000', reason: 'cross_flywheel' }))

    const all = await loadManualItems(pagedSupabase, new Date('2026-08-08T00:00:00Z'))

    expect(seen.length).toBeGreaterThan(1) // it asked for a second page
    // And the client that only exists on page 2 still gets its finding.
    const item = all.find(i => i.kind === 'action_unattributable')
    expect(item?.client_name).toBe('Last Client')
  })

  it('a genuinely empty client list is NOT reported as a failure', async () => {
    // The distinction is the whole point: zero clients is a fact, an unreadable
    // list is an unknown. Collapsing them back together would just move the bug.
    const emptySupabase = {
      from: (table: string) => {
        if (table === 'clients') {
          return clientsQuery({ data: [], error: null })
        }
        return rawStub().from(table)
      },
    } as never

    const all = await loadManualItems(emptySupabase, new Date('2026-08-08T00:00:00Z'))

    expect(all.find(i => i.kind === 'client_list_unreadable')).toBeUndefined()
  })

  it('a failed audit does not take the rest of the todo list down with it', async () => {
    const { auditUnattributableActions } = await import(
      '@/lib/flywheel/attribution/unattributable-audit'
    )
    vi.mocked(auditUnattributableActions).mockRejectedValueOnce(new Error('boom'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z')),
    ).resolves.toBeInstanceOf(Array)
    warn.mockRestore()
  })
})

// ── Frozen rows that only a human can decide about ──────────────────────────

describe('outcome rows nobody can maintain', () => {
  async function orphanItems(rows: OrphanedOutcome[]) {
    stranded.length = 0
    orphans.length = 0
    orphans.push(...rows)
    const all = await loadManualItems(stubSupabase(), new Date('2026-08-08T00:00:00Z'))
    return all.filter(i => i.kind === 'outcome_rows_orphaned')
  }

  it('asks for a decision instead of quietly deleting', async () => {
    const [item] = await orphanItems([
      {
        client_id: 'c1', action_id: 'a1', metric_key: 'seo.gsc.clicks',
        flywheel: 'geo', expected_metric: 'geo.query.mention_rate', rows: 3,
      },
    ])

    expect(item.what).toContain('3 条')
    expect(item.what).toContain('seo.gsc.clicks')
    // The reader has to know the numbers are frozen but still being read.
    expect(item.what).toContain('还在照读')
    // And the ask is a decision, not an action — deleting another evaluator's
    // rows is the defect this PR removed.
    expect(item.how).toContain('删掉')
    expect(item.how).toContain('留着')
    expect(item.client_name).toBe('CTS Tours')
  })

  it('produces nothing when no row is stranded', async () => {
    expect(await orphanItems([])).toEqual([])
  })

  it('sums the rows per client rather than emitting one item each', async () => {
    const items = await orphanItems([
      { client_id: 'c1', action_id: 'a1', metric_key: 'seo.gsc.clicks', flywheel: 'geo', expected_metric: 'geo.query.mention_rate', rows: 2 },
      { client_id: 'c1', action_id: 'a2', metric_key: 'seo.gsc.impressions', flywheel: 'geo', expected_metric: 'geo.query.mention_rate', rows: 3 },
    ])

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('5 条')
  })
})

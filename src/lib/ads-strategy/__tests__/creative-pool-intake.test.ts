/**
 * Draft vitest suite for creative-pool intake.
 *
 * The pure planner is exercised directly. The runner is exercised only up to
 * the point where it would need `loadAdStrategyConfigWithSource` — the two
 * runner cases below finish before the config load is reached, so no module
 * mocking is required.
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { planCreativePoolIntake, runCreativePoolIntake, INTAKE_LOOKBACK_DAYS } from '../creative-pool-intake'
import type { CreativePoolEntry } from '../config'

/**
 * One narrow assertion, isolated in a named helper — same shape as
 * `ads-account-status-items.test.ts` in `src/lib/pm-todo/__tests__/`.
 * The stub only has to carry the handful of chain methods intake actually calls.
 */
function asSupabase(stub: object): SupabaseClient {
  return stub as SupabaseClient
}

/** Minimal stub shaped like the Supabase query chain intake uses. */
interface QueryResult<T> {
  data: T
  error: { message: string } | null
}

interface StubChain<T> {
  select: () => StubChain<T>
  eq: () => StubChain<T>
  gte: () => StubChain<T>
  order: () => StubChain<T>
  limit: () => Promise<QueryResult<T>>
}

interface StubClient {
  from: (table: string) => {
    select: () => StubChain<unknown>
    upsert: () => Promise<{ error: { message: string } | null }>
  }
}

/** Build a stub whose work-order read resolves to `result` and whose upsert is counted. */
function makeStub(result: QueryResult<unknown>): { client: StubClient; upsertCalls: () => number } {
  let upserts = 0
  const chain: StubChain<unknown> = {
    select: () => chain,
    eq: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(result),
  }
  const client: StubClient = {
    from: () => ({
      select: () => chain,
      upsert: () => {
        upserts += 1
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { client, upsertCalls: () => upserts }
}

describe('planCreativePoolIntake', () => {
  it('adds one candidate per published reel when the pool is empty', () => {
    const { toAdd, alreadyInPool } = planCreativePoolIntake(
      [
        { workOrderId: 'wo-1', videoId: '111' },
        { workOrderId: 'wo-2', videoId: '222' },
      ],
      [],
    )
    expect(toAdd).toHaveLength(2)
    expect(alreadyInPool).toBe(0)
    for (const entry of toAdd) {
      expect(entry.kind).toBe('meta_video')
      expect(entry.status).toBe('candidate')
    }
  })

  it('skips a videoId already in the pool as candidate', () => {
    const pool: CreativePoolEntry[] = [{ kind: 'meta_video', ref: '111', status: 'candidate' }]
    const { toAdd, alreadyInPool } = planCreativePoolIntake(
      [{ workOrderId: 'wo-1', videoId: '111' }],
      pool,
    )
    expect(toAdd).toHaveLength(0)
    expect(alreadyInPool).toBe(1)
  })

  it('skips a videoId already in the pool as approved', () => {
    const pool: CreativePoolEntry[] = [{ kind: 'meta_video', ref: '111', status: 'approved' }]
    const { toAdd, alreadyInPool } = planCreativePoolIntake(
      [{ workOrderId: 'wo-1', videoId: '111' }],
      pool,
    )
    expect(toAdd).toHaveLength(0)
    expect(alreadyInPool).toBe(1)
    expect(toAdd.some(entry => entry.ref === '111')).toBe(false)
  })

  it('deduplicates the same videoId appearing twice in published', () => {
    const { toAdd } = planCreativePoolIntake(
      [
        { workOrderId: 'wo-1', videoId: '111' },
        { workOrderId: 'wo-2', videoId: '111' },
      ],
      [],
    )
    expect(toAdd).toHaveLength(1)
    expect(toAdd[0]?.ref).toBe('111')
  })

  it('never re-emits an existing entry and never carries approved_by', () => {
    const pool: CreativePoolEntry[] = [
      { kind: 'meta_video', ref: '111', status: 'approved', approved_by: 'alice' },
    ]
    const { toAdd } = planCreativePoolIntake(
      [
        { workOrderId: 'wo-1', videoId: '111' },
        { workOrderId: 'wo-2', videoId: '222' },
      ],
      pool,
    )
    expect(toAdd).toHaveLength(1)
    expect(toAdd[0]?.ref).toBe('222')
    for (const entry of toAdd) {
      expect(entry.approved_by).toBeUndefined()
    }
  })
})

/**
 * A config loader stub. The real loader ignores the client passed to the runner and
 * reaches for the module-level `supabaseAdmin`, so without injecting this the run
 * would hit the network, block on a failed read, and the assertions below would
 * pass without the planner ever running.
 */
function loaderFor(source: 'row' | 'default' | 'fallback', pool: CreativePoolEntry[] = []) {
  return async (clientId: string) => ({
    config: {
      client_id: clientId,
      enabled: true,
      digest_recipients: [],
      daily_budget_cap_cents: null,
      autonomy_mode: 'observe' as const,
      creative_pool: pool,
      autopilot_enabled: false,
      autopilot_dry_run: true,
    },
    source,
  })
}

const ONE_PUBLISHED = {
  data: [{ id: 'wo-1', published_ref: { video_id: '111' }, created_at: '2026-01-01T00:00:00Z' }],
  error: null,
}

describe('runCreativePoolIntake', () => {
  it('computes the candidate in dry-run and calls no upsert', async () => {
    const { client, upsertCalls } = makeStub(ONE_PUBLISHED)

    const receipt = await runCreativePoolIntake(asSupabase(client), 'client-1', {
      dryRun: true,
      now: new Date('2026-01-15T00:00:00Z'),
      loadConfig: loaderFor('row'),
    })

    expect(receipt.blocked).toBeNull()
    expect(receipt.dryRun).toBe(true)
    expect(receipt.considered).toBe(1)
    expect(receipt.added).toEqual([{ kind: 'meta_video', ref: '111', status: 'candidate' }])
    expect(upsertCalls()).toBe(0)
  })

  it('writes the appended pool when not a dry-run', async () => {
    const { client, upsertCalls } = makeStub(ONE_PUBLISHED)

    const receipt = await runCreativePoolIntake(asSupabase(client), 'client-1', {
      dryRun: false,
      now: new Date('2026-01-15T00:00:00Z'),
      loadConfig: loaderFor('row'),
    })

    expect(receipt.blocked).toBeNull()
    expect(receipt.added).toHaveLength(1)
    expect(upsertCalls()).toBe(1)
  })

  it('blocks and writes nothing when the config read failed (fallback)', async () => {
    const { client, upsertCalls } = makeStub(ONE_PUBLISHED)

    const receipt = await runCreativePoolIntake(asSupabase(client), 'client-1', {
      dryRun: false,
      now: new Date('2026-01-15T00:00:00Z'),
      loadConfig: loaderFor('fallback'),
    })

    expect(receipt.blocked).toBe('facts:ad_strategy_config_read_failed')
    expect(receipt.added).toHaveLength(0)
    expect(upsertCalls()).toBe(0)
  })

  it('blocks rather than creating a config row when the client has none', async () => {
    const { client, upsertCalls } = makeStub(ONE_PUBLISHED)

    const receipt = await runCreativePoolIntake(asSupabase(client), 'client-1', {
      dryRun: false,
      now: new Date('2026-01-15T00:00:00Z'),
      loadConfig: loaderFor('default'),
    })

    // Creating the row would silently enrol the client into the ads engine
    // (`enabled` defaults to true), so intake must refuse instead.
    expect(receipt.blocked).toBe('facts:no_ad_strategy_config_row')
    expect(upsertCalls()).toBe(0)
  })

  it('leaves an already-approved video alone and adds nothing', async () => {
    const approved: CreativePoolEntry[] = [{ kind: 'meta_video', ref: '111', status: 'approved' }]
    const { client, upsertCalls } = makeStub(ONE_PUBLISHED)

    const receipt = await runCreativePoolIntake(asSupabase(client), 'client-1', {
      dryRun: false,
      now: new Date('2026-01-15T00:00:00Z'),
      loadConfig: loaderFor('row', approved),
    })

    expect(receipt.added).toHaveLength(0)
    expect(receipt.alreadyInPool).toBe(1)
    expect(upsertCalls()).toBe(0)
  })

  it('reads a window of INTAKE_LOOKBACK_DAYS days', () => {
    expect(INTAKE_LOOKBACK_DAYS).toBe(60)
  })

  it('blocks on a work-order read error and never calls upsert', async () => {
    const { client, upsertCalls } = makeStub({
      data: null,
      error: { message: 'boom' },
    })
    const receipt = await runCreativePoolIntake(asSupabase(client), 'client-1', {
      dryRun: false,
      now: new Date('2026-01-15T00:00:00Z'),
    })
    expect(receipt.blocked?.startsWith('facts:work_orders_read_failed')).toBe(true)
    expect(receipt.added).toHaveLength(0)
    expect(upsertCalls()).toBe(0)
  })
})

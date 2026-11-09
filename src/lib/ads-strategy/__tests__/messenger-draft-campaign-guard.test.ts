import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkMessengerDraftCampaign,
  MESSENGER_LOOKUP_FAILED_MESSAGE,
  MESSENGER_REACTIVATE_BLOCKED_MESSAGE,
} from '../messenger-draft-campaign-guard'
import { ADS_CREATE_ACTION } from '../draft-and-gate'

// ---------------------------------------------------------------------------
// Table-modelling fake Supabase (NOT call-order based).
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string
  client_id: string
  action_type: string
  payload: Record<string, unknown>
}

interface FakeOpts {
  error?: { message: string }
  throws?: boolean
}

// The only columns the guard is allowed to filter on. Anything else throws,
// so a typo in the guard fails the test loudly. Note that client_id is
// deliberately absent: the guard must not filter on it.
const ALLOWED_COLUMNS = [
  'action_type',
  'payload->draft->>kind',
  'payload->>campaignId',
] as const

type AllowedColumn = (typeof ALLOWED_COLUMNS)[number]

function isAllowedColumn(col: string): col is AllowedColumn {
  return (ALLOWED_COLUMNS as readonly string[]).includes(col)
}

/**
 * Resolve a PostgREST-style column path against a row object.
 * '->>' is normalised to '->', then the path is split on '->' and walked.
 */
function resolveColumn(row: FakeRow, col: string): unknown {
  if (!isAllowedColumn(col)) {
    throw new Error('unexpected column ' + col)
  }

  const path = col.replace(/->>/g, '->').split('->')
  let current: unknown = row

  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

interface FakeFilter {
  col: string
  val: unknown
}

interface FakeBuilder {
  select: (cols: string) => FakeBuilder
  eq: (col: string, val: unknown) => FakeBuilder
  limit: (n: number) => Promise<{ data: FakeRow[]; error: { message: string } | null }>
}

interface FakeSupabase {
  calls: number
  from: (table: string) => FakeBuilder
}

function fakeSupabase(rows: FakeRow[], opts: FakeOpts = {}): FakeSupabase {
  const fake: FakeSupabase = {
    calls: 0,
    from(table: string): FakeBuilder {
      fake.calls += 1

      if (table !== 'flywheel_actions') {
        throw new Error('unexpected table ' + table)
      }

      const filters: FakeFilter[] = []

      const builder: FakeBuilder = {
        select(): FakeBuilder {
          return builder
        },
        eq(col: string, val: unknown): FakeBuilder {
          filters.push({ col, val })
          return builder
        },
        limit(n: number): Promise<{ data: FakeRow[]; error: { message: string } | null }> {
          if (opts.throws) {
            return Promise.reject(new Error('fake supabase throws'))
          }

          const matching = rows.filter((row) =>
            filters.every((f) => resolveColumn(row, f.col) === f.val),
          )

          return Promise.resolve({
            data: matching.slice(0, n),
            error: opts.error ?? null,
          })
        },
      }

      return builder
    },
  }

  return fake
}

// The guard is typed against SupabaseClient; the fake is a structural stand-in.
function asClient(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const CAMP1 = '120210000000000001'
const CAMP2 = '120210000000000002'
const CAMP3 = '120210000000000003'

describe('checkMessengerDraftCampaign', () => {
  const messengerRow: FakeRow = {
    id: 'row-1',
    client_id: 'C1',
    action_type: 'ads.create_ad',
    payload: { draft: { kind: 'messenger_conversation' }, campaignId: CAMP1 },
  }

  it('returns is_messenger_draft for a matching row', async () => {
    const fake = fakeSupabase([messengerRow])
    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP1)).resolves.toBe(
      'is_messenger_draft',
    )
  })

  it('returns not_messenger_draft for a different campaign id', async () => {
    const fake = fakeSupabase([messengerRow])
    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP2)).resolves.toBe(
      'not_messenger_draft',
    )
  })

  it('ignores drafts of other kinds', async () => {
    const videoRow: FakeRow = {
      id: 'row-2',
      client_id: 'C1',
      action_type: 'ads.create_ad',
      payload: { draft: { kind: 'video_thruplay' }, campaignId: CAMP3 },
    }
    const fake = fakeSupabase([videoRow])
    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP3)).resolves.toBe(
      'not_messenger_draft',
    )
  })

  it('does not filter by client: a draft under another client still blocks', async () => {
    const otherClientRow: FakeRow = {
      id: 'row-3',
      client_id: 'C2',
      action_type: 'ads.create_ad',
      payload: { draft: { kind: 'messenger_conversation' }, campaignId: CAMP1 },
    }
    const fake = fakeSupabase([otherClientRow])

    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP1)).resolves.toBe(
      'is_messenger_draft',
    )
  })

  it('returns lookup_failed when the query reports an error', async () => {
    const fake = fakeSupabase([messengerRow], { error: { message: 'boom' } })
    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP1)).resolves.toBe(
      'lookup_failed',
    )
  })

  it('returns lookup_failed when the query throws', async () => {
    const fake = fakeSupabase([messengerRow], { throws: true })
    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP1)).resolves.toBe(
      'lookup_failed',
    )
  })

  it.each([
    '',
    '   ',
    ' 120210000000000001 ',
    'act_120210000000000001',
    '0120210000000000001',
    '12a3',
    '1'.repeat(33),
    '-5',
  ])('returns lookup_failed for malformed id %j without querying', async (badId) => {
    const fake = fakeSupabase([messengerRow])
    await expect(checkMessengerDraftCampaign(asClient(fake), badId)).resolves.toBe(
      'lookup_failed',
    )
    expect(fake.calls).toBe(0)
  })

  it('ignores rows whose action_type is not the draft action', async () => {
    const pauseRow: FakeRow = {
      id: 'row-4',
      client_id: 'C1',
      action_type: 'ads.pause_campaign',
      payload: { draft: { kind: 'messenger_conversation' }, campaignId: CAMP1 },
    }
    const fake = fakeSupabase([pauseRow])
    await expect(checkMessengerDraftCampaign(asClient(fake), CAMP1)).resolves.toBe(
      'not_messenger_draft',
    )
  })

  it('pins the draft action type literal', () => {
    expect(ADS_CREATE_ACTION).toBe('ads.create_ad')
  })

  it('exposes the user-facing messages', () => {
    expect(MESSENGER_REACTIVATE_BLOCKED_MESSAGE.length).toBeGreaterThan(0)
    expect(MESSENGER_LOOKUP_FAILED_MESSAGE.length).toBeGreaterThan(0)
    expect(MESSENGER_REACTIVATE_BLOCKED_MESSAGE).toContain('审批流程')
  })
})

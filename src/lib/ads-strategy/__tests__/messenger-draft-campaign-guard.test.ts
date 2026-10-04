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
// so a typo in the guard fails the test loudly.
const ALLOWED_COLUMNS = [
  'client_id',
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

function fakeSupabase(rows: FakeRow[], opts: FakeOpts = {}): object {
  return {
    from(table: string): FakeBuilder {
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
}

// The guard is typed against SupabaseClient; the fake is a structural stand-in.
function asClient(fake: object): SupabaseClient {
  return fake as SupabaseClient
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkMessengerDraftCampaign', () => {
  const messengerRow: FakeRow = {
    id: 'row-1',
    client_id: 'C1',
    action_type: 'ads.create_ad',
    payload: { draft: { kind: 'messenger_conversation' }, campaignId: 'camp1' },
  }

  it('returns is_messenger_draft for a matching row', async () => {
    const client = asClient(fakeSupabase([messengerRow]))
    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp1')).resolves.toBe(
      'is_messenger_draft',
    )
  })

  it('returns not_messenger_draft for a different campaign id', async () => {
    const client = asClient(fakeSupabase([messengerRow]))
    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp2')).resolves.toBe(
      'not_messenger_draft',
    )
  })

  it('ignores drafts of other kinds', async () => {
    const videoRow: FakeRow = {
      id: 'row-2',
      client_id: 'C1',
      action_type: 'ads.create_ad',
      payload: { draft: { kind: 'video_thruplay' }, campaignId: 'camp3' },
    }
    const client = asClient(fakeSupabase([videoRow]))
    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp3')).resolves.toBe(
      'not_messenger_draft',
    )
  })

  it('scopes the lookup to the requesting client', async () => {
    const otherClientRow: FakeRow = {
      id: 'row-3',
      client_id: 'C2',
      action_type: 'ads.create_ad',
      payload: { draft: { kind: 'messenger_conversation' }, campaignId: 'camp1' },
    }
    const client = asClient(fakeSupabase([otherClientRow]))

    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp1')).resolves.toBe(
      'not_messenger_draft',
    )
    await expect(checkMessengerDraftCampaign(client, 'C2', 'camp1')).resolves.toBe(
      'is_messenger_draft',
    )
  })

  it('returns lookup_failed when the query reports an error', async () => {
    const client = asClient(
      fakeSupabase([messengerRow], { error: { message: 'boom' } }),
    )
    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp1')).resolves.toBe(
      'lookup_failed',
    )
  })

  it('returns lookup_failed when the query throws', async () => {
    const client = asClient(fakeSupabase([messengerRow], { throws: true }))
    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp1')).resolves.toBe(
      'lookup_failed',
    )
  })

  it('returns lookup_failed for an empty or whitespace campaign id', async () => {
    const client = asClient(fakeSupabase([messengerRow]))
    await expect(checkMessengerDraftCampaign(client, 'C1', '')).resolves.toBe(
      'lookup_failed',
    )
    await expect(checkMessengerDraftCampaign(client, 'C1', '   ')).resolves.toBe(
      'lookup_failed',
    )
  })

  it('ignores rows whose action_type is not the draft action', async () => {
    const pauseRow: FakeRow = {
      id: 'row-4',
      client_id: 'C1',
      action_type: 'ads.pause_campaign',
      payload: { draft: { kind: 'messenger_conversation' }, campaignId: 'camp1' },
    }
    const client = asClient(fakeSupabase([pauseRow]))
    await expect(checkMessengerDraftCampaign(client, 'C1', 'camp1')).resolves.toBe(
      'not_messenger_draft',
    )
  })

  it('pins the draft action type literal', () => {
    expect(ADS_CREATE_ACTION).toBe('ads.create_ad')
  })

  it('exposes the user-facing messages', () => {
    expect(MESSENGER_REACTIVATE_BLOCKED_MESSAGE.length).toBeGreaterThan(0)
    expect(MESSENGER_LOOKUP_FAILED_MESSAGE.length).toBeGreaterThan(0)
  })
})

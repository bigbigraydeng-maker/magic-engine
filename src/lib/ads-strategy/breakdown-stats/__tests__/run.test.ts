import { describe, it, expect } from 'vitest'
import {
  runBreakdownCapture,
  captureWindow,
  chunkWindow,
  type CaptureDeps,
} from '../run'
import type {
  BreakdownKey,
  BreakdownSpec,
  BreakdownStatRow,
  GraphBreakdownRow,
} from '../types'
import type {
  GraphAccountDailySpendRow,
  GraphReadResult,
} from '@/lib/meta/entity-settings'
import { BreakdownTableMissingError } from '../store'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface CallLog {
  upsertRows: BreakdownStatRow[][]
  earliestStatDate: Array<{ adAccountId: string; key: BreakdownKey }>
  fetchBreakdown: Array<{
    adAccountId: string
    graphBreakdowns: string
    since: string
    until: string
  }>
  fetchAccountDaily: Array<{ adAccountId: string; since: string; until: string }>
  getToken: string[]
}

function makeSpec(key: BreakdownKey, graphBreakdowns: string): BreakdownSpec {
  return {
    key,
    graphBreakdowns,
    metaActionsAvailable: true,
    valueOf: (row) => {
      const v = row.hourly_stats_aggregated_by_advertiser_time_zone
      if (!v) return null
      return { hour: Number(v) }
    },
  }
}

function rawRow(overrides: Partial<GraphBreakdownRow> = {}): GraphBreakdownRow {
  return {
    ad_id: 'ad_1',
    date_start: '2026-10-20',
    spend: '50',
    impressions: '1000',
    clicks: '10',
    hourly_stats_aggregated_by_advertiser_time_zone: '21',
    ...overrides,
  }
}

function okRead<T>(rows: T[]): GraphReadResult<T> {
  return { rows, complete: true, error: null }
}

function makeDeps(overrides: Partial<CaptureDeps> = {}): {
  deps: CaptureDeps
  log: CallLog
} {
  const log: CallLog = {
    upsertRows: [],
    earliestStatDate: [],
    fetchBreakdown: [],
    fetchAccountDaily: [],
    getToken: [],
  }
  const deps: CaptureDeps = {
    store: {
      listAccounts: async () => [{ adAccountId: 'act_1', hidden: false }],
      earliestStatDate: async (adAccountId, key) => {
        log.earliestStatDate.push({ adAccountId, key })
        return '2026-10-20'
      },
      upsertRows: async (rows) => {
        log.upsertRows.push([...rows])
      },
    },
    getToken: async (clientId) => {
      log.getToken.push(clientId)
      return 'token'
    },
    resolveTimezone: async () => 'UTC',
    fetchBreakdown: async (adAccountId, _token, graphBreakdowns, since, until) => {
      log.fetchBreakdown.push({ adAccountId, graphBreakdowns, since, until })
      return okRead([rawRow({ date_start: since })])
    },
    fetchAccountDaily: async (adAccountId, _token, since, until) => {
      log.fetchAccountDaily.push({ adAccountId, since, until })
      return okRead<GraphAccountDailySpendRow>([
        { date_start: since, spend: '50' },
      ])
    },
    now: () => new Date('2026-10-21T12:00:00Z'),
    newRequestId: () => 'req_1',
    ...overrides,
  }
  return { deps, log }
}

// ---------------------------------------------------------------------------
// runBreakdownCapture
// ---------------------------------------------------------------------------

describe('runBreakdownCapture', () => {
  it('dry mode: no writes, no earliestStatDate, status ok, rows_by_key filled', async () => {
    const spec = makeSpec(
      'hour_account_tz',
      'hourly_stats_aggregated_by_advertiser_time_zone',
    )
    const { deps, log } = makeDeps()
    const receipt = await runBreakdownCapture(deps, {
      mode: 'dry',
      clientIds: ['c1'],
      specs: [spec],
      forceDays: 1,
    })
    expect(log.upsertRows).toHaveLength(0)
    expect(log.earliestStatDate).toHaveLength(0)
    expect(receipt.accounts).toHaveLength(1)
    expect(receipt.accounts[0].status).toBe('ok')
    expect(receipt.accounts[0].rows_by_key[spec.key]).toBe(1)
  })

  it('live mode: upsertRows called once with all rows', async () => {
    const spec = makeSpec(
      'hour_account_tz',
      'hourly_stats_aggregated_by_advertiser_time_zone',
    )
    const { deps, log } = makeDeps()
    const receipt = await runBreakdownCapture(deps, {
      mode: 'live',
      clientIds: ['c1'],
      specs: [spec],
      forceDays: 1,
    })
    expect(log.upsertRows).toHaveLength(1)
    expect(log.upsertRows[0].length).toBeGreaterThan(0)
    // Regression: rows once carried client_id '' (FK on clients.id would reject every write).
    expect(log.upsertRows[0].every((r) => r.client_id === 'c1')).toBe(true)
    expect(receipt.accounts[0].status).toBe('ok')
  })

  it('one chunk incomplete → partial', async () => {
    const specA = makeSpec('hour_account_tz', 'spec_a')
    const specB = makeSpec('age_gender', 'spec_b')
    const { deps } = makeDeps({
      now: () => new Date('2026-10-16T12:00:00Z'),
      fetchBreakdown: async (_adAccountId, _token, graphBreakdowns, since, _until) => {
        const incomplete =
          graphBreakdowns === 'spec_b' && since === '2026-10-08'
        return {
          rows: [rawRow({ date_start: since })],
          complete: !incomplete,
          error: incomplete ? { status: 500, code: null, message: 'boom' } : null,
        }
      },
    })
    const receipt = await runBreakdownCapture(deps, {
      mode: 'dry',
      clientIds: ['c1'],
      specs: [specA, specB],
      forceDays: 15,
    })
    expect(receipt.accounts[0].status).toBe('partial')
  })

  it('getToken null → no_token, fetchBreakdown never called', async () => {
    const spec = makeSpec(
      'hour_account_tz',
      'hourly_stats_aggregated_by_advertiser_time_zone',
    )
    const { deps, log } = makeDeps({
      getToken: async () => null,
    })
    const receipt = await runBreakdownCapture(deps, {
      mode: 'dry',
      clientIds: ['c1'],
      specs: [spec],
      forceDays: 1,
    })
    expect(receipt.accounts[0].status).toBe('no_token')
    expect(log.fetchBreakdown).toHaveLength(0)
  })

  it('live + earliestStatDate throws BreakdownTableMissingError → write_failed', async () => {
    const spec = makeSpec(
      'hour_account_tz',
      'hourly_stats_aggregated_by_advertiser_time_zone',
    )
    const { deps } = makeDeps({
      store: {
        listAccounts: async () => [{ adAccountId: 'act_1', hidden: false }],
        earliestStatDate: async () => {
          throw new BreakdownTableMissingError()
        },
        upsertRows: async () => {},
      },
    })
    const receipt = await runBreakdownCapture(deps, {
      mode: 'live',
      clientIds: ['c1'],
      specs: [spec],
    })
    expect(receipt.accounts[0].status).toBe('write_failed')
  })

  it('reconciliation failure appears in reconciliation_failures', async () => {
    const spec = makeSpec(
      'hour_account_tz',
      'hourly_stats_aggregated_by_advertiser_time_zone',
    )
    const { deps } = makeDeps({
      fetchBreakdown: async (_adAccountId, _token, _graphBreakdowns, since) =>
        okRead([rawRow({ date_start: since, spend: '50' })]),
      fetchAccountDaily: async (_adAccountId, _token, since) =>
        okRead<GraphAccountDailySpendRow>([
          { date_start: since, spend: '100' },
        ]),
    })
    const receipt = await runBreakdownCapture(deps, {
      mode: 'dry',
      clientIds: ['c1'],
      specs: [spec],
      forceDays: 1,
    })
    const failures = receipt.accounts[0].reconciliation_failures
    expect(failures.length).toBeGreaterThan(0)
    const failure = failures[0]
    expect(failure.breakdown_key).toBe(spec.key)
    expect(failure.breakdown_spend).toBe(50)
    expect(failure.account_spend).toBe(100)
    expect(failure.ok).toBe(false)
  })

  it('empty clientIds → problems contains config message, accounts empty', async () => {
    const { deps } = makeDeps()
    const receipt = await runBreakdownCapture(deps, {
      mode: 'dry',
      clientIds: [],
    })
    expect(receipt.accounts).toHaveLength(0)
    expect(
      receipt.problems.some((p) => p.includes('AD_BREAKDOWN_CLIENT_IDS')),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('chunkWindow', () => {
  it('splits 2026-10-01..2026-10-15 into 3 chunks of 7', () => {
    const chunks = chunkWindow('2026-10-01', '2026-10-15', 7)
    expect(chunks).toEqual([
      { since: '2026-10-01', until: '2026-10-07' },
      { since: '2026-10-08', until: '2026-10-14' },
      { since: '2026-10-15', until: '2026-10-15' },
    ])
  })
})

describe('captureWindow', () => {
  it('uses account timezone to compute yesterday', () => {
    const w = captureWindow(
      8,
      'Pacific/Auckland',
      new Date('2026-10-28T20:00:00Z'),
    )
    expect(w).toEqual({ since: '2026-10-21', until: '2026-10-28' })
  })
})

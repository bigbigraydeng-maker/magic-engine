/**
 * Tests for the serviced-client gate.
 *
 * This is the exact line that broke: the old selector filtered on a column that
 * did not exist, and the resulting error was swallowed for 30 days. The gate is
 * therefore split out as a pure function so it can be tested without a
 * database, which is the only reason it is exported.
 */

import { describe, it, expect } from 'vitest'
import { partitionByServiceGate } from './roster'

type Row = Parameters<typeof partitionByServiceGate>[0][number]

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'c0000000-0000-0000-0000-000000000000',
    name: 'CTS Tours NZ',
    created_at: '2026-04-27T00:00:00Z',
    client_status: 'active',
    facebook_page_id: '1616575215312482',
    meta_ad_account_id: 'act_2775766642787274',
    ...overrides,
  }
}

describe('partitionByServiceGate', () => {
  it('admits clients marked active', () => {
    const result = partitionByServiceGate([row()])

    expect(result.clients).toHaveLength(1)
    expect(result.clients[0].name).toBe('CTS Tours NZ')
    expect(result.excluded).toHaveLength(0)
  })

  it.each(['prospect', 'archived'])('excludes %s clients', status => {
    const result = partitionByServiceGate([row({ client_status: status })])

    expect(result.clients).toHaveLength(0)
    expect(result.excluded).toHaveLength(1)
  })

  it('reports exclusions with their status rather than dropping them silently', () => {
    // The 2026-07 incident was invisible because the missing clients left no
    // trace. Someone flipping a paying client to 'prospect' by accident has to
    // be readable in the cron summary.
    const result = partitionByServiceGate([
      row({ id: 'a', name: 'Real Client' }),
      row({ id: 'b', name: 'Discovery Profile', client_status: 'prospect' }),
    ])

    expect(result.excluded).toEqual([
      { id: 'b', name: 'Discovery Profile', clientStatus: 'prospect' },
    ])
  })

  it('treats a null status as excluded and labels it', () => {
    // Default is 'prospect', but a row predating the column would read null.
    // Failing closed keeps research profiles out of paid monitoring.
    const result = partitionByServiceGate([row({ client_status: null })])

    expect(result.clients).toHaveLength(0)
    expect(result.excluded[0].clientStatus).toBe('unset')
  })

  it('carries through the Meta identifiers the watchers need', () => {
    const result = partitionByServiceGate([row()])

    expect(result.clients[0].facebookPageId).toBe('1616575215312482')
    expect(result.clients[0].metaAdAccountId).toBe('act_2775766642787274')
  })

  it('normalises missing Meta identifiers to null', () => {
    const result = partitionByServiceGate([
      row({ facebook_page_id: null, meta_ad_account_id: null }),
    ])

    expect(result.clients[0].facebookPageId).toBeNull()
    expect(result.clients[0].metaAdAccountId).toBeNull()
  })

  describe('mutation guards', () => {
    it('kills "gate on the wrong value": only active passes', () => {
      const result = partitionByServiceGate([
        row({ id: '1', client_status: 'active' }),
        row({ id: '2', client_status: 'prospect' }),
        row({ id: '3', client_status: 'archived' }),
      ])

      expect(result.clients.map(c => c.id)).toEqual(['1'])
    })

    it('kills "drop the gate entirely": non-active rows must not slip through', () => {
      const result = partitionByServiceGate([row({ client_status: 'prospect' })])

      expect(result.clients).toHaveLength(0)
    })
  })
})

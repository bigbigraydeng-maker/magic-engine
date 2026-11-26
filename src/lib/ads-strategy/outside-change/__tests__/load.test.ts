import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOutsideChanges } from '../load'

const NOW = new Date('2026-11-01T00:00:00.000Z')
const BEFORE = '2026-10-29T22:00:00.000Z'
const AFTER = '2026-10-30T10:00:00.000Z'
const ACTION_AT = '2026-10-30T09:00:00.000Z'

function snap(capturedAt: string, hash: string, minor: number, status: string) {
  return {
    level: 'campaign',
    entity_id: 'camp-1',
    entity_name: 'Spring',
    campaign_id: null,
    adset_id: null,
    settings_hash: hash,
    daily_budget_minor: minor,
    lifetime_budget_minor: null,
    currency: 'NZD',
    effective_status: status,
    captured_at: capturedAt,
  }
}

const SNAPSHOTS = [
  snap(BEFORE, 'h1', 5000, 'ACTIVE'),
  snap(AFTER, 'h2', 4000, 'PAUSED'),
]

function chain(rows: unknown[]) {
  const builder: Record<string, unknown> = {}
  const self = () => builder
  for (const method of ['select', 'eq', 'in', 'gte', 'lt', 'order']) builder[method] = self
  const done = async () => ({ data: rows, error: null })
  builder.range = done
  builder.limit = done
  return builder
}

function client(tables: Record<string, unknown[]>): { db: SupabaseClient; seen: string[] } {
  const seen: string[] = []
  const db = {
    from(table: string) {
      seen.push(table)
      return chain(tables[table] ?? [])
    },
  }
  return { db: db as unknown as SupabaseClient, seen }
}

describe('loadOutsideChanges', () => {
  it('does not read flywheel_actions, so an old-entry budget or pause receipt does not count as ME', async () => {
    const { db, seen } = client({
      ad_entity_snapshots: SNAPSHOTS,
      flywheel_actions: [{
        action_type: 'ads.adjust_bid',
        executed_at: ACTION_AT,
        payload: { campaign_id: 'camp-1', status: 'executed' },
      }, {
        action_type: 'ads.pause_campaign',
        executed_at: ACTION_AT,
        payload: { campaign_id: 'camp-1', status: 'executed' },
      }],
      action_runs: [],
    })
    const found = await loadOutsideChanges('client-1', db, NOW)
    expect(seen).not.toContain('flywheel_actions')
    expect(seen).toContain('action_runs')
    expect(found.map((row) => row.kind).sort()).toEqual(['budget', 'status'])
  })

  it('treats a Kernel run as ME, and a manual_meta_adopted run as outside', async () => {
    const kernel = {
      action_key: 'ads.cut_campaign_budget',
      input: { campaign_id: 'camp-1' },
      evidence: {},
      status: 'succeeded',
      created_at: ACTION_AT,
      finished_at: ACTION_AT,
    }
    const explained = client({
      ad_entity_snapshots: SNAPSHOTS,
      action_runs: [kernel],
    })
    const adopted = client({
      ad_entity_snapshots: SNAPSHOTS,
      action_runs: [{ ...kernel, input: { campaign_id: 'camp-1', adopted: { source: 'manual_meta_adopted' } } }],
    })
    const explainedRows = await loadOutsideChanges('client-1', explained.db, NOW)
    const adoptedRows = await loadOutsideChanges('client-1', adopted.db, NOW)
    expect(explainedRows.map((row) => row.kind)).toEqual(['status'])
    expect(adoptedRows.map((row) => row.kind).sort()).toEqual(['budget', 'status'])
  })
})

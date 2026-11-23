import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ADS_ACTION_TYPE } from '@/lib/flywheel/vocabulary'
import { mergeDecisionOntoCardRow, patchDecisionOnRow } from '../persist'
import type { AdsDecisionV1 } from '../types'

const CLIENT = 'client-fixture'
const CARD = 'card-fixture'

function decision(over: Partial<AdsDecisionV1> = {}): AdsDecisionV1 {
  return {
    schema_version: 'ads_decision_v1',
    decided_at: '2026-11-14T00:00:00.000Z',
    decided_by: { kind: 'card_execution', label: 'operator' },
    subject: { level: 'adset', ref: 'fixture-subject', label_zh: '测试广告组' },
    decision_type: 'budget_change',
    what_done_zh: '调整了这一组的日预算',
    evidence_at_decision: { note_zh: '来自确认卡执行瞬间的台账' },
    reasoning_zh: '人在确认卡上执行成功。',
    expectation: {
      items: [{ metric: 'cpl_ratio_to_target', target: 'at or below target', horizon_days: 3, scope: 'adset' }],
    },
    stop_or_rollback_zh: '观察期内持续偏离目标时再开确认卡。',
    review_due_on: '2026-11-17',
    status: 'active',
    review_result: null,
    linked_card_action_id: CARD,
    ...over,
  }
}

interface LedgerCall {
  op: 'update' | 'insert'
  row: Record<string, unknown>
  id: string | null
}

function ledgerClient(stored: Record<string, unknown> | null): {
  client: SupabaseClient
  calls: LedgerCall[]
} {
  const calls: LedgerCall[] = []
  const rows: Array<Record<string, unknown>> = []
  const client = {
    from() {
      const filters: Array<[string, unknown]> = []
      let inserted: Record<string, unknown> | null = null
      const api = {
        select() { return api },
        insert(row: Record<string, unknown>) {
          inserted = row
          calls.push({ op: 'insert', row, id: null })
          rows.push({ id: `decision-${rows.length + 1}`, ...row })
          return api
        },
        update(patch: { payload?: Record<string, unknown> }) {
          calls.push({ op: 'update', row: patch.payload ?? {}, id: null })
          return api
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          const last = calls[calls.length - 1]
          if (column === 'id' && last && last.id === null && typeof value === 'string') last.id = value
          return api
        },
        limit() { return api },
        maybeSingle: async () => {
          if (inserted) {
            const id = rows[rows.length - 1]?.id
            return { data: typeof id === 'string' ? { id } : null, error: null }
          }
          return { data: stored ? { payload: stored } : null, error: null }
        },
        then(onFulfilled: (value: { data: unknown; error: null }) => unknown) {
          const data = rows.filter((row) => filters.every(([column, value]) => matches(row, column, value)))
          return Promise.resolve({ data, error: null }).then(onFulfilled)
        },
      }
      return api
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

function matches(row: Record<string, unknown>, column: string, value: unknown): boolean {
  if (column === 'payload->ads_decision_v1->>linked_card_action_id') {
    return record(record(row.payload)?.ads_decision_v1)?.linked_card_action_id === value
  }
  return row[column] === value
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

describe('ads decision ledger append-only', () => {
  it('appends a new decision row and does not rewrite the card ledger', async () => {
    const stale = {
      status: 'holding',
      wroteMeta: false,
      review: { metric: 'ads.fixture.outcome', objectId: 'fixture-subject' },
    }
    const { client, calls } = ledgerClient(stale)
    const next = decision()

    await mergeDecisionOntoCardRow(client, {
      clientId: CLIENT,
      actionId: CARD,
      decision: next,
      currentPayload: stale,
    })

    expect(calls.filter((call) => call.op === 'update')).toEqual([])
    const inserts = calls.filter((call) => call.op === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0]?.row).toMatchObject({
      client_id: CLIENT,
      flywheel: 'ads',
      action_type: ADS_ACTION_TYPE.DECISION_LOG,
      payload: { ads_decision_v1: next },
    })
    expect(inserts[0]?.row.payload).not.toHaveProperty('status')
    expect(inserts[0]?.row.payload).not.toHaveProperty('wroteMeta')
    expect(inserts[0]?.row.payload).not.toHaveProperty('review')
  })

  it('does not append a second decision for the same card', async () => {
    const { client, calls } = ledgerClient(null)
    const next = decision()
    const input = {
      clientId: CLIENT,
      actionId: CARD,
      decision: next,
      currentPayload: { status: 'holding', wroteMeta: false },
    }

    await mergeDecisionOntoCardRow(client, input)
    await mergeDecisionOntoCardRow(client, input)

    expect(calls.filter((call) => call.op === 'update')).toEqual([])
    expect(calls.filter((call) => call.op === 'insert')).toHaveLength(1)
  })

  it('does not write a stale card snapshot over executed ledger fields', async () => {
    const stored = {
      status: 'executed',
      wroteMeta: true,
      review: { metric: 'ads.fixture.outcome', objectId: 'fixture-subject' },
      ads_decision_v1: decision(),
    }
    const { client, calls } = ledgerClient(stored)
    const reviewed = decision({
      review_result: {
        verdict: 'met',
        reason_zh: '观察期达到预期',
        suggested_next_zh: null,
        reviewed_at: '2026-11-17T00:00:00.000Z',
      },
    })

    const ok = await patchDecisionOnRow(client, {
      clientId: CLIENT,
      actionId: CARD,
      decision: reviewed,
      currentPayload: { status: 'holding', wroteMeta: false },
    })

    expect(ok).toBe(true)
    const updates = calls.filter((call) => call.op === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0]?.id).toBe(CARD)
    expect(updates[0]?.row).toMatchObject({
      status: 'executed',
      wroteMeta: true,
      review: { metric: 'ads.fixture.outcome', objectId: 'fixture-subject' },
    })
    expect(record(updates[0]?.row.ads_decision_v1)?.review_result).toMatchObject({ verdict: 'met' })
  })
})

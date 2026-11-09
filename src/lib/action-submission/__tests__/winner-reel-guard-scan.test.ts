/**
 * Guards that can be checked without a live Meta call.
 * Ids here are short fakes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { holdForCard, WINNER_ACTION } from '@/lib/winner-reel-sync/ledger'

const RUN = 'run-1'

function lookup(row: { id: string; client_id: string; action_type: string; payload: Record<string, unknown> }) {
  return {
    from() {
      const filters: Array<[string, string]> = []
      const api = {
        select() { return api },
        eq(col: string, val: string) { filters.push([col, val]); return api },
        then(onOk: (value: { data: unknown; error: null }) => unknown) {
          const ok = filters.every(([col, val]) => {
            if (col === 'client_id') return row.client_id === val
            if (col === 'action_type') return row.action_type === val
            if (col === 'payload->>cardRunId') return row.payload.cardRunId === val
            return false
          })
          const data = ok ? [{ id: row.id, payload: row.payload }] : []
          return Promise.resolve({ data, error: null }).then(onOk)
        },
      }
      return api
    },
  } as unknown as SupabaseClient
}

function row(clientId: string) {
  return {
    id: 'row-1',
    client_id: clientId,
    action_type: WINNER_ACTION,
    payload: { kind: 'add_paused', cardRunId: RUN, subjectKey: 'winner-add:abc', status: 'holding' },
  }
}

describe('winner hold lookup', () => {
  it('a card stored for another client is not returned', async () => {
    const found = await holdForCard(lookup(row('client-2')), 'client-1', RUN)
    expect(found).toBeNull()
  })

  it('returns the card only for the same client', async () => {
    const found = await holdForCard(lookup(row('client-1')), 'client-1', RUN)
    expect(found?.id).toBe('row-1')
  })
})

describe('winner confirm source order', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/action-submission/winner-reel-execute.ts'), 'utf8')
  const confirm = source.slice(
    source.indexOf('export async function confirmWinnerCard'),
    source.indexOf('function defaultPorts'),
  )
  const writeAt = confirm.indexOf('writeOnce')

  it('looks up the client row, decline, and the decision before any write', () => {
    expect(confirm.indexOf('holdForCard')).toBeGreaterThan(-1)
    expect(confirm.indexOf('holdForCard')).toBeLessThan(writeAt)
    expect(confirm.indexOf("choice === 'decline'")).toBeLessThan(writeAt)
    expect(confirm.indexOf('ports.decide')).toBeLessThan(writeAt)
    expect(confirm.indexOf('claimHold')).toBeLessThan(writeAt)
  })

  it('reads expired and void before claiming the ledger or writing', () => {
    const between = confirm.slice(confirm.indexOf('ports.decide'), writeAt)
    const statusAt = between.indexOf('card.status')
    const claimAt = between.indexOf('claimHold')
    expect(between).toContain('expired')
    expect(between).toContain('voided')
    expect(statusAt).toBeGreaterThan(-1)
    expect(claimAt).toBeGreaterThan(statusAt)
  })

  it('a mismatched read-back is a failed return, not a second create', () => {
    const writeAdd = source.slice(source.indexOf('async function writeAdd'), source.indexOf('async function createdAd'))
    const created = source.slice(source.indexOf('async function createdAd'), source.indexOf('async function remember'))
    expect(writeAdd).toContain('没有再改一次')
    expect(writeAdd.match(/createdAd\(/g)).toHaveLength(1)
    expect(created.match(/createPaused\(/g)).toHaveLength(1)
    expect(source).toContain('没有再自动写一次')
  })
})

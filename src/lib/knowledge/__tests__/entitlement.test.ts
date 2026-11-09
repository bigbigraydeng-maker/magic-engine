import { describe, it, expect } from 'vitest'
import { getKnowledgeEntitlement, KNOWLEDGE_READ_ACTION_KEY } from '../entitlement'
import { KnowledgeReadError } from '../errors'
import { createFakeSupabase, type Row } from './fake-supabase'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CLIENT_B = 'bbbbbbbb-0000-0000-0000-000000000002'
const NOW = new Date('2026-09-14T00:00:00.000Z')

function grantRow(overrides: Partial<Row> = {}): Row {
  return {
    client_id: CLIENT_A,
    action_key: KNOWLEDGE_READ_ACTION_KEY,
    mode: 'auto_approve',
    updated_by: 'ray@magicengine.cloud',
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    metadata: { basis: 'fde_managed' },
    ...overrides,
  }
}

describe('getKnowledgeEntitlement', () => {
  it('fail-closed: no grant row at all → not entitled', async () => {
    const sb = createFakeSupabase({ client_automation_policies: [] })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result).toEqual({ entitled: false })
  })

  it('returns entitled with basis/grantedBy/grantedAt for an active auto_approve grant', async () => {
    const sb = createFakeSupabase({ client_automation_policies: [grantRow()] })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result).toEqual({
      entitled: true,
      basis: 'fde_managed',
      grantedBy: 'ray@magicengine.cloud',
      grantedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('fail-closed: mode = deny → not entitled even though a row exists', async () => {
    const sb = createFakeSupabase({
      client_automation_policies: [grantRow({ mode: 'deny' })],
    })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result).toEqual({ entitled: false })
  })

  it('fail-closed: grant expired (effective_to in the past) → not entitled', async () => {
    const sb = createFakeSupabase({
      client_automation_policies: [grantRow({ effective_to: '2026-06-01T00:00:00.000Z' })],
    })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result).toEqual({ entitled: false })
  })

  it('fail-closed: grant not yet effective (effective_from in the future) → not entitled', async () => {
    const sb = createFakeSupabase({
      client_automation_policies: [grantRow({ effective_from: '2027-01-01T00:00:00.000Z' })],
    })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result).toEqual({ entitled: false })
  })

  it('cross-client isolation: client A grant never entitles client B', async () => {
    const sb = createFakeSupabase({ client_automation_policies: [grantRow({ client_id: CLIENT_A })] })
    const result = await getKnowledgeEntitlement(CLIENT_B, { supabase: sb, now: () => NOW })
    expect(result).toEqual({ entitled: false })
  })

  it('ignores grants for other action_keys (does not entitle knowledge reads)', async () => {
    const sb = createFakeSupabase({
      client_automation_policies: [grantRow({ action_key: 'meta_ads.publish' })],
    })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result).toEqual({ entitled: false })
  })

  it('read failure throws KnowledgeReadError, never resolves to a silent deny-shaped result', async () => {
    const sb = createFakeSupabase(
      { client_automation_policies: [] },
      { errorTables: new Set(['client_automation_policies']) },
    )
    await expect(getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })).rejects.toThrow(
      KnowledgeReadError,
    )
  })

  it('omits basis when metadata.basis is missing or unrecognised', async () => {
    const sb = createFakeSupabase({
      client_automation_policies: [grantRow({ metadata: {} })],
    })
    const result = await getKnowledgeEntitlement(CLIENT_A, { supabase: sb, now: () => NOW })
    expect(result.entitled).toBe(true)
    expect(result.basis).toBeUndefined()
  })
})

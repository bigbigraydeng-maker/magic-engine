import { describe, expect, it } from 'vitest'
import {
  FALLBACK_REASON,
  countReviewCallsByClient,
  loadReviewCalls,
  numberTail,
  toReviewCall,
  type ReviewCallRow,
} from '../review-calls'
import type { SupabaseClient } from '@supabase/supabase-js'

const row = (over: Partial<ReviewCallRow> = {}): ReviewCallRow => ({
  id: 'k1',
  started_at: '2026-10-12T01:00:00Z',
  direction: 'inbound',
  counterparty_e164: '+64211761528',
  answered: true,
  talk_seconds: 29,
  crm_status: 'needs_review',
  crm_detail: '补处理多次仍没写进客户记录，需人工确认',
  ...over,
})

/** 一个会按调用链记下过滤条件、最后返回固定结果的假 supabase。 */
function fakeSupabase(result: { data: unknown; error: { message: string } | null; count?: number | null }) {
  const calls: Array<[string, unknown[]]> = []
  const chain: Record<string, unknown> = {}
  for (const m of ['from', 'select', 'eq', 'in', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return m === 'limit' ? Promise.resolve(result) : chain
    }
  }
  return { client: chain as unknown as SupabaseClient, calls }
}

describe('numberTail', () => {
  it('只给最后 3 位，不露完整号码', () => {
    expect(numberTail('+64211761528')).toBe('528')
    expect(numberTail('+64 21 176 1528')).toBe('528')
  })
  it('没有号码给空串', () => {
    expect(numberTail(null)).toBe('')
    expect(numberTail('')).toBe('')
  })
})

describe('toReviewCall', () => {
  it('原因原样带出；没写原因给兜底句', () => {
    expect(toReviewCall(row()).reason).toBe('补处理多次仍没写进客户记录，需人工确认')
    expect(toReviewCall(row({ crm_detail: '  ' })).reason).toBe(FALLBACK_REASON)
    expect(toReviewCall(row({ crm_detail: null })).reason).toBe(FALLBACK_REASON)
  })
  it('failed 与 needs_review 分开；方向认不出给 null；完整号码不出现在结果里', () => {
    expect(toReviewCall(row({ crm_status: 'failed' })).status).toBe('failed')
    expect(toReviewCall(row({ direction: 'weird' })).direction).toBeNull()
    expect(JSON.stringify(toReviewCall(row()))).not.toContain('64211761528')
  })
})

describe('loadReviewCalls', () => {
  it('只查这个客户、只查待确认/没记成两种状态', async () => {
    const { client, calls } = fakeSupabase({ data: [row()], error: null, count: 1 })
    const out = await loadReviewCalls(client, 'cts', 50)
    expect(out.total).toBe(1)
    expect(calls).toContainEqual(['eq', ['client_id', 'cts']])
    expect(calls).toContainEqual(['in', ['crm_status', ['needs_review', 'failed']]])
  })
  it('🔴 读失败必须抛，不能画成「没有待确认」', async () => {
    const { client } = fakeSupabase({ data: null, error: { message: 'boom' } })
    await expect(loadReviewCalls(client, 'cts')).rejects.toThrow(/boom/)
  })
  it('总数大于已列出的条数时，如实带出总数', async () => {
    const { client } = fakeSupabase({ data: [row()], error: null, count: 7 })
    const out = await loadReviewCalls(client, 'cts', 1)
    expect(out.calls).toHaveLength(1)
    expect(out.total).toBe(7)
  })
})

describe('countReviewCallsByClient', () => {
  it('按客户数条数；没有客户 id 不查库；读失败抛', async () => {
    const { client } = fakeSupabase({ data: [{ client_id: 'a' }, { client_id: 'a' }, { client_id: 'b' }], error: null })
    const m = await countReviewCallsByClient(client, ['a', 'b'])
    expect(m.get('a')).toBe(2)
    expect(m.get('b')).toBe(1)
    expect((await countReviewCallsByClient(client, [])).size).toBe(0)
    const bad = fakeSupabase({ data: null, error: { message: 'x' } })
    await expect(countReviewCallsByClient(bad.client, ['a'])).rejects.toThrow()
  })
})

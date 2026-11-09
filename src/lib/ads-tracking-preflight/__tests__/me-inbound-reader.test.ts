/**
 * 按目标盯盘 · 读 ME 里实际收到的 WhatsApp 会话数（只读，只数不取内容）。
 * 假库只实现 select / eq / gte：任何写方法都会直接抛 TypeError，等于证明它只读。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countMeWhatsappInbound } from '../me-inbound-reader'

const SINCE = '2026-10-20T09:51:08.000Z'

interface Query {
  table: string
  selectArgs: unknown[]
  filters: [string, string, unknown][]
}

type Outcome = { count: number | null; error: { message: string } | null } | 'throw'

function fakeSupabase(outcomes: Record<string, Outcome>) {
  const queries: Query[] = []
  const client = {
    from: (table: string) => {
      const q: Query = { table, selectArgs: [], filters: [] }
      queries.push(q)
      const chain = {
        select: (...args: unknown[]) => { q.selectArgs = args; return chain },
        eq: (col: string, val: unknown) => { q.filters.push(['eq', col, val]); return chain },
        gte: async (col: string, val: unknown) => {
          q.filters.push(['gte', col, val])
          const out = outcomes[table]
          if (out === 'throw') throw new Error('网断了')
          return out ?? { count: 0, error: null }
        },
      }
      return chain
    },
  }
  // 假库只实现被测代码真会调用的链式方法（和同目录其它测试同款写法）
  return { supabase: client as unknown as SupabaseClient, queries }
}

describe('countMeWhatsappInbound', () => {
  it('取「新建的 WhatsApp 会话」和「收到过客人来信的会话」两个数里大的那个', async () => {
    const a = fakeSupabase({ conversations: { count: 3, error: null }, contact_touchpoints: { count: 5, error: null } })
    expect(await countMeWhatsappInbound(a.supabase, 'c1', SINCE)).toEqual({ read: true, count: 5, since: SINCE })
    const b = fakeSupabase({ conversations: { count: 4, error: null }, contact_touchpoints: { count: 1, error: null } })
    expect(await countMeWhatsappInbound(b.supabase, 'c1', SINCE)).toEqual({ read: true, count: 4, since: SINCE })
  })

  it('两个数都是 0 → 读到了，是 0（不是读失败）', async () => {
    const { supabase } = fakeSupabase({ conversations: { count: 0, error: null }, contact_touchpoints: { count: 0, error: null } })
    expect(await countMeWhatsappInbound(supabase, 'c1', SINCE)).toEqual({ read: true, count: 0, since: SINCE })
  })

  it('只数不取内容：head 计数查询，带客户编号、WhatsApp 渠道、客人来信方向和起始时间', async () => {
    const { supabase, queries } = fakeSupabase({})
    await countMeWhatsappInbound(supabase, 'c1', SINCE)
    expect(queries.map(q => q.table)).toEqual(['conversations', 'contact_touchpoints'])
    for (const q of queries) expect(q.selectArgs).toEqual(['id', { count: 'exact', head: true }])
    expect(queries[0].filters).toEqual([['eq', 'client_id', 'c1'], ['eq', 'channel', 'whatsapp'], ['gte', 'created_at', SINCE]])
    expect(queries[1].filters).toEqual([
      ['eq', 'client_id', 'c1'], ['eq', 'channel', 'whatsapp'], ['eq', 'direction', 'inbound'], ['gte', 'occurred_at', SINCE],
    ])
  })

  it('任何一个查询出错 / 没返回数 / 抛异常 → read=false，不当成 0', async () => {
    const err = fakeSupabase({ conversations: { count: null, error: { message: '表不存在' } } })
    const r1 = await countMeWhatsappInbound(err.supabase, 'c1', SINCE)
    expect(r1.read).toBe(false)
    expect(JSON.stringify(r1)).toContain('表不存在')

    const noCount = fakeSupabase({ conversations: { count: 2, error: null }, contact_touchpoints: { count: null, error: null } })
    expect((await countMeWhatsappInbound(noCount.supabase, 'c1', SINCE)).read).toBe(false)

    const thrown = fakeSupabase({ contact_touchpoints: 'throw' })
    expect((await countMeWhatsappInbound(thrown.supabase, 'c1', SINCE)).read).toBe(false)
  })

  it('起始时间读不懂 → read=false，一个查询都不发', async () => {
    const { supabase, queries } = fakeSupabase({})
    expect((await countMeWhatsappInbound(supabase, 'c1', 'not-a-time')).read).toBe(false)
    expect(queries).toHaveLength(0)
  })
})

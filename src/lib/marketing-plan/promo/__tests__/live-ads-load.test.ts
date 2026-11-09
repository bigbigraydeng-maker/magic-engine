import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ eqCalls: [] as [string, string, unknown][] }))

vi.mock('@/lib/supabase', () => {
  const chain = (table: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.select = pass; c.in = pass; c.gte = pass; c.order = pass
    c.eq = (col: string, val: unknown) => { m.eqCalls.push([table, col, val]); return c }
    c.limit = pass
    c.maybeSingle = async () => ({ data: null, error: null })
    // 绑定表给一个账户；其余表空
    c.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === 'client_meta_ad_accounts' ? [{ ad_account_id: 'act_1', label: 'x' }] : [], error: null })
    return c
  }
  return { supabaseAdmin: { from: (t: string) => chain(t) } }
})

import { loadLiveAds } from '../live-ads'

describe('loadLiveAds 读快照抓取回执', () => {
  it('只认 complete=true 的抓取（Meta 授权失效时 complete=false 的行照写，不筛就永远「新」）', async () => {
    m.eqCalls.length = 0
    await loadLiveAds('client-1')
    expect(m.eqCalls.filter(([t, c]) => t === 'ad_snapshot_captures' && c === 'complete')).toEqual([['ad_snapshot_captures', 'complete', true]])
  })
})

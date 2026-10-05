/**
 * GET /api/workbench/today — 外网链接卡住时页面接口仍要在限定时间内返回
 * （PM 2026-09-26 报 /dashboard/today「loading 非常慢」）。
 *
 * 数据库用一个「每张表都读回空、客户表读回两家」的假库；全局 fetch 换成永远不回的，
 * 模拟某个公开网址卡住。改之前这条链接要等满 8 秒超时，接口才返回。
 */

import { describe, expect, it, vi } from 'vitest'

const clientsRows = [
  { id: 'c1', name: 'Client One', domain: 'one.example.com', client_status: 'active' },
  { id: 'c2', name: 'Client Two', domain: 'two.example.com', client_status: 'active' },
]

function fakeQuery(table: string): unknown {
  const q: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: table === 'clients' ? clientsRows : [], error: null, count: 0 }).then(res, rej)
      }
      if (prop === 'single' || prop === 'maybeSingle') return async () => ({ data: null, error: null })
      return () => q
    },
  })
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: (t: string) => fakeQuery(t), rpc: (fn: string) => fakeQuery(`rpc:${fn}`) },
}))
// 同时给出两个守卫：PR #2027 把这条路由换成 guardGlobalAdmin，合并先后都不影响这条测试
vi.mock('@/lib/auth/require-admin', () => ({
  guardAdmin: async () => null,
  guardGlobalAdmin: async () => null,
}))

import { GET } from '../route'

describe('GET /api/workbench/today — 链接检查卡住时的耗时上限', () => {
  it('一条公开链接永远不回，接口仍在 4 秒内返回 200，且那条链接确实被实测过', async () => {
    vi.stubEnv('META_SYSTEM_USER_TOKEN', '')
    const fetched: string[] = []
    vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
      fetched.push(String(url))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })

    try {
      const t0 = Date.now()
      const res = await GET()
      const elapsed = Date.now() - t0

      expect(res.status).toBe(200)
      // 防空跑：假库必须真的造出了要实测的公开链接，否则这条测试什么都没测
      expect(fetched.length).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(4_000)
      const json = await res.json()
      expect(Array.isArray(json.counts.manualItems)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  }, 15_000)
})

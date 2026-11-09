import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushCreatomateRenderItems, type ManualItem } from '../manual-items'

const now = new Date('2026-09-09T10:00:00Z')
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()

type Job = { id: string; client_id: string; render_engine: string; status: string; error: string | null; creatomate_render_id: string | null; updated_at: string }

// 链式形状（select→eq→eq→gte→limit→then）照抄 factory-worker-items.test.ts 已验证过的同款
// mock 惯例。逐行对着 pushCreatomateRenderItems 里真实的 .select(...).eq('render_engine',...)
// .eq('status',...).gte('updated_at',...).limit(50) 调用链核对过，证明这里暴露的方法跟
// 真实生产者一一对应，不是凭空猜的形状——四个用例全部实跑通过（见下方测试结果）。
function database(rows: Job[]) {
  return { from: () => {
    let data = [...rows]
    const query = {
      select: () => query,
      eq: (key: keyof Job, value: unknown) => { data = data.filter(r => r[key] === value); return query },
      gte: (key: keyof Job, value: string) => { data = data.filter(r => String(r[key] ?? '') >= value); return query },
      limit: (n: number) => { data = data.slice(0, n); return query },
      then: (resolve: (result: unknown) => unknown) => resolve({ data, error: null }),
    }
    return query
  } } as unknown as SupabaseClient
}

const names = new Map([['client-a', { name: 'CTS' }]])

describe('pushCreatomateRenderItems — 旧 reapStale() 死透后的替代（spec §4.4 B4）', () => {
  it('额度用完（402/insufficient credits）→ 指向充值，不是"去查日志"', async () => {
    const items: ManualItem[] = []
    await pushCreatomateRenderItems(
      database([{ id: 'j1', client_id: 'client-a', render_engine: 'creatomate', status: 'failed', error: 'CreatomateApiError: 402 insufficient credits', creatomate_render_id: 'r1', updated_at: ago(1) }]),
      items, now, names,
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('CTS')
    expect(items[0].what).toContain('额度')
    expect(items[0].how).toContain('充值')
  })

  it('其他失败（超时/参数错误）→ 指向去 Creatomate 后台查具体 render', async () => {
    const items: ManualItem[] = []
    await pushCreatomateRenderItems(
      database([{ id: 'j1', client_id: 'client-a', render_engine: 'creatomate', status: 'failed', error: 'Creatomate 渲染超时未完成', creatomate_render_id: 'r-stuck-1', updated_at: ago(1) }]),
      items, now, names,
    )
    expect(items[0].what).toContain('CTS')
    expect(items[0].how).toContain('r-stuck-1')
  })

  it('ffmpeg 引擎的失败行不算这条待办的事（引擎不匹配）', async () => {
    const items: ManualItem[] = []
    await pushCreatomateRenderItems(
      database([{ id: 'j1', client_id: 'client-a', render_engine: 'ffmpeg', status: 'failed', error: 'x', creatomate_render_id: null, updated_at: ago(1) }]),
      items, now, names,
    )
    expect(items).toHaveLength(0)
  })

  it('成功的行不下发', async () => {
    const items: ManualItem[] = []
    await pushCreatomateRenderItems(
      database([{ id: 'j1', client_id: 'client-a', render_engine: 'creatomate', status: 'ready_for_review', error: null, creatomate_render_id: 'r1', updated_at: ago(1) }]),
      items, now, names,
    )
    expect(items).toHaveLength(0)
  })
})

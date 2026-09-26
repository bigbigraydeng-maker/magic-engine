/**
 * /dashboard/today「loading 非常慢」（PM 2026-09-26）的回归守卫。
 *
 * 1. 链接闸：给了 budgetMs 时，一条挂住的外网链接不能拖住整批；没验完的放行，
 *    后台那次实测跑完写进缓存，下一次按实测结论处理。
 * 2. 链接缓存：十分钟内同一条链接只实测一次。
 * 3. runPushers：各通道同时跑，但拼回来的顺序跟列出的顺序一致。
 */

import { describe, it, expect, vi } from 'vitest'
import { dropBrokenLinks, runPushers, type ManualItem } from '../manual-item-types'
import { verifyActionLinkCached, type LinkVerdictCache } from '../action-link'

const item = (href: string, kind: ManualItem['kind'] = 'blog_pr_open'): ManualItem => ({
  kind,
  client_id: 'c1',
  client_name: 'Client One',
  what: 'w',
  how: 'h',
  href,
})

/** 永远不回的 fetch —— 只有被 abort 才结束（模拟卡住的公开网址）。 */
function hangingFetch(calls: string[]): typeof fetch {
  return ((url: string | URL, init?: RequestInit) => {
    calls.push(String(url))
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })
  }) as typeof fetch
}

describe('dropBrokenLinks — budgetMs', () => {
  it('一条链接卡住时，整批在预算内返回，卡住的那条按「验不了」放行', async () => {
    const calls: string[] = []
    const items = [item('https://slow.example.com/a'), item('')]
    const t0 = Date.now()

    const { kept, dropped } = await dropBrokenLinks(items, hangingFetch(calls), { budgetMs: 50 })

    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(calls).toEqual(['https://slow.example.com/a'])
    expect(kept).toEqual(items)
    expect(dropped).toEqual([])
  })

  it('预算内验完的坏链接照旧不下发（预算只管「没验完」的，不放过验出来是坏的）', async () => {
    const fetch404 = (async () => new Response('', { status: 404 })) as typeof fetch
    const { kept, dropped } = await dropBrokenLinks([item('https://gone.example.com/x')], fetch404, {
      budgetMs: 1_000,
    })
    expect(kept).toEqual([])
    expect(dropped.map((d) => d.href)).toEqual(['https://gone.example.com/x'])
  })

  it('预算到点后后台实测照常跑完、写进缓存 —— 下一次就按实测结论丢掉坏链接', async () => {
    const cache: LinkVerdictCache = new Map()
    let calls = 0
    const slow404 = (async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 80))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const items = [item('https://gone.example.com/x')]

    const first = await dropBrokenLinks(items, slow404, { cache, budgetMs: 10 })
    expect(first.kept).toEqual(items)

    await new Promise((r) => setTimeout(r, 250))
    expect(cache.get('https://gone.example.com/x')?.verdict.kind).toBe('broken')

    const callsBefore = calls
    const second = await dropBrokenLinks(items, slow404, { cache, budgetMs: 10 })
    expect(second.kept).toEqual([])
    expect(calls).toBe(callsBefore)
  })

  it('不给 budgetMs（每日邮件那条路）就等每条验完 —— 老行为不变', async () => {
    const slow404 = (async () => {
      await new Promise((r) => setTimeout(r, 60))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const { dropped } = await dropBrokenLinks([item('https://gone.example.com/y')], slow404)
    expect(dropped).toHaveLength(1)
  })
})

describe('verifyActionLinkCached', () => {
  it('十分钟内同一条链接只实测一次，过期后重新实测', async () => {
    const cache: LinkVerdictCache = new Map()
    const fetchOk = vi.fn(async () => new Response('', { status: 200 }))
    let t = 1_000_000
    const now = () => t

    await verifyActionLinkCached('https://ok.example.com', fetchOk as typeof fetch, cache, now)
    await verifyActionLinkCached('https://ok.example.com', fetchOk as typeof fetch, cache, now)
    expect(fetchOk).toHaveBeenCalledTimes(1)

    t += 10 * 60 * 1000
    await verifyActionLinkCached('https://ok.example.com', fetchOk as typeof fetch, cache, now)
    expect(fetchOk).toHaveBeenCalledTimes(2)
  })

  it('登录类站点不发请求，也不写缓存', async () => {
    const cache: LinkVerdictCache = new Map()
    const fetchOk = vi.fn(async () => new Response('', { status: 200 }))
    const v = await verifyActionLinkCached('https://business.facebook.com/x', fetchOk as typeof fetch, cache)
    expect(v.kind).toBe('unverifiable')
    expect(fetchOk).not.toHaveBeenCalled()
    expect(cache.size).toBe(0)
  })
})

describe('runPushers', () => {
  it('同时跑，但按列出的顺序拼回（后列出的先跑完也排在后面）', async () => {
    const items: ManualItem[] = []
    const started: string[] = []
    await runPushers(items, [
      async (b) => {
        started.push('a')
        await new Promise((r) => setTimeout(r, 40))
        b.push(item('https://a.example.com'))
      },
      async (b) => {
        started.push('b')
        b.push(item('https://b.example.com'))
      },
    ])
    expect(started).toEqual(['a', 'b'])
    expect(items.map((i) => i.href)).toEqual(['https://a.example.com', 'https://b.example.com'])
  })

  it('某条通道自己没兜住就抛错时整体照旧抛出（调用方的兜底行为不变）', async () => {
    const items: ManualItem[] = []
    await expect(
      runPushers(items, [
        async (b) => {
          b.push(item('https://a.example.com'))
        },
        async () => {
          throw new Error('boom')
        },
      ]),
    ).rejects.toThrow('boom')
  })
})

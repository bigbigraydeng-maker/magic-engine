/**
 * 自动接主页的测试。
 *
 * 这里每一条都单独钉一道闸 —— 因为这些闸是**串着**的，只测「正常路径能绑上」的话，
 * 把任何一道闸拆掉测试都还是绿的。而这些闸拦的是「把陌生主页写进客户档案」，
 * 绑错 = 读了别人的收件箱。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn() }))
vi.mock('@/lib/meta/page-posts', () => ({ listManagedPages: vi.fn() }))

import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listManagedPages } from '@/lib/meta/page-posts'
import { autoBindClientPage, discoverAdAccountPages } from '../page-discovery'
import { makeFakeSupabase } from './fake-supabase'

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

const OZTOP = {
  id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84',
  name: 'oztop',
  meta_ad_account_id: 'act_1735240120460765',
  facebook_page_id: null,
}

/** 只建模 clients 表 —— 被测代码碰别的表就该炸。 */
function supa(rows: Array<Record<string, unknown>> = [{ ...OZTOP }]) {
  return makeFakeSupabase({ clients: { rows } })
}

function graphReturns(pages: Array<Record<string, unknown>>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: pages }),
    })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  mock(getMetaTokenForClient).mockResolvedValue('token-abc')
})

describe('discoverAdAccountPages', () => {
  it('两种来源都认：object_story_spec 和 <主页ID>_<贴文ID>', async () => {
    graphReturns([
      { creative: { object_story_spec: { page_id: '111111111111111' } } },
      { creative: { effective_object_story_id: '111111111111111_9988' } },
      { creative: { object_story_spec: { page_id: '222222222222222' } } },
      { creative: {} },
    ])

    const r = await discoverAdAccountPages('act_1', 'token-abc')
    expect(r.error).toBeNull()
    // 按广告条数倒序 —— 多候选时给人排序用
    expect(r.rows).toEqual([
      { pageId: '111111111111111', adCount: 2 },
      { pageId: '222222222222222', adCount: 1 },
    ])
  })

  it('Graph 报错时说报错，不能返回空当成「这账户没主页」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, text: async () => '(#200) permissions' })),
    )

    const r = await discoverAdAccountPages('act_1', 'token-abc')
    expect(r.error).toContain('403')
    expect(r.rows).toEqual([])
  })
})

describe('autoBindClientPage', () => {
  it('只有一个主页、而且我们能代管 → 写进 clients.facebook_page_id', async () => {
    graphReturns([{ creative: { object_story_spec: { page_id: '111111111111111' } } }])
    mock(listManagedPages).mockResolvedValue([
      { id: '111111111111111', name: 'Oztop Building Supplies' },
    ])

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, OZTOP)

    expect(r.outcome).toBe('bound')
    expect(r.pageId).toBe('111111111111111')
    expect(updates).toEqual([
      {
        table: 'clients',
        values: { facebook_page_id: '111111111111111' },
        filters: [['id', OZTOP.id]],
      },
    ])
  })

  it('主页找到了但没授权给我们 → 不写库，报「要授权」并带上主页 ID', async () => {
    graphReturns([{ creative: { object_story_spec: { page_id: '111111111111111' } } }])
    mock(listManagedPages).mockResolvedValue([{ id: '999999999999999', name: '别人的主页' }])

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, OZTOP)

    expect(r.outcome).toBe('needs_grant')
    expect(r.candidates).toEqual([
      { pageId: '111111111111111', adCount: 1, name: null, managed: false },
    ])
    expect(updates).toEqual([])
  })

  it('广告投在两个主页上 → 不替人选，不写库', async () => {
    graphReturns([
      { creative: { object_story_spec: { page_id: '111111111111111' } } },
      { creative: { object_story_spec: { page_id: '222222222222222' } } },
    ])
    mock(listManagedPages).mockResolvedValue([
      { id: '111111111111111', name: 'A' },
      { id: '222222222222222', name: 'B' },
    ])

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, OZTOP)

    expect(r.outcome).toBe('ambiguous')
    expect(r.candidates).toHaveLength(2)
    expect(updates).toEqual([])
  })

  it('Graph 只翻了一半就报错 → 绝不能拿半截结果当「只有一个主页」去绑', async () => {
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call++
        if (call === 1) {
          return {
            ok: true,
            json: async () => ({
              data: [{ creative: { object_story_spec: { page_id: '111111111111111' } } }],
              paging: { next: 'https://graph.facebook.com/next' },
            }),
          }
        }
        return { ok: false, status: 500, text: async () => 'oops' }
      }),
    )
    mock(listManagedPages).mockResolvedValue([{ id: '111111111111111', name: 'Oztop' }])

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, OZTOP)

    expect(r.outcome).toBe('graph_error')
    expect(updates).toEqual([])
  })

  it('问不到「我们能代管哪些主页」→ 也不绑（这是我们的故障，不是客户没授权）', async () => {
    graphReturns([{ creative: { object_story_spec: { page_id: '111111111111111' } } }])
    mock(listManagedPages).mockResolvedValue(null)

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, OZTOP)

    expect(r.outcome).toBe('graph_error')
    expect(updates).toEqual([])
  })

  it('没有可用令牌 → 说没令牌，不说「这账户没主页」', async () => {
    mock(getMetaTokenForClient).mockResolvedValue(null)

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, OZTOP)

    expect(r.outcome).toBe('no_token')
    expect(updates).toEqual([])
  })

  it('本来就绑好了 → 一个 Graph 请求都不发，也不重写', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { client, updates } = supa()
    const r = await autoBindClientPage(client, { ...OZTOP, facebook_page_id: '1616575215312482' })

    expect(r.outcome).toBe('already_bound')
    expect(r.pageId).toBe('1616575215312482')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(updates).toEqual([])
  })
})

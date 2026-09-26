/**
 * 「全部客人」这一页要接住今日待办下发的**直达链接**。
 *
 * 🔴 人工任务的三件套是 what / how / href（CLAUDE.md 铁律 3），href 必须是
 * **直达**。「可能被误判成永久拒联」那条任务的 href 是
 * `/crm/all?contact=<id>`，而这页原先根本不读这个参数 —— 点进来只是打开
 * 整张 583 行的表，FDE 还得自己搜名字，进来了也找不到任务里说的那个按钮
 * （取消控件当时只长在另一页的抽屉里）。
 *
 * 照着做也做不成的人工任务，比不下发更糟：FDE 白跑一趟，第二天任务又冒出来。
 * 所以这两件事都得钉死：**自动展开到那个人** + **那个人身上有取消入口**。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import CrmAllContactsPage from '../page'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'cts' }),
}))

interface Row {
  contactId: string
  name: string
  doNotContact?: boolean
}

const contact = (id: string, name: string, over: Partial<Row> = {}) => ({
  contactId: id,
  name,
  firstSeenAt: '2026-06-01T00:00:00Z',
  lastTouchAt: '2026-08-01T00:00:00Z',
  phone: null,
  email: 'x@example.com',
  hasMessenger: false,
  stage: null,
  stageLabel: null,
  segment: 'nurture',
  segmentLabel: '慢慢养',
  temperature: 'cold',
  custom: {},
  ...over,
})

/**
 * 列表 / 阶段 / 时间线三个接口都要有人应答，否则页面停在「加载中」。
 * 列表接口的返回形状跟着 C1a 服务端分页（PR #2002）走：`items` / `total` / `page` / `perPage` / `columns`。
 * 桩的形状一旦跟页面读的键对不上，5 个用例会一起静默变红——2026-09-26 就是这么发现的。
 */
function stubFetch(contacts: ReturnType<typeof contact>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/crm/contacts?') || url.endsWith('/crm/contacts')) {
        return { ok: true, json: async () => ({ items: contacts, total: contacts.length, page: 1, perPage: 100, columns: [] }) }
      }
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
      }
      return { ok: true, json: async () => ({ stages: [] }) }
    }),
  )
}

const setUrl = (search: string) => {
  window.history.replaceState({}, '', `/dashboard/clients/cts/crm/all${search}`)
}

beforeEach(() => {
  // scrollIntoView 在 jsdom 里不存在 —— 不补的话展开后直接抛。
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUrl('')
})

describe('?contact=<id> 直达链接', () => {
  it('自动展开那个人 —— 不用 FDE 自己在表里找', async () => {
    stubFetch([contact('c1', 'Sue Masson'), contact('c2', 'Bob Other')])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    // 展开区独有的小标题：没展开就不该出现。
    await waitFor(() => expect(screen.getByText('往来记录')).toBeTruthy())
    expect(screen.getByText(/还没有任何往来记录/)).toBeTruthy()
  })

  it('没带参数就谁都不展开 —— 别打扰只想翻表的人', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText('Sue Masson')).toBeTruthy())
    expect(screen.queryByText('往来记录')).toBeNull()
  })

  it('人不在这份名单里 → 明说，别一声不吭让人以为链接坏了', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('?contact=gone')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText(/不在这份名单里了/)).toBeTruthy())
  })
})

describe('被误判成「别再联系」的人，这一页要给得出取消入口', () => {
  it('展开后看得到取消入口 —— 人工任务说的那个按钮就是它', async () => {
    stubFetch([contact('c1', 'Sue Masson', { doNotContact: true })])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText(/判错了？点这里放回名单/)).toBeTruthy())
  })

  it('没被标的人不给这个入口 —— 多一个按钮就多一次误伤', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText('往来记录')).toBeTruthy())
    expect(screen.queryByText(/判错了？点这里放回名单/)).toBeNull()
  })
})

/**
 * 分段视图（WP3 R7）。
 *
 * 这一页原本是一张平铺的大表，按「最近联系时间」排——**谁该先被联系看不出来**。
 * 分段视图把同一份名单按「先联系谁」切成 4 段，口径跟「今天要联系」那一页共用
 * 同一套 segmentContact，不是这一页自己另算一遍。
 *
 * 🔴 这里钉死的是「看得见」这件事本身：2026-08-02 出过一次段没登记导致 33 个人
 * 从名单上凭空消失、谁都没发现的事故。所以**收起来的段也必须显示段头和人数**——
 * 人数是服务端给的 total，不是当前拿到几行；段是空的要明说「这一段现在没有人」，
 * 不能渲染成一片空白让人以为加载坏了。
 */
describe('按「先联系谁」分段视图', () => {
  interface StubSection {
    key: string
    title: string
    hint: string
    total: number
    open: boolean
    items: ReturnType<typeof contact>[] | null
  }

  /** 分段接口的假返回。收起来的段 items=null（跟服务端一致，不下发那一段的行）。 */
  function stubPriority(
    sections: StubSection[],
    focus: { found: boolean; section?: string; page?: number } = { found: false },
  ) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/crm/contacts')) {
          calls.push(url)
          if (url.includes('view=priority')) {
            return {
              ok: true,
              json: async () => ({ view: 'priority', focus, columns: [], sections }),
            }
          }
          return {
            ok: true,
            json: async () => ({ items: [], total: 0, page: 1, perPage: 100, columns: [] }),
          }
        }
        if (url.includes('/timeline')) {
          return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    return calls
  }

  const SECTIONS = (): StubSection[] => [
    {
      key: 'waiting',
      title: '客人在等你',
      hint: '今天必须有人回',
      total: 2,
      open: true,
      items: [contact('w1', 'Sue Masson'), contact('w2', 'Bob Other')],
    },
    {
      key: 'acted',
      title: '还没搭上话',
      hint: '要你主动出击',
      total: 1,
      open: true,
      items: [contact('a1', 'Ann New')],
    },
    {
      key: 'queued',
      title: '先放着，系统盯着',
      hint: '他一开口会自己跳回来',
      total: 7,
      open: false,
      items: null,
    },
    {
      key: 'off_list',
      title: '不在今天名单',
      hint: '以后才走 / 已成交',
      total: 3,
      open: false,
      items: null,
    },
  ]

  it('点「按先联系谁分段」→ 改成问分段接口要数据', async () => {
    const calls = stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))

    await waitFor(() => expect(calls.some((u) => u.includes('view=priority'))).toBe(true))
  })

  it('四段的段名和人数都露出来 —— 收起来的段也要露，不然又是「人凭空消失」', async () => {
    stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))

    await waitFor(() => expect(screen.getByText('客人在等你')).toBeTruthy())
    expect(screen.getByText('还没搭上话')).toBeTruthy()
    expect(screen.getByText('先放着，系统盯着')).toBeTruthy()
    expect(screen.getByText('不在今天名单')).toBeTruthy()
    // 人数认服务端的 total，不是当前这一页拿到几行 —— 收起来的段一行都没拿到。
    expect(screen.getByText('7 人')).toBeTruthy()
    expect(screen.getByText('3 人')).toBeTruthy()
  })

  it('展开的段显示它的人；收起来的段一行都不显示', async () => {
    stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))

    await waitFor(() => expect(screen.getByText('Sue Masson')).toBeTruthy())
    expect(screen.getByText('Ann New')).toBeTruthy()
    // queued / off_list 是 items=null：没有行，也不该冒出「这一段现在没有人」
    expect(screen.queryByText('这一段现在没有人。')).toBeNull()
  })

  it('点段头 → 把那一段加进 open 重新要数据', async () => {
    const calls = stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))
    await waitFor(() => expect(screen.getByText('先放着，系统盯着')).toBeTruthy())
    fireEvent.click(screen.getByText('先放着，系统盯着'))

    await waitFor(() =>
      expect(calls.some((u) => u.includes('open=') && u.includes('queued'))).toBe(true),
    )
  })

  it('展开了但这一段没人 → 明说「这一段现在没有人」，不是一片空白', async () => {
    stubPriority([
      { key: 'waiting', title: '客人在等你', hint: 'h1', total: 0, open: true, items: [] },
      { key: 'acted', title: '还没搭上话', hint: 'h2', total: 0, open: false, items: null },
      { key: 'queued', title: '先放着，系统盯着', hint: 'h3', total: 0, open: false, items: null },
      { key: 'off_list', title: '不在今天名单', hint: 'h4', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))

    await waitFor(() => expect(screen.getByText('这一段现在没有人。')).toBeTruthy())
  })

  it('直达链接落在收起来的段里 → 自动把那一段打开，别让人点进来什么都看不到', async () => {
    const calls = stubPriority(SECTIONS(), { found: true, section: 'off_list', page: 1 })
    setUrl('?contact=z9')
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))

    await waitFor(() =>
      expect(calls.some((u) => u.includes('open=') && u.includes('off_list'))).toBe(true),
    )
  })

  it('再点一次 → 回平铺，不再问分段接口', async () => {
    const calls = stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/按「先联系谁」分段/))
    await waitFor(() => expect(screen.getByText('客人在等你')).toBeTruthy())
    const before = calls.length

    fireEvent.click(screen.getByText(/回到平铺名单/))

    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
    expect(calls[calls.length - 1]).not.toContain('view=priority')
  })
})

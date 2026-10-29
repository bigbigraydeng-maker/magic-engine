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
  email?: string | null
  lastTouchAt?: string | null
  stageLabel?: string | null
  nextAction: { list: 'hot' | 'cold'; verb: string; verbLabel: string; line: string; reason: string; aiSuggestion: string | null; intentBoost: boolean }
  intent: 'high' | 'medium' | 'low' | 'unknown' | null
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
  nextAction: { list: 'cold', verb: 'system_watching', verbLabel: '系统盯着', line: '系统盯着 —— 聊过一轮断了', reason: '聊过一轮断了', aiSuggestion: null, intentBoost: false },
  intent: null,
  // 真实响应里这个键**永远存在**（`responseRowFor` 无条件返回 `pinnedAt: c.pinned_at`）。
  // 漏了它，`row.pinnedAt === null` 会是 false（因为是 undefined），点⭐变成「取消置顶」——
  // fixture 比真接口少一个键，测的就不是线上那条路了。
  pinnedAt: null,
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
  // 这页默认进「今天先联系」；下面绝大多数用例测的是平铺名单，所以默认钉在 ?view=all。
  setUrl('?view=all')
})
afterEach(() => {
  vi.unstubAllGlobals()
  setUrl('?view=all')
})

describe('?contact=<id> 直达链接', () => {
  it('自动展开那个人 —— 不用 FDE 自己在表里找', async () => {
    stubFetch([contact('c1', 'Sue Masson'), contact('c2', 'Bob Other')])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    // 抽屉独有的小标题：没打开就不该出现。
    await waitFor(() => expect(screen.getByText('往来记录')).toBeTruthy())
    // 2026-09-28 B2：详情换成 PersonDrawer 之后，空状态文案是 ContactTimeline 那份
    // （"还没有往来记录。"），不再是已删除的 ContactDetail 那份（"还没有任何往来记录"）。
    await waitFor(() => expect(screen.getByText(/还没有往来记录/)).toBeTruthy())
  })

  it('没带参数就谁都不展开 —— 别打扰只想翻表的人', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('?view=all')
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

describe('?contact=<id> 的人不在第一页（付款总览点名字）', () => {
  it('带着名字来 → 按名字搜出来再开抽屉，不再提示「不在名单里」', async () => {
    const first = [contact('c1', 'Bob Other')]
    const found = [contact('c9', 'Aiitha Chandra')]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/crm/contacts?') || url.endsWith('/crm/contacts')) {
          const items = url.includes('q=Aiitha') ? found : first
          return { ok: true, json: async () => ({ items, total: items.length, page: 1, perPage: 100, columns: [] }) }
        }
        if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    window.sessionStorage.setItem('crm-deeplink-name:cts:c9', 'Aiitha Chandra')
    setUrl('?contact=c9&focus=bookings')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText('往来记录')).toBeTruthy(), { timeout: 4000 })
    expect(screen.queryByText(/不在这份名单里了/)).toBeNull()
    // 名字用完即删：之后手动点别人不会被它拽回来。
    expect(window.sessionStorage.getItem('crm-deeplink-name:cts:c9')).toBeNull()
  })

  it('没带名字（存储被拦）→ 仍明说不在名单里，不装作成功', async () => {
    stubFetch([contact('c1', 'Bob Other')])
    setUrl('?contact=c9&focus=bookings')
    render(<CrmAllContactsPage />)
    await waitFor(() => expect(screen.getByText(/不在这份名单里了/)).toBeTruthy())
  })
})

describe('平铺名单每页 50 人', () => {
  it('请求带 perPage=50，页脚按 50 算总页数', async () => {
    const contacts = Array.from({ length: 3 }, (_, i) => contact(`c${i}`, `Guest ${i}`))
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        if (url.includes('/crm/contacts?')) {
          return { ok: true, json: async () => ({ items: contacts, total: 120, page: 1, perPage: 50, columns: [] }) }
        }
        if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    setUrl('?view=all')
    render(<CrmAllContactsPage />)
    await waitFor(() => expect(screen.getByText('Guest 0')).toBeTruthy())
    expect(urls.some((u) => u.includes('perPage=50'))).toBe(true)
    expect(urls.some((u) => u.includes('perPage=100'))).toBe(false)
    expect(screen.getByText(/共 120 人 · 第 1 \/ 3 页/)).toBeTruthy()
  })
})

describe('搜索框', () => {
  it('敲字触发重新加载时，输入框不被卸载（焦点不丢，不像整页刷新）', async () => {
    let release: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/crm/contacts?') || url.endsWith('/crm/contacts')) {
          if (url.includes('q=Sue')) await new Promise<void>((r) => { release = r })
          const items = [contact('c1', 'Sue Masson')]
          return { ok: true, json: async () => ({ items, total: 1, page: 1, perPage: 100, columns: [] }) }
        }
        if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    setUrl('?view=all')
    render(<CrmAllContactsPage />)
    const input = (await screen.findByPlaceholderText(/客户打回来了/)) as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'Sue' } })
    // 防抖 300ms 后请求发出、页面进入加载中
    await waitFor(() => expect(release).not.toBeNull(), { timeout: 3000 })
    expect(input.isConnected).toBe(true)
    expect(screen.getByPlaceholderText(/客户打回来了/)).toBe(input)
    expect(document.activeElement).toBe(input)
    release!()
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

describe('最后一列：平铺看阶段，Magic Engine 智能看「该做什么」', () => {
  it('平铺名单：最后一列是「到哪一步了」，显示阶段；没标的写「还没标」', async () => {
    stubFetch([
      contact('c1', 'Sue Masson', {
        stageLabel: '已报价',
        nextAction: { list: 'hot', verb: 'call', verbLabel: '打给他', line: '打给他 —— 刚留资料', reason: '刚留资料', aiSuggestion: null, intentBoost: false },
      }),
      contact('c2', 'Bob Other', { stageLabel: null }),
    ])
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText('Sue Masson')).toBeTruthy())
    expect(screen.getByText('到哪一步了')).toBeTruthy()
    expect(screen.getByText('已报价')).toBeTruthy()
    expect(screen.getByText('还没标')).toBeTruthy()
    expect(screen.queryByText('该做什么')).toBeNull()
    expect(screen.queryByText('打给他')).toBeNull()
  })

  it('Magic Engine 智能：最后一列才是「该做什么」', async () => {
    stubPriority([
      {
        key: 'hot',
        title: '今天要联系',
        hint: 'h',
        total: 1,
        open: true,
        items: [
          contact('c1', 'Sue Masson', {
            stageLabel: '已报价',
            nextAction: { list: 'hot', verb: 'call', verbLabel: '打给他', line: '打给他 —— 刚留资料', reason: '刚留资料', aiSuggestion: null, intentBoost: false },
          }),
        ],
      },
      { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))

    await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())
    expect(screen.getByText('该做什么')).toBeTruthy()
    expect(screen.queryByText('到哪一步了')).toBeNull()
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
// 分段接口的假返回 —— 两个 describe 共用，所以放在模块层。
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
            /**
             * 🔴 只有请求里**真的带了** `contact=` 才回 focus。
             *
             * 第一版无条件回 focus，于是把页面转发 `?contact=` 那两行整块删掉，
             * 「直达链接落在收起来的段里 → 自动展开」那条测试**照旧绿**（魏征变异 M11
             * 实测存活）：页面是从一个它压根没请求过的 focus 响应里把段打开的。
             * 假服务端比真服务端宽松，测试就会在真链路断掉时保持绿色。
             */
            const asked = new URL(url, 'https://x.test').searchParams.get('contact')
            return {
              ok: true,
              json: async () => ({
                view: 'priority',
                focus: asked ? focus : { found: false },
                columns: [],
                sections,
              }),
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

describe('按「先联系谁」分段视图', () => {

  const SECTIONS = (): StubSection[] => [
    {
      key: 'hot',
      title: '今天要联系',
      hint: '今天必须有人回',
      total: 2,
      open: true,
      items: [contact('w1', 'Sue Masson'), contact('w2', 'Bob Other')],
    },
    {
      key: 'cold',
      title: '先放着',
      hint: '以后才走 / 已成交',
      total: 3,
      open: false,
      items: null,
    },
  ]

  it('点「Magic Engine 智能」→ 改成问分段接口要数据', async () => {
    const calls = stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))

    await waitFor(() => expect(calls.some((u) => u.includes('view=priority'))).toBe(true))
  })

  it('两张名单的段名和人数都露出来 —— 收起来的段也要露，不然又是「人凭空消失」', async () => {
    stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))

    await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())
    expect(screen.getByText('先放着')).toBeTruthy()
    // 人数认服务端的 total，不是当前这一页拿到几行 —— 收起来的段一行都没拿到。
    expect(screen.getByText('2 人')).toBeTruthy()
    expect(screen.getByText('3 人')).toBeTruthy()
  })

  it('展开的段显示它的人；收起来的段一行都不显示', async () => {
    stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))

    await waitFor(() => expect(screen.getByText('Sue Masson')).toBeTruthy())
    // cold 是 items=null：没有行，也不该冒出「这一段现在没有人」
    expect(screen.queryByText('这一段现在没有人。')).toBeNull()
  })

  it('点段头 → 把那一段加进 open 重新要数据', async () => {
    const calls = stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))
    await waitFor(() => expect(screen.getByText('先放着')).toBeTruthy())
    fireEvent.click(screen.getByText('先放着'))

    await waitFor(() =>
      expect(calls.some((u) => u.includes('open=') && u.includes('cold'))).toBe(true),
    )
  })

  it('展开了但这一段没人 → 明说「这一段现在没有人」，不是一片空白', async () => {
    stubPriority([
      { key: 'hot', title: '今天要联系', hint: 'h1', total: 0, open: true, items: [] },
      { key: 'cold', title: '先放着', hint: 'h4', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))

    await waitFor(() => expect(screen.getByText('这一段现在没有人。')).toBeTruthy())
  })

  it('直达链接落在收起来的段里 → 自动把那一段打开，别让人点进来什么都看不到', async () => {
    const calls = stubPriority(SECTIONS(), { found: true, section: 'cold', page: 1 })
    setUrl('?contact=z9')
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))

    await waitFor(() =>
      expect(calls.some((u) => u.includes('open=') && u.includes('cold'))).toBe(true),
    )
  })

  it('再点一次 → 回平铺，不再问分段接口', async () => {
    const calls = stubPriority(SECTIONS())
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText(/回到「今天先联系」/))
    await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())
    const before = calls.length

    fireEvent.click(screen.getByText(/看全部客人/))

    await waitFor(() => expect(calls.length).toBeGreaterThan(before))
    expect(calls[calls.length - 1]).not.toContain('view=priority')
  })
})

/**
 * 魏征复审（2026-09-27）重做变异时存活下来的那几条，逐个补上。
 *
 * 存活 = 把对应功能改坏，原有 7 条测试全都不变红。它们当时只验了「页面忠实地画出
 * 接口给的东西」，没验「接口给的东西就是人该看到的全部」——两个复审都指出这正是
 * 2026-08-02「人数对、人不在」那次事故没被拦住的原因。
 */
describe('分段视图 · 复审补测', () => {
  interface StubSection {
    key: string
    title: string
    hint: string
    total: number
    open: boolean
    items: ReturnType<typeof contact>[] | null
  }

  function stubSections(sections: StubSection[], focus: { found: boolean; section?: string } = { found: false }) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (url.includes('/pin')) return { ok: true, json: async () => ({ ok: true }) }
        if (url.includes('/crm/contacts')) {
          calls.push(`${init?.method ?? 'GET'} ${url}`)
          if (url.includes('view=priority')) {
            const asked = new URL(url, 'https://x.test').searchParams.get('contact')
            return { ok: true, json: async () => ({ view: 'priority', focus: asked ? focus : { found: false }, columns: [], sections }) }
          }
          return { ok: true, json: async () => ({ items: [], total: 0, page: 1, perPage: 100, columns: [] }) }
        }
        if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    return calls
  }

  const goGrouped = async () => fireEvent.click(await screen.findByText(/回到「今天先联系」/))

  /** M6：每段的人一个都不能少画。原来只比「画出来的 vs items 条数」，两边一起少就发现不了。 */
  it('M6 · 这一段下发了几个人，就必须画出几个人', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 3, open: true,
        items: [contact('w1', 'Aaa One'), contact('w2', 'Bbb Two'), contact('w3', 'Ccc Three')] },
      { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('Aaa One')).toBeTruthy())
    expect(screen.getByText('Bbb Two')).toBeTruthy()
    expect(screen.getByText('Ccc Three')).toBeTruthy()
  })

  /** B5（2026-09-28）：段头旁边显示"今天进度"——今天联系过的人 vs 还没碰的人。 */
  describe('B5 · 段头「今天进度」', () => {
    it('段里有人今天联系过、有人没有 → 显示"今天动过 X · 还剩 Y"', async () => {
      const today = new Date().toISOString()
      stubSections([
        {
          key: 'hot',
          title: '今天要联系',
          hint: 'h',
          total: 2,
          open: true,
          items: [
            contact('w1', 'Aaa One', { lastTouchAt: today }),
            contact('w2', 'Bbb Two', { lastTouchAt: '2020-01-01T00:00:00Z' }),
          ],
        },
        { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
      ])
      render(<CrmAllContactsPage />)
      await goGrouped()
      await waitFor(() => expect(screen.getByText(/今天动过 1 · 还剩 1/)).toBeTruthy())
    })

    it('段里今天全处理过了 → 显示"今天都过了一遍 ✓"', async () => {
      const today = new Date().toISOString()
      stubSections([
        {
          key: 'hot',
          title: '今天要联系',
          hint: 'h',
          total: 1,
          open: true,
          items: [contact('w1', 'Aaa One', { lastTouchAt: today })],
        },
        { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
      ])
      render(<CrmAllContactsPage />)
      await goGrouped()
      await waitFor(() => expect(screen.getByText(/今天都过了一遍/)).toBeTruthy())
    })

    it('段是收起的（items=null）→ 不显示进度，不能拿 0 冒充"今天一个都没处理"', async () => {
      stubSections([
        { key: 'hot', title: '今天要联系', hint: 'h', total: 5, open: false, items: null },
        { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
      ])
      render(<CrmAllContactsPage />)
      await goGrouped()
      await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())
      expect(screen.queryByText(/今天动过/)).toBeNull()
      expect(screen.queryByText(/今天都过了一遍/)).toBeNull()
    })
  })

  /**
   * B1（两个复审都判 BLOCKER）：段头写 217 人、表里只有 100 行时，
   * 页面必须**说出来**还有多少人没显示，并且给得出翻页入口。
   */
  it('B1 · 段里的人没显示完，必须说清还有多少 + 给得出翻页', async () => {
    const many = Array.from({ length: 100 }, (_, i) => contact(`w${i}`, `Person ${i}`))
    const calls = stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 217, open: true, items: many },
      { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())

    // 必须显式说出「共 217 人、现在看的是第几到第几」，不能只写 217 然后画 100 行。
    expect(screen.getByText(/共 217 人/)).toBeTruthy()
    expect(screen.getByText(/第 1–100 个/)).toBeTruthy()
    expect(screen.getByText(/第 1 \/ 3 页/)).toBeTruthy()

    // 而且翻得过去 —— 点下一页要真的把 p_hot=2 发出去。
    fireEvent.click(screen.getByText('下一页'))
    await waitFor(() => expect(calls.some((c) => c.includes('p_hot=2'))).toBe(true))
  })

  /** 人数不超过一页时不该冒出翻页控件 —— 多一个没用的控件就多一次误解。 */
  it('B1 · 一页装得下就不显示翻页', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 2, open: true,
        items: [contact('w1', 'Aaa One'), contact('w2', 'Bbb Two')] },
      { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('Aaa One')).toBeTruthy())
    expect(screen.queryByText('下一页')).toBeNull()
  })

  /**
   * M7：「收起来的段一行都不显示」原来是 fixture 的 items:null 撑出来的绿，
   * 不是代码里那道 open 守卫撑出来的。这里给一个**收起但带 items** 的段，
   * 只有真的看 open 才会通过。
   */
  it('M7 · 段是收起的，就算数据在手上也不许画出来', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 1, open: true, items: [contact('w1', 'Shown Person')] },
      { key: 'cold', title: '先放着', hint: 'h', total: 1, open: false, items: [contact('a1', 'Hidden Person')] },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('Shown Person')).toBeTruthy())
    expect(screen.queryByText('Hidden Person')).toBeNull()
  })

  /** M8 / M12：▾▸、aria-expanded、那句说明文字，原来一处都没被断言。 */
  it('M8 · 展开和收起的段头，箭头和 aria-expanded 要分得开', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: '今天必须有人回', total: 1, open: true, items: [contact('w1', 'Aaa One')] },
      { key: 'cold', title: '先放着', hint: '以后才走 / 已成交', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())

    const openHead = screen.getByText('今天要联系').closest('button')
    const shutHead = screen.getByText('先放着').closest('button')
    expect(openHead?.getAttribute('aria-expanded')).toBe('true')
    expect(shutHead?.getAttribute('aria-expanded')).toBe('false')
    expect(openHead?.textContent).toContain('▾')
    expect(shutHead?.textContent).toContain('▸')
    // M12：段头那句人话说明不能悄悄消失
    expect(openHead?.textContent).toContain('今天必须有人回')
    expect(shutHead?.textContent).toContain('以后才走 / 已成交')
  })

  /** B3：分段模式下点⭐，星星必须当场亮 —— 只更新 rows 的那一版永远不亮。 */
  it('B3 · 分段模式下点⭐，星星当场就要变', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 1, open: true, items: [contact('w1', 'Aaa One')] },
      { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('Aaa One')).toBeTruthy())

    /**
     * 🔴 认 aria-label，不认 ⭐ 这个字符。
     *
     * 第一版写的是 `getAllByText('⭐').length > 0` —— 表头那一列的标题**本身就是「⭐」**，
     * 所以这个断言恒真：把 togglePin 里更新 sections 那段删掉，测试照旧绿（实测存活）。
     * 星星的 aria-label 会在「置顶 / 取消置顶」之间翻，那才是真的状态。
     */
    const row = document.getElementById('contact-w1')
    expect(row).toBeTruthy()
    const star = row!.querySelector('button[aria-label="置顶"]')
    expect(star).toBeTruthy()
    fireEvent.click(star!)
    await waitFor(() =>
      expect(
        document.getElementById('contact-w1')!.querySelector('button[aria-label="取消置顶"]'),
      ).toBeTruthy(),
    )
  })

  /** C3：四段全收起时不许冒出「大家的跟进到哪步都还空着」。 */
  it('C3 · 全部收起时不许说「大家阶段都空着」这种假话', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 5, open: false, items: null },
      { key: 'cold', title: '先放着', hint: 'h', total: 5, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('今天要联系')).toBeTruthy())
    expect(screen.queryByText(/都还空着/)).toBeNull()
  })

  /** B2：分段模式下表头不许假装能排序。 */
  it('B2 · 分段模式下表头没有排序箭头、点了也不该有排序入口', async () => {
    stubSections([
      { key: 'hot', title: '今天要联系', hint: 'h', total: 1, open: true, items: [contact('w1', 'Aaa One')] },
      { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
    ])
    render(<CrmAllContactsPage />)
    await goGrouped()
    await waitFor(() => expect(screen.getByText('Aaa One')).toBeTruthy())
    // 分段模式的表头一个都不能排序（含 2026-10-30 新加的 进线 / 最近联系 列）
    expect(screen.getByText('该做什么').closest('th')?.className).not.toContain('cursor-pointer')
    expect(screen.getByText('最近联系').closest('th')?.className).not.toContain('cursor-pointer')
    expect(screen.getByText('进线').closest('th')?.className).not.toContain('cursor-pointer')
    // 而且要有一句话说明段内按什么排，别让人以为能自己排
    expect(screen.getByText(/点表头不改顺序/)).toBeTruthy()
  })
})

/**
 * 阶段变更那一行：员工必须看得出「是谁判的」+「凭什么判的」。
 *
 * 🔴 改之前这一行只显示理由、不显示是谁判的；另一页反过来（显示是谁判的、
 * 却把 `ai:conversation-read` 这串内部字符串原样给销售看，还把理由丢了）。
 * 生产上 972 次阶段变更里 972 次是 AI 判的、972 次都写了理由和客人原话 ——
 * 员工一次都看不到完整的一条。
 *
 * PM 2026-09-27 的方向是「让大模型根据互动痕迹判断并给建议」。判得再准，
 * 看不到凭据就不会有人信 —— 记忆里那条更狠：「不给凭据的一键执行，按两次就没人敢按」。
 */
describe('阶段变更那一行 · 谁判的 + 凭什么', () => {
  /** 一条真实形状的 AI 判断（文案照抄生产库里那 972 条的格式）。 */
  const aiStageEntry = {
    kind: 'stage' as const,
    at: '2026-09-24T02:00:00Z',
    fromStage: null,
    toStage: 'contacted',
    fromLabel: null,
    toLabel: '已联系',
    changedBy: 'ai:conversation-read',
    note: '读往来记录判的：客户对旅游信息感兴趣，已经联系。｜原话：「Hello! I filled out your form」',
  }
  const humanStageEntry = {
    kind: 'stage' as const,
    at: '2026-09-25T02:00:00Z',
    fromStage: 'contacted',
    toStage: 'quoted',
    fromLabel: '已联系',
    toLabel: '已报价',
    changedBy: 'info@ctstours.co.nz',
    note: null,
  }

  function stubWithTimeline(timeline: unknown[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/timeline')) {
          return { ok: true, json: async () => ({ timeline, omittedMessages: 0 }) }
        }
        if (url.includes('/crm/contacts')) {
          return {
            ok: true,
            json: async () => ({
              items: [contact('c1', 'Sue Masson')],
              total: 1,
              page: 1,
              perPage: 100,
              columns: [],
            }),
          }
        }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
  }

  it('AI 判的那一条：说人话说出是谁判的，绝不把内部代号给员工看', async () => {
    stubWithTimeline([aiStageEntry])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    // 往来只有一条：全部直接摆出来（超过 5 条才折叠，且那时的按钮写「看更早的往来」）
    await waitFor(() => expect(screen.getByText(/系统读往来记录判的/)).toBeTruthy())
    // 🔴 这一条是重点：`ai:conversation-read` 一个字都不许出现在屏幕上
    expect(screen.queryByText(/ai:conversation-read/)).toBeNull()
    expect(document.body.textContent).not.toContain('ai:conversation-read')
  })

  it('凭据要显示出来，而且客人原话不能被吃掉', async () => {
    stubWithTimeline([aiStageEntry])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText(/客户对旅游信息感兴趣/)).toBeTruthy())
    // 客人自己说的那句话是最硬的凭据，必须留着
    expect(document.body.textContent).toContain('Hello! I filled out your form')
    // 「谁判的」那一格已经说过一遍了，理由里的同一句开头要剥掉，别说两遍
    expect(document.body.textContent).not.toContain('读往来记录判的：客户对旅游信息')
  })

  it('真人改的那一条：显示是谁改的，不假装有凭据', async () => {
    stubWithTimeline([humanStageEntry])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)

    await waitFor(() => expect(screen.getByText(/info 改的/)).toBeTruthy())
    // 生产上真人改的那 12 条 note 全是空的 —— 人不解释自己，界面也别编一个理由出来
    expect(document.body.textContent).not.toContain('系统读往来记录判的')
    // 整个邮箱太长，只显示前缀
    expect(document.body.textContent).not.toContain('info@ctstours.co.nz')
  })
})

/**
 * B2（2026-09-28）：抽屉的「上一位/下一位」跨页翻页那条路——魏征复审点名这一段
 * 状态机（buildNavInput/goNav/pendingNav）没有集成测试锁住，纯函数测试 + 组件渲染
 * 测试只能间接兜底，`loadList` 的 setState 顺序以后改起来容易无声撞坏。
 * 这里锁住最核心的一条：平铺模式翻到下一页后，自动打开新一页的第一个人。
 */
describe('B2 · 抽屉「下一位」跨页翻页（平铺模式）', () => {
  function stubTwoPages() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        // 🔴 /timeline 的网址本身就含 "/crm/contacts"（.../crm/contacts/<id>/timeline）——
        // 这个分支必须排在前面，否则往来记录请求会被当成列表请求接住，
        // ContactTimeline 拿到一份没有 `timeline` 字段的响应，直接抛异常炸掉整棵树。
        if (url.includes('/timeline')) {
          return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        }
        if (url.includes('/crm/contacts?') || url.endsWith('/crm/contacts')) {
          const page = new URL(url, 'https://x.test').searchParams.get('page')
          if (page === '2') {
            return {
              ok: true,
              json: async () => ({
                items: [contact('p2c1', 'Page Two Person')],
                total: 101,
                page: 2,
                perPage: 100,
                columns: [],
              }),
            }
          }
          return {
            ok: true,
            json: async () => ({
              items: [contact('p1last', 'Page One Last')],
              total: 101,
              page: 1,
              perPage: 100,
              columns: [],
            }),
          }
        }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
  }

  it('本页最后一个人点「下一位」→ 翻页 → 自动打开新一页第一个人', async () => {
    stubTwoPages()
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText('Page One Last'))
    await screen.findByText('往来记录')

    fireEvent.click(screen.getByText('下一位 →'))

    // 翻页期间是异步的——mock fetch 几乎同步 resolve，"按钮先禁用" 这个中间态在
    // 这里测不稳（PersonDrawer.test.tsx 的 nav.busy 单测已经单独锁住这一档），
    // 这条测试锁住的是最终结果：新一页拉回来之后自动打开第一个人。
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Page Two Person' })).toBeTruthy())
  })
})

/**
 * B3（2026-09-28）：终端客户 / 同行筛选 + 批量发邮件。
 */
describe('B3 · 终端客户/同行筛选 + 批量发邮件', () => {
  function stubKind() {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/crm/contacts')) {
          calls.push(url)
          const kind = new URL(url, 'https://x.test').searchParams.get('kind')
          if (kind === 'trade') {
            return {
              ok: true,
              json: async () => ({
                items: [contact('t1', 'Trade Tom', { email: 'tom@hot.co.nz' })],
                total: 1,
                page: 1,
                perPage: 100,
                columns: [],
              }),
            }
          }
          return {
            ok: true,
            json: async () => ({ items: [contact('r1', 'Retail Rita')], total: 1, page: 1, perPage: 100, columns: [] }),
          }
        }
        if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    return calls
  }

  it('点「🤝 同行」→ 请求带 ?kind=trade，列表换成同行那批人', async () => {
    const calls = stubKind()
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')

    fireEvent.click(screen.getByText('🤝 同行'))

    await waitFor(() => expect(screen.getByText('Trade Tom')).toBeTruthy())
    expect(calls.some((u) => u.includes('kind=trade'))).toBe(true)
  })

  it('点「终端客户」→ 请求带 ?kind=retail', async () => {
    const calls = stubKind()
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')

    fireEvent.click(screen.getByText('终端客户'))

    await waitFor(() => expect(calls.some((u) => u.includes('kind=retail'))).toBe(true))
  })

  it('筛到「🤝 同行」之后出现批量发邮件面板', async () => {
    stubKind()
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')

    fireEvent.click(screen.getByText('🤝 同行'))

    await waitFor(() => expect(screen.getByText(/给这批发邮件/)).toBeTruthy())
  })

  /**
   * 🔴 魏征 2026-09-28 复审查出：同行超过一页时批量发邮件面板原来悄悄只发当前页，
   * 没有任何提示。钉住警示文案在这种情况下会出现。
   */
  it('同行人数超过一页 → 批量面板上方出现"只发这一页"的警示', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/crm/contacts')) {
          const kind = new URL(url, 'https://x.test').searchParams.get('kind')
          if (kind === 'trade') {
            return {
              ok: true,
              json: async () => ({
                items: [contact('t1', 'Trade Tom', { email: 'tom@hot.co.nz' })],
                total: 150, // 总数比这一页（1 条，为了测试简化）多，触发警示
                page: 1,
                perPage: 100,
                columns: [],
              }),
            }
          }
          return { ok: true, json: async () => ({ items: [contact('r1', 'Retail Rita')], total: 1, page: 1, perPage: 100, columns: [] }) }
        }
        if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
        return { ok: true, json: async () => ({ stages: [] }) }
      }),
    )
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')

    fireEvent.click(screen.getByText('🤝 同行'))

    await waitFor(() => expect(screen.getByText(/只会发给这一页看到的人/)).toBeTruthy())
  })

  it('同行一页装得下 → 不出现"只发这一页"的警示', async () => {
    stubKind()
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')

    fireEvent.click(screen.getByText('🤝 同行'))

    await waitFor(() => expect(screen.getByText(/给这批发邮件/)).toBeTruthy())
    expect(screen.queryByText(/只会发给这一页看到的人/)).toBeNull()
  })

  it('默认「全部」不出现批量发邮件面板', async () => {
    stubKind()
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')

    expect(screen.queryByText(/给这批发邮件/)).toBeNull()
  })

  it('切到分段视图 → kind 筛选按钮不再显示（服务端分段路径没接 kind）', async () => {
    stubKind()
    render(<CrmAllContactsPage />)
    await screen.findByText('Retail Rita')
    expect(screen.getByText('🤝 同行')).toBeTruthy()

    fireEvent.click(screen.getByText(/回到「今天先联系」/))

    await waitFor(() => expect(screen.queryByText('🤝 同行')).toBeNull())
  })
})

/**
 * 每天打 20 个（PM 2026-10-10）：「今天要联系」不管多少人都全列出来（人不能因为上限消失），
 * 只是第 20 个之后画一条线，写明后面是排队的。
 */
describe('今天要联系 · 每天 20 个的分界线', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => contact(`h${i + 1}`, `Person ${String(i + 1).padStart(2, '0')}`))
  const sections = (n: number) => [
    { key: 'hot', title: '今天要联系', hint: 'h', total: n, open: true, items: many(n) },
    { key: 'cold', title: '先放着', hint: 'h', total: 0, open: false, items: null },
  ]

  it('25 个人：全部画出来，线画在第 20 个之后，写明排队 5 个', async () => {
    stubPriority(sections(25))
    render(<CrmAllContactsPage />)
    fireEvent.click(await screen.findByText(/回到「今天先联系」/))
    await waitFor(() => expect(screen.getByText('Person 25')).toBeTruthy())

    const line = screen.getByTestId('quota-line')
    expect(line.textContent).toContain('今天先打这 20 个')
    expect(line.textContent).toContain('以下 5 个排队')
    const rows = Array.from(document.querySelectorAll('tbody tr'))
    const idx = rows.indexOf(line as HTMLTableRowElement)
    // 线前面正好 1 行段头 + 20 个人
    expect(rows.slice(0, idx).filter((r) => (r.textContent ?? '').includes('Person')).length).toBe(20)
    expect(rows.slice(idx + 1).filter((r) => (r.textContent ?? '').includes('Person')).length).toBe(5)
  })

  it('刚好 20 个或更少：不画线', async () => {
    stubPriority(sections(20))
    render(<CrmAllContactsPage />)
    fireEvent.click(await screen.findByText(/回到「今天先联系」/))
    await waitFor(() => expect(screen.getByText('Person 20')).toBeTruthy())
    expect(screen.queryByTestId('quota-line')).toBeNull()
  })
})

describe('默认进「今天先联系」（PM 2026-10-28）', () => {
  const calledUrls = () =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))

  it('裸进来 → 第一次请求就是分段（priority）视图，不先白发一次平铺请求', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('')
    render(<CrmAllContactsPage />)
    await waitFor(() => expect(calledUrls().some((u) => u.includes('view=priority'))).toBe(true))
    expect(calledUrls().some((u) => u.includes('/crm/contacts') && !u.includes('view=priority') && !u.includes('stage'))).toBe(false)
    expect(await screen.findByText(/看全部客人/)).toBeTruthy()
  })

  it('带 ?contact= 的直达链接 → 仍进平铺名单（老链接行为不变）', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('?contact=c1')
    render(<CrmAllContactsPage />)
    await waitFor(() => expect(screen.getByText('往来记录')).toBeTruthy())
    expect(calledUrls().some((u) => u.includes('view=priority'))).toBe(false)
  })

  it('带 ?assignee=me → 仍进平铺名单', async () => {
    stubFetch([contact('c1', 'Sue Masson')])
    setUrl('?assignee=me')
    render(<CrmAllContactsPage />)
    expect(await screen.findByText(/回到「今天先联系」/)).toBeTruthy()
    expect(calledUrls().some((u) => u.includes('view=priority'))).toBe(false)
  })
})

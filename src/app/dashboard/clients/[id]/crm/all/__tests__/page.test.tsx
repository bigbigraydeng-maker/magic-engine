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
import { render, screen, waitFor } from '@testing-library/react'
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

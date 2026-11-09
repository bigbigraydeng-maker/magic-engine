/**
 * NAL「标已成交」金额面板——只对 NAL 生效，不能碰 CTS 现有的"改状态"交互。
 * 见 `nal-crm-won-to-capi-design-v1.md`：CTS 走另一条独立的成交回传通道
 * （Google 表格同步），这次改动如果不小心变成"所有客户点 won 档都弹金额面板"，
 * 会是范围失控——这条测试专门锁住"只有 NAL 才会弹面板"这件事。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CrmAllContactsPage from '../page'

/**
 * 抽屉里的「已成交」按钮，跟表格上方「跟进到哪步：」筛选栏里同名的筛选 chip 撞了——
 * 两个按钮同时在屏幕上、文案一模一样，`screen.findByText('已成交')` 会报
 * "Found multiple elements"（2026-09-28 CRM 重整 B2 查出：详情换成 PersonDrawer
 * 之后才第一次真的跑到这一步——这份测试此前一直卡在更早的假接口形状不对，
 * 从没真的执行到这里，这处歧义因此一直没暴露）。改阶段的按钮只会出现在
 * 抽屉（`<aside>`）里，用 `within` 收窄查询范围。
 */
const withinDrawer = () => within(document.querySelector('aside') as HTMLElement)

const NAL = '4ae76381-cd45-43bd-85cd-98cfd7604007'
let mockClientId = NAL

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: mockClientId }),
}))

const contact = (id: string, name: string) => ({
  contactId: id,
  name,
  firstSeenAt: '2026-06-01T00:00:00Z',
  lastTouchAt: '2026-08-01T00:00:00Z',
  phone: null,
  email: 'x@example.com',
  hasMessenger: false,
  stage: 'new',
  stageLabel: '新线索',
  segment: 'nurture',
  segmentLabel: '慢慢养',
  temperature: 'cold',
  nextAction: { list: 'cold', verb: 'system_watching', verbLabel: '系统盯着', line: '系统盯着 —— 聊过一轮断了', reason: '聊过一轮断了', aiSuggestion: null, intentBoost: false },
  intent: null,
  custom: {},
})

const WON_STAGE = { stageKey: 'won', label: '已成交', marketingAction: 'won', isTerminal: true }
const NEW_STAGE = { stageKey: 'new', label: '新线索', marketingAction: 'nurture', isTerminal: false }

function stubFetch(contacts: ReturnType<typeof contact>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/crm/contacts?') || url.endsWith('/crm/contacts')) {
        // 🔴 2026-09-28 查证：这里原来回的是 C1a 分页改造前的老形状
        // （`contacts` / `totalContacts`），而 page.tsx 请求时一直带着 `?page=&perPage=`，
        // 真实接口走的是分页路径、回的是 `items` / `total`。老形状对不上页面实际读的键，
        // `setRows(json.items ?? [])` 拿到的永远是 []——这份测试从 C1a（PR #2002）上线
        // 起就没真的跑过 NAL 弹金额面板这条路，只是「还没有客人」那句空态文案不会报错，
        // 3 条用例静默红了很久没人发现。改成跟 page.test.tsx 里 stubFetch 同一份真实形状。
        return { ok: true, json: async () => ({ items: contacts, total: contacts.length, page: 1, perPage: 100, columns: [] }) }
      }
      if (url.includes('/timeline')) {
        return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
      }
      if (url.includes('nal-mark-won')) {
        return { ok: true, json: async () => ({ message: '记好了', stageChanged: true, doNotContact: false }) }
      }
      return { ok: true, json: async () => ({ stages: [NEW_STAGE, WON_STAGE] }) }
    }),
  )
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mockClientId = NAL
  // 这页默认进「今天先联系」；本文件测的是平铺名单里的阶段按钮。
  window.history.replaceState({}, '', '/dashboard/clients/nal/crm/all?view=all')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NAL 点"已成交"档 → 弹金额面板，不是普通确认框', () => {
  it('点击后出现金额/日期输入，且没有调用 window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText('Jordan Example'))
    // 改阶段收在「更多」里了（PM 2026-10-10 按钮精简）——先展开再点。
    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    fireEvent.click(await screen.findByRole('button', { name: /改「到哪一步了」/ }))
    fireEvent.click(await withinDrawer().findByText('已成交'))

    expect(await screen.findByText(/这笔生意多少钱/)).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('填金额确认后调用 nal-mark-won，不是普通的 stage PATCH', async () => {
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText('Jordan Example'))
    // 改阶段收在「更多」里了（PM 2026-10-10 按钮精简）——先展开再点。
    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    fireEvent.click(await screen.findByRole('button', { name: /改「到哪一步了」/ }))
    fireEvent.click(await withinDrawer().findByText('已成交'))
    await screen.findByText(/这笔生意多少钱/)

    const amountInput = screen.getByPlaceholderText('金额')
    fireEvent.change(amountInput, { target: { value: '500' } })
    fireEvent.click(screen.getByText('确认已成交'))

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('nal-mark-won'))
      expect(calls).toHaveLength(1)
      const body = JSON.parse(calls[0][1].body as string)
      expect(body).toMatchObject({ contactId: 'c1', amountMajor: 500 })
      expect(typeof body.idempotencyKey).toBe('string')
    })
  })
})

describe('别的客户点同名档位——普通确认框，不弹金额面板（范围不能溢出到 CTS）', () => {
  it('非 NAL 客户点"已成交"档，走原来的 window.confirm + PATCH', async () => {
    mockClientId = 'c0000000-0000-0000-0000-000000000000'
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText('Jordan Example'))
    // 改阶段收在「更多」里了（PM 2026-10-10 按钮精简）——先展开再点。
    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    fireEvent.click(await screen.findByRole('button', { name: /改「到哪一步了」/ }))
    fireEvent.click(await withinDrawer().findByText('已成交'))

    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.queryByText(/这笔生意多少钱/)).toBeNull()
  })
})

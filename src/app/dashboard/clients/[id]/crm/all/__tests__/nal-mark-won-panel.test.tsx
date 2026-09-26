/**
 * NAL「标已成交」金额面板——只对 NAL 生效，不能碰 CTS 现有的"改状态"交互。
 * 见 `nal-crm-won-to-capi-design-v1.md`：CTS 走另一条独立的成交回传通道
 * （Google 表格同步），这次改动如果不小心变成"所有客户点 won 档都弹金额面板"，
 * 会是范围失控——这条测试专门锁住"只有 NAL 才会弹面板"这件事。
 */

import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CrmAllContactsPage from '../page'

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
  custom: {},
})

const WON_STAGE = { stageKey: 'won', label: '已成交', marketingAction: 'won', isTerminal: true }
const NEW_STAGE = { stageKey: 'new', label: '新线索', marketingAction: 'nurture', isTerminal: false }

function stubFetch(contacts: ReturnType<typeof contact>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/crm/contacts?') || url.endsWith('/crm/contacts')) {
        return { ok: true, json: async () => ({ contacts, totalContacts: contacts.length, columns: [] }) }
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
    fireEvent.click(await screen.findByRole('button', { name: /跟进到哪步/ }))
    fireEvent.click(await screen.findByText('已成交'))

    expect(await screen.findByText(/这笔生意多少钱/)).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('填金额确认后调用 nal-mark-won，不是普通的 stage PATCH', async () => {
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)

    fireEvent.click(await screen.findByText('Jordan Example'))
    fireEvent.click(await screen.findByRole('button', { name: /跟进到哪步/ }))
    fireEvent.click(await screen.findByText('已成交'))
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
    fireEvent.click(await screen.findByRole('button', { name: /跟进到哪步/ }))
    fireEvent.click(await screen.findByText('已成交'))

    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.queryByText(/这笔生意多少钱/)).toBeNull()
  })
})

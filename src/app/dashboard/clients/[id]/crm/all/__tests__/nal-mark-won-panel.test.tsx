/**
 * 没配成交阶段时，「已成交」仍打开金额面板。售后和慢慢养走确认框。
 * 金额面板直接渲染时，请求体必须带上客户和阶段。
 */

import React from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import CrmAllContactsPage from '../page'
import { MarkWonPanel } from '../../_components/MarkWonPanel'

const withinDrawer = () => within(document.querySelector('aside') as HTMLElement)

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let mockClientId = CLIENT_A

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
const POSTSALE_STAGE = { stageKey: 'postsale', label: '售后', marketingAction: 'postsale', isTerminal: false }
const NEW_STAGE = { stageKey: 'new', label: '新线索', marketingAction: 'nurture', isTerminal: false }

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
      return { ok: true, json: async () => ({ stages: [NEW_STAGE, WON_STAGE, POSTSALE_STAGE] }) }
    }),
  )
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  mockClientId = CLIENT_A
  window.history.replaceState({}, '', '/dashboard/clients/a/crm/all?view=all')
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function openStage(label: string) {
  fireEvent.click(await screen.findByText('Jordan Example'))
  fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
  fireEvent.click(await screen.findByRole('button', { name: /改「到哪一步了」/ }))
  const button = await withinDrawer().findByRole('button', { name: label })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('没配成交阶段时，已成交仍打开金额面板', () => {
  it('已成交', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)
    await openStage('已成交')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/这笔生意多少钱/)).toBeTruthy()
  })

  it('另一个客户点已成交也一样', async () => {
    mockClientId = CLIENT_B
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)
    await openStage('已成交')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(screen.getByText(/这笔生意多少钱/)).toBeTruthy()
  })

  it('售后仍走确认框', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    stubFetch([contact('c1', 'Jordan Example')])
    render(<CrmAllContactsPage />)
    fireEvent.click(await screen.findByText('Jordan Example'))
    fireEvent.click(await screen.findByRole('button', { name: /更多/ }))
    fireEvent.click(await screen.findByRole('button', { name: /改「到哪一步了」/ }))
    fireEvent.click(await withinDrawer().findByRole('button', { name: /其他/ }))
    const button = await withinDrawer().findByRole('button', { name: '售后' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    expect(confirmSpy).toHaveBeenCalled()
    expect(screen.queryByText(/这笔生意多少钱/)).toBeNull()
  })
})

describe('金额面板如果被单独挂上，请求里必须有客户和阶段', () => {
  it('提交时带上 clientId、stageKey 和币种', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ message: '记好了' }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <MarkWonPanel
        clientId={CLIENT_A}
        contactId="c1"
        stageKey="won"
        onDone={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('金额'), { target: { value: '500' } })
    fireEvent.click(screen.getByText('确认已成交'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const calls = fetchMock.mock.calls as unknown as Array<[string, { body: string }]>
    const first = calls[0]
    if (!first) throw new Error('missing fetch')
    const body = JSON.parse(first[1].body)
    expect(body).toMatchObject({ clientId: CLIENT_A, contactId: 'c1', stageKey: 'won', amountMajor: 500, currency: 'NZD' })
    expect(body.idempotencyKey).toBeUndefined()
  })
})

describe('抽屉和这条路由的源码里没有写死客户编号', () => {
  it('PersonDrawer 和 nal-mark-won 路由不含 uuid', () => {
    const drawer = readFileSync('src/app/dashboard/clients/[id]/crm/_components/PersonDrawer.tsx', 'utf8')
    const route = readFileSync('src/app/api/admin/conversions/nal-mark-won/route.ts', 'utf8')
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    expect(drawer).not.toMatch(uuid)
    expect(route).not.toMatch(uuid)
  })
})

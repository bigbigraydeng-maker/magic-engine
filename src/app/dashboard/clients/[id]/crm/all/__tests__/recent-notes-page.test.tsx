import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CrmAllContactsPage from '../page'
import { RecentNotesPanel } from '../_components/RecentNotesPanel'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'cts' }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/dashboard/clients/cts/crm/all?view=all')
})

it('批准的桌面版默认直接显示这批 11 位手记客户', () => {
  const notes = Array.from({ length: 11 }, (_, i) => ({
    contactId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Guest ${i + 1}`,
    at: '2026-10-31T00:00:00Z',
    occurredAt: '2026-10-30T23:00:00Z',
    preview: '已记通话',
  }))
  render(<RecentNotesPanel notes={notes} onOpen={() => undefined} />)
  expect(screen.getAllByRole('button', { name: /Guest/ })).toHaveLength(11)
  expect(screen.queryByRole('button', { name: /展开这/ })).toBeNull()
  expect(screen.getByText('按写入时间排序')).toBeTruthy()
})

it('第三页的最近手记可从顶部按 id 打开，不翻主名单', async () => {
  const id = '00000000-0000-4000-8000-000000000229'
  const row = (contactId: string, name: string) => ({
    contactId, name, firstSeenAt: '2026-10-01T00:00:00Z', lastTouchAt: '2026-10-30T23:00:00Z',
    phone: null, email: null, hasMessenger: false, stage: null, stageLabel: null,
    segment: 'new_untouched', segmentLabel: '新线索', temperature: 'hot',
    nextAction: { list: 'hot', verb: 'call', verbLabel: '打给他', line: '打给他', reason: '', aiSuggestion: null, intentBoost: false },
    intent: null, pinnedAt: null, custom: {},
  })
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    if (url.includes(`ids=${id}`)) return { ok: true, json: async () => ({ items: [row(id, 'Off-page guest')] }) }
    if (url.includes('view=priority')) return { ok: true, json: async () => ({
      view: 'priority', columns: [], viewerEmail: 'info@ctstours.co.nz',
      sections: [
        { key: 'hot', title: '今天要联系', hint: '', total: 235, open: true, page: 1, items: [row('00000000-0000-4000-8000-000000000001', 'First guest')] },
        { key: 'cold', title: '先放着', hint: '', total: 0, open: false, page: 1, items: null },
      ],
      recentNotes: [{ contactId: id, name: 'Off-page guest', at: '2026-10-30T23:00:00Z', occurredAt: '2026-10-30T22:00:00Z', preview: 'Asked for a catalogue' }],
    }) }
    if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
    return { ok: true, json: async () => ({ stages: [] }) }
  }))
  window.history.replaceState({}, '', '/dashboard/clients/cts/crm/all?view=smart')
  render(<CrmAllContactsPage />)
  fireEvent.click(await screen.findByRole('button', { name: /Off-page guest/ }))
  await waitFor(() => expect(screen.getByText('往来记录')).toBeTruthy())
  expect(urls.some((url) => url.includes(`ids=${id}`))).toBe(true)
  expect(urls.some((url) => url.includes('p_hot=3'))).toBe(false)
  expect(screen.getByText(/最近记一笔/)).toBeTruthy()
})

it('连续点两位跨页客户时，较慢的旧请求不会把抽屉切回上一位', async () => {
  const firstId = '00000000-0000-4000-8000-000000000211'
  const secondId = '00000000-0000-4000-8000-000000000212'
  const row = (contactId: string, name: string) => ({
    contactId, name, firstSeenAt: '2026-10-01T00:00:00Z', lastTouchAt: '2026-10-30T23:00:00Z',
    phone: null, email: null, hasMessenger: false, stage: null, stageLabel: null,
    segment: 'new_untouched', segmentLabel: '新线索', temperature: 'hot',
    nextAction: { list: 'hot', verb: 'call', verbLabel: '打给他', line: '打给他', reason: '', aiSuggestion: null, intentBoost: false },
    intent: null, pinnedAt: null, custom: {},
  })
  let releaseFirst!: (response: { ok: boolean; json: () => Promise<{ items: ReturnType<typeof row>[] }> }) => void
  const slowFirst = new Promise<{ ok: boolean; json: () => Promise<{ items: ReturnType<typeof row>[] }> }>((resolve) => { releaseFirst = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes(`ids=${firstId}`)) return slowFirst
    if (url.includes(`ids=${secondId}`)) return { ok: true, json: async () => ({ items: [row(secondId, 'Second customer')] }) }
    if (url.includes('view=priority')) return { ok: true, json: async () => ({
      view: 'priority', columns: [], sections: [
        { key: 'hot', title: '今天要联系', hint: '', total: 235, open: true, page: 1, items: [row('00000000-0000-4000-8000-000000000001', 'On page')] },
        { key: 'cold', title: '先放着', hint: '', total: 0, open: false, page: 1, items: null },
      ],
      recentNotes: [
        { contactId: firstId, name: 'First customer', at: '2026-10-31T00:00:00Z', occurredAt: '2026-10-31T00:00:00Z', preview: '第一位' },
        { contactId: secondId, name: 'Second customer', at: '2026-10-31T00:01:00Z', occurredAt: '2026-10-31T00:01:00Z', preview: '第二位' },
      ],
    }) }
    if (url.includes('/timeline')) return { ok: true, json: async () => ({ timeline: [], omittedMessages: 0 }) }
    return { ok: true, json: async () => ({ stages: [] }) }
  }))
  window.history.replaceState({}, '', '/dashboard/clients/cts/crm/all?view=smart')
  render(<CrmAllContactsPage />)
  fireEvent.click(await screen.findByRole('button', { name: /First customer/ }))
  expect(await screen.findByText('正在打开客户…')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Second customer/ }))
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Second customer' })).toBeTruthy())
  await act(async () => releaseFirst({ ok: true, json: async () => ({ items: [row(firstId, 'First customer')] }) }))
  expect(screen.getByRole('heading', { name: 'Second customer' })).toBeTruthy()
})

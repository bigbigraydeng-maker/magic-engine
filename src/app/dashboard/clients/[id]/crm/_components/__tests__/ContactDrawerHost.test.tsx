import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContactDrawerHost } from '../ContactDrawerHost'

vi.mock('../PersonDrawer', () => ({
  PersonDrawer: (p: { row: { name: string }; scrollToBookings?: boolean; onClose: () => void; onSaved: (m: string, r?: boolean) => void }) => (
    <aside data-testid="drawer" data-scroll={String(p.scrollToBookings === true)}>
      <h2>{p.row.name}</h2>
      <button onClick={p.onClose}>关闭</button>
      <button onClick={() => p.onSaved('✓ 改好了')}>存</button>
    </aside>
  ),
}))

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTACT = 'c1a1a1a1-0000-4000-8000-000000000001'

const ROW = {
  contactId: CONTACT, name: 'Wang M.', firstSeenAt: '2026-01-01T00:00:00Z', lastTouchAt: null, phone: null, email: null,
  hasMessenger: false, stage: null, stageLabel: null, pinnedAt: null, important: { note: null, dueAt: null },
  segment: 'stale_conversation', segmentLabel: '', temperature: 'cold', nextAction: { line: '' }, intent: null, custom: {},
}

function stub(contactsStatus = 200, items: unknown[] = [ROW]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/crm/contacts?ids=')) {
      return new Response(JSON.stringify({ items, viewerEmail: 'staff@example.com' }), { status: contactsStatus })
    }
    return new Response(JSON.stringify({ stages: [{ stageKey: 'quoted', label: '已报价', marketingAction: 'nurture' }] }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ContactDrawerHost', () => {
  it('先说「正在打开」，取到人后弹出抽屉并要求滚到订单', async () => {
    const fetchMock = stub()
    render(<ContactDrawerHost clientId={CLIENT} contactId={CONTACT} name="Wang M." scrollToBookings onClose={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('正在打开 Wang M.')
    const drawer = await screen.findByTestId('drawer')
    expect(drawer.getAttribute('data-scroll')).toBe('true')
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`/api/clients/${CLIENT}/crm/contacts?ids=${CONTACT}`))).toBe(true)
  })

  it('取不到这个人 → 说一句并给关闭，不留空白遮罩', async () => {
    stub(200, [])
    const onClose = vi.fn()
    render(<ContactDrawerHost clientId={CLIENT} contactId={CONTACT} name={null} onClose={onClose} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('打不开了')
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按 Esc 关闭；抽屉里存了东西会重新取一次这个人', async () => {
    const fetchMock = stub()
    const onClose = vi.fn()
    render(<ContactDrawerHost clientId={CLIENT} contactId={CONTACT} name="Wang M." onClose={onClose} />)
    await screen.findByTestId('drawer')
    const before = fetchMock.mock.calls.filter(([u]) => String(u).includes('?ids=')).length
    fireEvent.click(screen.getByRole('button', { name: '存' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('?ids=')).length).toBe(before + 1),
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CrmPaymentsPage from '../../page'
import { PAGE_HEADING } from '../payments-format'
import { navigationMock, pushes, resetNav, setSearch } from './nav-mock'
import {
  CLIENT,
  CONTACT_2,
  DEP_A,
  DEP_B,
  TOUR_B,
  json,
  makePayload,
  overviewCalls,
  stubFetch,
} from './payments-fixtures'

vi.mock('next/navigation', async () => (await import('./nav-mock')).navigationMock)
vi.mock('../../../_components/ContactDrawerHost', () => ({
  ContactDrawerHost: (p: { contactId: string; name: string | null; scrollToBookings?: boolean; onClose: () => void }) => (
    <div data-testid="drawer" data-contact={p.contactId} data-name={p.name ?? ''} data-scroll={String(p.scrollToBookings === true)}>
      <button onClick={p.onClose}>关闭抽屉</button>
    </div>
  ),
}))

beforeEach(() => { resetNav(''); window.sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function lastPush(): string {
  return pushes[pushes.length - 1] ?? ''
}

async function renderReady(handler = () => json(200, makePayload())) {
  const fetchMock = stubFetch(handler)
  render(<CrmPaymentsPage />)
  await screen.findByRole('heading', { name: PAGE_HEADING })
  return fetchMock
}

describe('付款总览 interactions', () => {
  it('clicking a summary row sets the departure and refetches the list', async () => {
    const fetchMock = await renderReady()
    const rowButton = screen.getByRole('button', { name: /2027-03-19 出发/ })

    fireEvent.click(rowButton)

    await waitFor(() => {
      expect(lastPush()).toContain(`departureId=${DEP_A}`)
    })
    await waitFor(() => {
      expect(overviewCalls(fetchMock).some((u) => u.includes(`departureId=${DEP_A}`))).toBe(true)
    })

    expect(await screen.findByText(/只看：/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '看全部出发日期' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /2027-03-19 出发/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /2027-03-19 出发/ }))
    await waitFor(() => {
      expect(lastPush()).not.toContain('departureId=')
    })
  })

  it('the undecided row filters with departureId=none', async () => {
    const fetchMock = await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /还没选出发日期/ }))
    await waitFor(() => {
      expect(overviewCalls(fetchMock).some((u) => u.includes('departureId=none'))).toBe(true)
    })
  })

  it('the 看全部出发日期 button clears the departure', async () => {
    resetNav(`?departureId=${DEP_A}`)
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: '看全部出发日期' }))
    await waitFor(() => {
      expect(lastPush()).not.toContain('departureId=')
    })
  })

  it('status filter changes the URL, refetches and goes back to page 1', async () => {
    resetNav('?page=2')
    const fetchMock = await renderReady()
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'unsettled' } })
    await waitFor(() => {
      expect(lastPush()).toContain('status=unsettled')
    })
    expect(lastPush()).not.toContain('page=')
    await waitFor(() => {
      expect(overviewCalls(fetchMock).some((u) => u.includes('status=unsettled'))).toBe(true)
    })
  })

  it('tour filter sends tourId', async () => {
    const fetchMock = await renderReady()
    const tourSelect = screen.getByLabelText('团') as HTMLSelectElement
    const optionTexts = Array.from(tourSelect.options).map((o) => o.textContent ?? '')
    expect(optionTexts).toContain('新西兰南北岛 12 天')
    expect(optionTexts).toContain('澳洲东海岸 9 天')

    fireEvent.change(tourSelect, { target: { value: TOUR_B } })
    await waitFor(() => {
      expect(overviewCalls(fetchMock).some((u) => u.includes(`tourId=${TOUR_B}`))).toBe(true)
    })

    const crmUrls = fetchMock.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/crm/bookings/'))
    for (const u of crmUrls) {
      expect(
        u.includes('/crm/bookings/overview') ||
          u.includes('/crm/bookings/access') ||
          u.includes('/crm/bookings/options'),
      ).toBe(true)
    }
  })

  it('pagination: next and previous send the page param', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('page=2')) {
        return json(200, makePayload({ list: { ...makePayload().list, page: 2 } }))
      }
      return json(200, makePayload())
    })
    render(<CrmPaymentsPage />)
    await screen.findByRole('heading', { name: PAGE_HEADING })

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(overviewCalls(fetchMock).some((u) => u.includes('page=2'))).toBe(true)
    })

    await waitFor(() => {
      expect(screen.getByText(/第 2 \/ 3 页/)).toBeTruthy()
    })
    const prev = screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement
    expect(prev.disabled).toBe(false)
    fireEvent.click(prev)
    await waitFor(() => {
      expect(lastPush()).not.toContain('page=')
    })
  })

  it('pagination: next is disabled on the last page', async () => {
    stubFetch(() => json(200, makePayload({ list: { ...makePayload().list, page: 3 } })))
    render(<CrmPaymentsPage />)
    await screen.findByRole('heading', { name: PAGE_HEADING })
    await waitFor(() => {
      expect(screen.getByText(/第 3 \/ 3 页/)).toBeTruthy()
    })
    const next = screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
  })

  it('restores every filter from the URL', async () => {
    resetNav(`?status=settled&tourId=${TOUR_B}&page=2&departureId=${DEP_B}&includePastPaid=true`)
    const fetchMock = await renderReady()
    const first = overviewCalls(fetchMock)[0] ?? ''
    expect(first).toContain('status=settled')
    expect(first).toContain(`tourId=${TOUR_B}`)
    expect(first).toContain('page=2')
    expect(first).toContain(`departureId=${DEP_B}`)
    expect(first).toContain('includePastPaid=true')

    expect((screen.getByLabelText('状态') as HTMLSelectElement).value).toBe('settled')
    expect((screen.getByLabelText('团') as HTMLSelectElement).value).toBe(TOUR_B)
    expect(
      screen.getByRole('button', { name: '也看已收齐的过去出发' }).getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('malformed URL falls back to defaults', async () => {
    resetNav('?status=bogus&page=-3')
    const fetchMock = await renderReady()
    const first = overviewCalls(fetchMock)[0] ?? ''
    expect(first).not.toContain('status=')
    expect(first).not.toContain('page=')
  })

  it('one request per distinct query: no refetch storm', async () => {
    const fetchMock = await renderReady()
    expect(overviewCalls(fetchMock)).toHaveLength(1)

    act(() => setSearch(''))
    await waitFor(() => {
      expect(overviewCalls(fetchMock)).toHaveLength(1)
    })

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'unsettled' } })
    await waitFor(() => {
      expect(overviewCalls(fetchMock)).toHaveLength(2)
    })
  })

  it('clicking a list row opens that guest in a drawer on the same page (no navigation) and keeps the filters', async () => {
    resetNav('?status=unsettled')
    const fetchMock = await renderReady()

    const link = await screen.findByRole('link', { name: 'Li & Li' })
    const row = link.closest('tr')
    expect(row).not.toBeNull()
    const cell = within(row as HTMLTableRowElement).getAllByRole('cell')[1]
    fireEvent.click(cell)

    const drawer = await screen.findByTestId('drawer')
    expect(drawer.getAttribute('data-contact')).toBe(CONTACT_2)
    expect(drawer.getAttribute('data-scroll')).toBe('true')
    expect(pushes.some((u) => u.includes('/crm/all'))).toBe(false)

    // closing returns to the same filtered page and refreshes the numbers once
    const before = overviewCalls(fetchMock).length
    fireEvent.click(screen.getByRole('button', { name: '关闭抽屉' }))
    await waitFor(() => expect(screen.queryByTestId('drawer')).toBeNull())
    await waitFor(() => expect(overviewCalls(fetchMock).length).toBe(before + 1))
    expect(pushes.some((u) => u.includes('/crm/all'))).toBe(false)
  })

  it('clicking the guest name link opens the drawer in place; ctrl-click keeps the normal link', async () => {
    resetNav('?status=unsettled')
    await renderReady()

    const link = await screen.findByRole('link', { name: 'Wang M.' })
    fireEvent.click(link, { ctrlKey: true })
    expect(screen.queryByTestId('drawer')).toBeNull()

    fireEvent.click(link)
    const drawer = await screen.findByTestId('drawer')
    expect(drawer.getAttribute('data-name')).toBe('Wang M.')
    expect(pushes.some((u) => u.includes('/crm/all'))).toBe(false)
  })
})

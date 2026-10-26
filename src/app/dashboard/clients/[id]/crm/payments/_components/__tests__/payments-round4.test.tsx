import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import CrmPaymentsPage from '../../page'
import { PAGE_HEADING } from '../payments-format'
import { PaymentsErrorBoundary } from '../PaymentsErrorBoundary'
import { parseOverviewPayload } from '../payments-api'
import { navigationMock, pushes, resetNav, setSearch } from './nav-mock'
import {
  CLIENT,
  CONTACT_2,
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

beforeEach(() => {
  resetNav('')
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ERROR_TEXT = '付款总览暂时算不出来，请稍后再试'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('付款总览 round 4', () => {
  describe('payload validation', () => {
    const mutations: Array<[string, (p: ReturnType<typeof makePayload>) => void]> = [
      ['group without warningCodes', (p) => { delete (p.summary.groups[0] as { warningCodes?: unknown }).warningCodes }],
      ['row without warnings', (p) => { delete (p.list.rows[0] as { warnings?: unknown }).warnings }],
      ['deposit cell without quiet', (p) => { delete (p.list.rows[0].deposit as { quiet?: unknown } | null as { quiet?: unknown }).quiet }],
      ['non-numeric totals.orders', (p) => { (p.summary.totals as { orders: unknown }).orders = '6' }],
    ]

    it.each(mutations)(
      'a payload that passes the top-level check but lacks nested fields is an error, not a crash (%s)',
      async (_name, mutate) => {
        const payload = makePayload()
        mutate(payload)
        stubFetch(() => json(200, payload))
        render(<CrmPaymentsPage />)
        const alert = await screen.findByRole('alert')
        expect(alert).toHaveTextContent(ERROR_TEXT)
        expect(screen.queryByRole('table')).toBeNull()
        expect(document.body.textContent ?? '').not.toMatch(/\d+单/)
      },
    )

    it('parseOverviewPayload accepts a good payload and rejects junk', () => {
      expect(parseOverviewPayload(makePayload())).not.toBeNull()
      expect(parseOverviewPayload(null)).toBeNull()
      expect(parseOverviewPayload({})).toBeNull()
    })
  })

  describe('optional newer fields', () => {
    it('missing optional newer fields are filled in', async () => {
      const payload = clone(makePayload())
      delete (payload.summary as { hiddenOrders?: unknown }).hiddenOrders
      delete (payload.summary as { hiddenOfflineOnlyGroups?: unknown }).hiddenOfflineOnlyGroups
      delete (payload.summary.groups[0] as { openItems?: unknown }).openItems
      delete (payload.summary.groups[0] as { dateAmbiguous?: unknown }).dateAmbiguous
      stubFetch(() => json(200, payload))
      render(<CrmPaymentsPage />)
      await screen.findByRole('table', { name: '各出发日期的收款进度' })
      const text = document.body.textContent ?? ''
      expect(text).not.toContain('undefined')
      expect(text).not.toContain('NaN')
      const parsed = parseOverviewPayload(payload)
      expect(parsed).not.toBeNull()
      expect(parsed?.summary.hiddenOrders).toBe(0)
      expect(parsed?.summary.hiddenOfflineOnlyGroups).toBe(0)
    })
  })

  describe('error boundary', () => {
    it('a component that throws shows the error branch', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      function Boom(): JSX.Element {
        throw new Error('boom')
      }
      const { rerender } = render(
        <PaymentsErrorBoundary resetKey={1} fallback={<p role="alert">失败了</p>}>
          <Boom />
        </PaymentsErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toHaveTextContent('失败了')
      rerender(
        <PaymentsErrorBoundary resetKey={2} fallback={<p role="alert">失败了</p>}>
          <p>好了</p>
        </PaymentsErrorBoundary>,
      )
      expect(screen.getByText('好了')).toBeInTheDocument()
      spy.mockRestore()
    })
  })

  describe('refreshing', () => {
    it('refreshing is visible', async () => {
      const gate = deferred<Response>()
      stubFetch((url) => (url.includes('status=unsettled') ? gate.promise : json(200, makePayload())))
      const { container } = render(<CrmPaymentsPage />)
      await screen.findByRole('table', { name: '各出发日期的收款进度' })
      fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'unsettled' } })
      await screen.findByText('更新中…')
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
      await act(async () => {
        gate.resolve(json(200, makePayload()))
      })
      await waitFor(() => expect(screen.queryByText('更新中…')).toBeNull())
      expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    })
  })

  describe('row clicks', () => {
    it('selecting text does not open the drawer, a plain click does', async () => {
      stubFetch(() => json(200, makePayload()))
      render(<CrmPaymentsPage />)
      await screen.findByRole('table', { name: '全部订单' })
      const noteCell = screen.getByText('没勾邮轮按90天算')
      const range = document.createRange()
      range.selectNodeContents(noteCell)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      fireEvent.click(noteCell)
      expect(screen.queryByTestId('drawer')).toBeNull()
      window.getSelection()?.removeAllRanges()
      fireEvent.click(noteCell)
      expect(screen.getByTestId('drawer')).not.toBeNull()
      expect(pushes.some((u) => u.includes('/crm/all'))).toBe(false)
    })
  })

  describe('empty list', () => {
    it('empty list keeps filters and pager', async () => {
      const payload = makePayload()
      payload.list = { rows: [], page: 1, pageCount: 1, total: 0 }
      stubFetch(() => json(200, payload))
      render(<CrmPaymentsPage />)
      await screen.findByRole('table', { name: '各出发日期的收款进度' })
      expect(screen.getByLabelText('团')).toBeInTheDocument()
      expect(screen.getByLabelText('状态')).toBeInTheDocument()
      const nav = screen.getByRole('navigation', { name: '翻页' })
      expect(within(nav).getByRole('button', { name: '上一页' })).toBeDisabled()
      expect(within(nav).getByRole('button', { name: '下一页' })).toBeDisabled()
      const empty = screen.getByText('没有符合条件的订单')
      expect(empty.closest('[role="status"]')).not.toBeNull()
    })
  })

  describe('warnings', () => {
    it('a departure select button is described by its warning text', async () => {
      stubFetch(() => json(200, makePayload()))
      render(<CrmPaymentsPage />)
      const table = await screen.findByRole('table', { name: '各出发日期的收款进度' })
      const warned = within(table).getByRole('button', { name: /2026-11-02 出发/ })
      const describedBy = warned.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      const ids = (describedBy ?? '').split(/\s+/).filter(Boolean)
      expect(ids.length).toBeGreaterThan(0)
      const texts = ids.map((id) => document.getElementById(id)?.textContent ?? '')
      expect(texts.join(' ')).toContain('出发日变了，请确认')
      const clean = within(table).getByRole('button', { name: /2027-03-19 出发/ })
      expect(clean.getAttribute('aria-describedby')).toBeNull()
    })
  })

  describe('abort on unmount', () => {
    it('F7 abort on unmount', async () => {
      const gate = deferred<Response>()
      const fetchMock = stubFetch(() => gate.promise)
      const { unmount } = render(<CrmPaymentsPage />)
      await waitFor(() => expect(overviewCalls(fetchMock).length).toBeGreaterThan(0))
      unmount()
      const overviewCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/crm/bookings/overview'))
      const init: RequestInit | undefined = overviewCall?.[1]
      expect(init?.signal?.aborted).toBe(true)
    })
  })

  describe('filter changes', () => {
    it('F7 changing a filter drops the page back to 1', async () => {
      resetNav('?page=2')
      const fetchMock = stubFetch(() => json(200, makePayload()))
      render(<CrmPaymentsPage />)
      await screen.findByRole('table', { name: '各出发日期的收款进度' })
      fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'settled' } })
      await waitFor(() => expect(pushes.length).toBeGreaterThan(0))
      const last = pushes[pushes.length - 1]
      expect(last).not.toContain('page=')
      await waitFor(() => {
        const calls = overviewCalls(fetchMock)
        expect(calls.some((u) => u.includes('status=settled') && !u.includes('page='))).toBe(true)
      })
    })
  })
})

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import CrmPaymentsPage from '../../page'
import { navigationMock, pushes, resetNav, setSearch } from './nav-mock'
import {
  CLIENT,
  json,
  makePayload,
  makeRow,
  overviewCalls,
  stubFetch,
} from './payments-fixtures'

vi.mock('next/navigation', async () => (await import('./nav-mock')).navigationMock)

beforeEach(() => {
  resetNav('')
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ERROR_TEXT = '付款总览暂时算不出来，请稍后再试'

describe('付款总览 page states', () => {
  it('a 500 shows the plain error with a retry button and no numbers', async () => {
    let calls = 0
    const fetchMock = stubFetch(() => {
      calls += 1
      if (calls === 1) return json(500, { error: 'overview_failed' })
      return json(200, makePayload())
    })

    render(<CrmPaymentsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(ERROR_TEXT)
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d+单/)
    expect(document.body.textContent).not.toContain('全部订单')

    const retry = screen.getByRole('button', { name: '重试' })
    await act(async () => {
      retry.click()
    })

    await screen.findByRole('table', { name: '各出发日期的收款进度' })
    expect(overviewCalls(fetchMock).length).toBe(2)
  })

  it.each([
    ['an empty object', {}],
    ['a wrong-typed summary', { summary: { groups: 'x' } }],
  ])('a malformed 200 body (%s) is treated as an error, never as zeros', async (_label, body) => {
    stubFetch(() => json(200, body))

    render(<CrmPaymentsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(ERROR_TEXT)
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d+单/)
  })

  it('a network failure is an error too', async () => {
    stubFetch(() => Promise.reject(new TypeError('network')))

    render(<CrmPaymentsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(ERROR_TEXT)
  })

  it.each([403, 404])('a %i renders only the neutral line', async (status) => {
    stubFetch(() => json(status, { error: 'x' }))

    const { container } = render(<CrmPaymentsPage />)

    await screen.findByText('这一页没有开通')
    expect(container.textContent).toBe('这一页没有开通')
  })

  it('loading shows a plain skeleton line, never zeros', async () => {
    stubFetch(() => new Promise<Response>(() => undefined))

    render(<CrmPaymentsPage />)

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('正在加载付款总览…')
    expect(document.body.textContent).not.toMatch(/\d+单/)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('a slow older response never overwrites a newer one', async () => {
    let resolveSlow: (r: Response) => void = () => undefined
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve
    })

    stubFetch((url) => {
      if (url.includes('status=unsettled')) {
        return json(200, makePayload({ list: { rows: [makeRow({ contactName: 'Fast Guest' })], page: 1, pageCount: 1, total: 1 } }))
      }
      return slow
    })

    render(<CrmPaymentsPage />)

    await act(async () => {
      setSearch('?status=unsettled')
    })

    await screen.findByText('Fast Guest')

    await act(async () => {
      resolveSlow(
        json(200, makePayload({ list: { rows: [makeRow({ contactName: 'Slow Guest' })], page: 1, pageCount: 1, total: 1 } })),
      )
      await Promise.resolve()
    })

    expect(screen.getByText('Fast Guest')).toBeTruthy()
    expect(screen.queryByText('Slow Guest')).toBeNull()
  })

  it('an error after good data removes the old numbers', async () => {
    let calls = 0
    stubFetch(() => {
      calls += 1
      if (calls === 1) return json(200, makePayload())
      return json(500, { error: 'overview_failed' })
    })

    render(<CrmPaymentsPage />)

    await screen.findByRole('table', { name: '各出发日期的收款进度' })

    await act(async () => {
      setSearch('?status=settled')
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(ERROR_TEXT)
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).not.toMatch(/\d+单/)
  })

  it('the page asks the overview endpoint for the same query string that is in the address bar', async () => {
    resetNav('?status=unsettled&page=2')
    const fetchMock = stubFetch(() => json(200, makePayload()))

    render(<CrmPaymentsPage />)

    await waitFor(() => {
      expect(overviewCalls(fetchMock).length).toBeGreaterThan(0)
    })

    expect(overviewCalls(fetchMock)[0]).toBe(
      `/api/clients/${CLIENT}/crm/bookings/overview?status=unsettled&page=2`,
    )
  })
})

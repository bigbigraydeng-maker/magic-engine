/**
 * The guest drawer reacts to `focus=bookings` in the URL:
 * - it scrolls the 订单与付款 block into view exactly once after the bookings load,
 * - it shows the 「← 回付款进度」 link at the top of the drawer, pointing back at the
 *   payments page with the query string the page saved before leaving.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'

const row = (contactId: string, name: string): DrawerRow => ({
  contactId,
  name,
  phone: null,
  email: 'x@example.com',
  stage: null,
  stageLabel: null,
})

function drawer(contactId: string, name: string) {
  return (
    <PersonDrawer
      clientId="cts"
      row={row(contactId, name)}
      stages={[]}
      viewerEmail="fde@example.com"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  )
}

const originalScrollIntoView = Element.prototype.scrollIntoView

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/dashboard/clients/cts/crm/all${search}`)
}

beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.includes('/crm/bookings/options')
        ? { tours: [] }
        : url.includes('/crm/bookings?contactId=')
          ? { bookings: [] }
          : { timeline: [], omittedMessages: 0 }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalScrollIntoView === undefined) {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  } else {
    Element.prototype.scrollIntoView = originalScrollIntoView
  }
})

describe('PersonDrawer focus=bookings', () => {
  it('scrolls to 订单与付款 once when the URL has focus=bookings', async () => {
    setUrl('?contact=c1&focus=bookings')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    const view = render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))

    const target = scroll.mock.contexts[0] as Element
    expect(target.id).toBe('crm-bookings-block')

    view.rerender(drawer('c1', 'Sue'))
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
  })

  it('does not scroll without focus=bookings', async () => {
    setUrl('?contact=c1')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('does not scroll for a different focus value', async () => {
    setUrl('?contact=c1&focus=timeline')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scroll).not.toHaveBeenCalled()
  })

  it('shows 「← 回付款进度」 only when focus=bookings is present', async () => {
    setUrl('?contact=c1&focus=bookings')
    render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await screen.findByRole('link', { name: '← 回付款进度' })
    cleanup()

    setUrl('?contact=c1')
    render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('link', { name: '← 回付款进度' })).toBeNull()
  })

  it.each([
    ['?status=unsettled&page=2', '/dashboard/clients/cts/crm/payments?status=unsettled&page=2'],
    [null, '/dashboard/clients/cts/crm/payments'],
    ['?a=<script>', '/dashboard/clients/cts/crm/payments'],
    ['//evil.example', '/dashboard/clients/cts/crm/payments'],
  ])('the back link keeps the saved query string (%s)', async (stored, expected) => {
    setUrl('?contact=c1&focus=bookings')
    if (stored !== null) window.sessionStorage.setItem('crm-payments-return:cts', stored)

    render(drawer('c1', 'Sue'))
    const link = await screen.findByRole('link', { name: '← 回付款进度' })
    expect(link.getAttribute('href')).toBe(expected)
  })

  it('the back link is the first thing at the top of the drawer', async () => {
    setUrl('?contact=c1&focus=bookings')

    render(drawer('c1', 'Sue'))
    const link = await screen.findByRole('link', { name: '← 回付款进度' })
    expect(link.closest('header')).not.toBeNull()
  })
})

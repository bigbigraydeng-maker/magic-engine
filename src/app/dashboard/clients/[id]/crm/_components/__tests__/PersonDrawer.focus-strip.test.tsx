/**
 * After BookingsBlock has scrolled once for `focus=bookings`, it strips `focus` from the
 * address bar (keeping `contact` and every other parameter). Because BackToPayments is keyed
 * by contact id inside PersonDrawer, it decides at mount whether to show the back link, so
 * opening a second guest afterwards neither scrolls again nor shows a stale link.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'
import { stripFocusFromUrl } from '../bookings/payments-return'

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

describe('PersonDrawer focus=bookings strips the URL', () => {
  it('strips focus from the URL after the scroll ran, keeping contact', async () => {
    setUrl('?contact=c1&focus=bookings')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))

    const params = new URLSearchParams(window.location.search)
    expect(params.get('focus')).toBeNull()
    expect(params.get('contact')).toBe('c1')
  })

  it('opening a second guest does not scroll again and shows no back link', async () => {
    setUrl('?contact=c1&focus=bookings')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    const view = render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))

    view.rerender(drawer('c2', 'Tom'))
    await screen.findByTestId('bookings-block')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(scroll).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link', { name: '← 回付款进度' })).toBeNull()
  })

  it('the back link still works for the first guest', async () => {
    setUrl('?contact=c1&focus=bookings')
    window.sessionStorage.setItem('crm-payments-return:cts', '?status=unsettled')
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll

    render(drawer('c1', 'Sue'))
    await screen.findByTestId('bookings-block')
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))

    const link = await screen.findByRole('link', { name: '← 回付款进度' })
    expect(link.getAttribute('href')).toBe('/dashboard/clients/cts/crm/payments?status=unsettled')
  })

  it('stripFocusFromUrl keeps other params and the hash', () => {
    window.history.replaceState({}, '', '/dashboard/clients/cts/crm/all?a=1&focus=bookings&b=2#x')
    stripFocusFromUrl()
    expect(window.location.search).toBe('?a=1&b=2')
    expect(window.location.hash).toBe('#x')

    window.history.replaceState({}, '', '/dashboard/clients/cts/crm/all?a=1&b=2#x')
    stripFocusFromUrl()
    expect(window.location.search).toBe('?a=1&b=2')
    expect(window.location.hash).toBe('#x')
  })
})

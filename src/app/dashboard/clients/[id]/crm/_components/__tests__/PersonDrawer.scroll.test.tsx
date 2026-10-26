/**
 * Scroll chaining: while the guest drawer is open the page behind must not scroll
 * (body overflow locked, restored exactly on close) and the drawer's own scroll
 * area must not pass wheel events on (overscroll-contain).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'

const row = (contactId: string): DrawerRow => ({
  contactId,
  name: 'Sue',
  phone: null,
  email: 'x@example.com',
  stage: null,
  stageLabel: null,
})

function drawer(contactId = 'c1') {
  return (
    <PersonDrawer
      clientId="cts"
      row={row(contactId)}
      stages={[]}
      viewerEmail="fde@example.com"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  )
}

beforeEach(() => {
  document.body.style.overflow = ''
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
afterEach(() => vi.unstubAllGlobals())

describe('PersonDrawer scroll lock', () => {
  it('locks body scroll while open and restores the empty value after close', () => {
    const view = render(drawer())
    expect(document.body.style.overflow).toBe('hidden')
    view.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores a non-default previous value exactly', () => {
    document.body.style.overflow = 'scroll'
    const view = render(drawer())
    expect(document.body.style.overflow).toBe('hidden')
    view.unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('stays locked until the last of two drawers closes', () => {
    document.body.style.overflow = 'auto'
    const a = render(drawer('c1'))
    const b = render(drawer('c2'))
    a.unmount()
    expect(document.body.style.overflow).toBe('hidden')
    b.unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('survives a StrictMode double mount', () => {
    document.body.style.overflow = 'scroll'
    const view = render(<React.StrictMode>{drawer()}</React.StrictMode>)
    expect(document.body.style.overflow).toBe('hidden')
    view.unmount()
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('keeps wheel scrolling inside the drawer content', () => {
    render(drawer())
    const scroller = screen.getByRole('complementary').querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    expect(scroller?.classList.contains('overscroll-contain')).toBe(true)
    expect(scroller?.classList.contains('min-h-0')).toBe(true)
  })
})

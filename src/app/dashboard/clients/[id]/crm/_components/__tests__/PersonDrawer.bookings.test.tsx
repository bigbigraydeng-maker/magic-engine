/**
 * The 订单与付款 block inside the guest drawer must belong to ONE guest.
 * When the drawer is re-used for another guest, the block starts fresh (open add-form closed,
 * no stale data from the previous guest).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

beforeEach(() => {
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

describe('PersonDrawer 订单与付款 block', () => {
  it('starts fresh when the drawer is re-used for another guest', async () => {
    const view = render(drawer('c1', 'Sue'))
    fireEvent.click(await screen.findByRole('button', { name: '＋ 加订单' }))
    expect(await screen.findByRole('button', { name: '先不加了' })).toBeTruthy()

    view.rerender(drawer('c2', 'Tom'))

    expect(await screen.findByRole('button', { name: '＋ 加订单' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '先不加了' })).toBeNull()
  })
})

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { CrmWorkspaceShell } from '../CrmWorkspaceShell'
import { resetCrmNavProbeCache } from '../useCrmNavAccess'

// The nav reads the URL; for these probe tests the exact page does not matter.
const navState = vi.hoisted(() => ({ path: '/dashboard/clients/x/crm/all', search: '' }))
vi.mock('next/navigation', () => ({
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.search),
}))

let now = 1_000_000

beforeEach(() => {
  resetCrmNavProbeCache()
  vi.useRealTimers()
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function res(status: number): Response {
  return new Response(JSON.stringify({ ok: true }), { status })
}

/** Fetch stub: answers the client lookup with a travel industry, and the probe via `probe`. */
function stub(probe: () => Promise<Response>) {
  const holder = { probe }
  const mock = Object.assign(
    vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/crm/bookings/access')
      ? holder.probe()
      : new Response(JSON.stringify({ client: { industry: 'travel' } }), { status: 200 }),
    ),
    { holder },
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

function probeCalls(mock: ReturnType<typeof stub>) {
  return mock.mock.calls.filter((call) => String(call[0]).includes('/crm/bookings/access'))
}

const TTL_MS = 5 * 60 * 1000

describe('CrmWorkspaceShell probe cache', () => {
  it('second mount within the TTL does not refetch and renders the tab immediately', async () => {
    const mock = stub(async () => res(200))
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await screen.findByRole('link', { name: '付款总览' })
    expect(probeCalls(mock)).toHaveLength(1)
    first.unmount()

    render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    expect(screen.getByRole('link', { name: '付款总览' })).toBeInTheDocument()
    expect(probeCalls(mock)).toHaveLength(1)
  })

  it('after the TTL it asks again', async () => {
    const mock = stub(async () => res(200))
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await screen.findByRole('link', { name: '付款总览' })
    expect(probeCalls(mock)).toHaveLength(1)
    first.unmount()

    now += TTL_MS + 1

    render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(probeCalls(mock)).toHaveLength(2))
  })

  it('a failed probe is not cached', async () => {
    let firstProbeCalled = false
    const mock = stub(async () => {
      firstProbeCalled = true
      throw new TypeError('network error')
    })
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(firstProbeCalled).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    first.unmount()

    mock.holder.probe = async () => res(200)
    render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await screen.findByRole('link', { name: '付款总览' })
    expect(probeCalls(mock)).toHaveLength(2)
  })

  it('a 500 is not cached either', async () => {
    let firstProbeCalled = false
    const mock = stub(async () => {
      firstProbeCalled = true
      return res(500)
    })
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(firstProbeCalled).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    first.unmount()

    mock.holder.probe = async () => res(200)
    render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await screen.findByRole('link', { name: '付款总览' })
    expect(probeCalls(mock)).toHaveLength(2)
  })

  it('a 403 is cached as not-ok', async () => {
    const mock = stub(async () => res(403))
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(probeCalls(mock)).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    first.unmount()

    render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    expect(probeCalls(mock)).toHaveLength(1)
  })

  it('different clients do not share the cache', async () => {
    const mock = stub(async () => res(200))
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await screen.findByRole('link', { name: '付款总览' })
    first.unmount()

    mock.holder.probe = async () => res(403)
    render(<CrmWorkspaceShell clientId={ID_B}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(probeCalls(mock)).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
  })

  it('a cached not-ok never flashes the tab', async () => {
    const mock = stub(async () => res(403))
    const first = render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(probeCalls(mock)).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    first.unmount()

    render(<CrmWorkspaceShell clientId={ID_A}>body</CrmWorkspaceShell>)
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('link', { name: '付款总览' })).toBeNull()
    expect(probeCalls(mock)).toHaveLength(1)
  })
})

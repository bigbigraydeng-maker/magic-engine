import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const navState = vi.hoisted(() => ({ path: '', search: '' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navState.path,
  useSearchParams: () => new URLSearchParams(navState.search),
}))

vi.mock('@/lib/crm/list-ready', () => ({
  afterCrmListReady: (fn: () => void) => {
    fn()
    return () => {}
  },
}))

import { CrmWorkspaceShell, resetCrmShellProbeCache } from '../CrmWorkspaceShell'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BASE = `/dashboard/clients/${CLIENT}`

function stubFetch(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status })),
  )
}

function hasCollapsedStyle(): boolean {
  return Array.from(document.querySelectorAll('style')).some((el) =>
    (el.textContent ?? '').includes('[data-me-sidebar]'),
  )
}

/** Node 26 ships a half-working global localStorage, so install a plain in-memory one. */
function installMemoryStorage(): Storage {
  const map = new Map<string, string>()
  const mem = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  } as Storage
  Object.defineProperty(window, 'localStorage', { value: mem, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true })
  return mem
}

beforeEach(() => {
  installMemoryStorage()
  resetCrmShellProbeCache()
  navState.path = `${BASE}/crm/all`
  navState.search = ''
  stubFetch(403)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CrmWorkspaceShell', () => {
  it('defaults to collapsed with empty storage', async () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    expect(hasCollapsedStyle()).toBe(true)
    expect(screen.getByRole('button', { name: '展开左侧菜单' })).toBeTruthy()
  })

  it('expands when storage says 0', async () => {
    localStorage.setItem('me.crm.sidebarCollapsed', '0')
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起左侧菜单' })).toBeTruthy()
    })
    expect(hasCollapsedStyle()).toBe(false)
  })

  it('toggles and persists the state', async () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    const toggle = screen.getByRole('button', { name: '展开左侧菜单' })

    fireEvent.click(toggle)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '收起左侧菜单' })).toBeTruthy()
    })
    expect(hasCollapsedStyle()).toBe(false)
    expect(localStorage.getItem('me.crm.sidebarCollapsed')).toBe('0')

    fireEvent.click(screen.getByRole('button', { name: '收起左侧菜单' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开左侧菜单' })).toBeTruthy()
    })
    expect(hasCollapsedStyle()).toBe(true)
    expect(localStorage.getItem('me.crm.sidebarCollapsed')).toBe('1')
  })

  it('links back to the ME dashboard', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    const link = screen.getByText('回 ME 主菜单')
    expect(link.closest('a')?.getAttribute('href')).toBe('/dashboard')
  })

  it('renders the mail placeholder as a disabled non-link', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    const item = screen.getByText('邮件 / 短信')
    expect(item.closest('a')).toBeNull()
    expect(item.getAttribute('aria-disabled')).toBe('true')
  })

  it('hides bookings-gated items when the probe is 403', async () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('今天先联系')).toBeTruthy()
    })
    expect(screen.queryByText('销售进度')).toBeNull()
    expect(screen.queryByText('到期日历')).toBeNull()
    expect(screen.getByText('全部客人')).toBeTruthy()
    expect(screen.getByText('设置')).toBeTruthy()
  })

  it('shows bookings-gated items when the probe is 200', async () => {
    stubFetch(200)
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('销售进度')).toBeTruthy()
    })
    expect(screen.getByText('到期日历')).toBeTruthy()
    expect(screen.getByText('销售进度').closest('a')?.getAttribute('href')).toContain(
      '/sales-progress',
    )
    expect(screen.getByText('到期日历').closest('a')?.getAttribute('href')).toContain(
      '/crm/calendar',
    )
  })

  it('highlights the active nav item from the URL', async () => {
    navState.path = `${BASE}/crm/all`
    navState.search = ''
    const { unmount } = render(
      <CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>,
    )
    await waitFor(() => {
      expect(screen.getByText('今天先联系').getAttribute('aria-current')).toBe('page')
    })
    unmount()

    navState.search = 'view=all'
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('全部客人').getAttribute('aria-current')).toBe('page')
    })
    expect(screen.getByText('今天先联系').getAttribute('aria-current')).toBeNull()
  })

  it('survives a throwing localStorage', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '展开左侧菜单' })).toBeTruthy()
    })
    expect(hasCollapsedStyle()).toBe(true)
  })

  it('renders children', () => {
    render(
      <CrmWorkspaceShell clientId={CLIENT}>
        <p>child content</p>
      </CrmWorkspaceShell>,
    )
    expect(screen.getByText('child content')).toBeTruthy()
  })
})

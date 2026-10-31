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

import { CrmWorkspaceShell } from '../CrmWorkspaceShell'
import { resetCrmNavProbeCache } from '../useCrmNavAccess'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BASE = `/dashboard/clients/${CLIENT}`

let bookingsStatus = 403
let templatesBody: { featureState?: string; canEditSettings?: boolean } = {
  featureState: 'disabled',
  canEditSettings: false,
}

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/crm/bookings/access')) {
        return new Response('{}', { status: bookingsStatus })
      }
      if (url.includes('/crm/email-templates')) {
        return new Response(JSON.stringify(templatesBody), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }),
  )
}

function sidebarAttr(): string | null {
  return document.querySelector('[data-crm-sidebar]')?.getAttribute('data-crm-sidebar') ?? null
}

function styleText(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('')
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
  resetCrmNavProbeCache()
  navState.path = `${BASE}/crm/all`
  navState.search = ''
  bookingsStatus = 403
  templatesBody = { featureState: 'disabled', canEditSettings: false }
  stubFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CrmWorkspaceShell', () => {
  it('defaults to collapsed with empty storage', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    expect(sidebarAttr()).toBe('closed')
    expect(styleText()).toContain('data-me-sidebar')
    expect(screen.getByRole('button', { name: '菜单' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('expands when storage says 0', async () => {
    localStorage.setItem('me.crm.sidebarCollapsed', '0')
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(sidebarAttr()).toBe('open')
    })
    expect(screen.getByRole('button', { name: '菜单' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('toggles and persists the state', async () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    await waitFor(() => {
      expect(sidebarAttr()).toBe('open')
    })
    expect(localStorage.getItem('me.crm.sidebarCollapsed')).toBe('0')

    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    await waitFor(() => {
      expect(sidebarAttr()).toBe('closed')
    })
    expect(localStorage.getItem('me.crm.sidebarCollapsed')).toBe('1')
  })

  it('links back to the ME dashboard with secondary styling', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    const link = screen.getByText('回 ME 主菜单').closest('a')
    expect(link?.getAttribute('href')).toBe('/dashboard')
    expect(link?.className ?? '').not.toContain('font-bold')
  })

  it('has no mail placeholder and no aria-disabled elements', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    expect(screen.queryByText('邮件 / 短信')).toBeNull()
    expect(document.querySelector('[aria-disabled]')).toBeNull()
  })

  it('hides bookings-gated items when the probe is 403', async () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('今天先联系')).toBeTruthy()
    })
    expect(screen.queryByText('付款总览')).toBeNull()
    expect(screen.queryByText('销售进度')).toBeNull()
    expect(screen.queryByText('到期日历')).toBeNull()
    expect(screen.getByText('全部客人')).toBeTruthy()
    expect(screen.getByText('设置')).toBeTruthy()
  })

  it('shows bookings-gated items when the probe is 200', async () => {
    bookingsStatus = 200
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('销售进度')).toBeTruthy()
    })
    expect(screen.getByText('付款总览').closest('a')?.getAttribute('href')).toMatch(
      /\/crm\/payments$/,
    )
    expect(screen.getByText('销售进度').closest('a')?.getAttribute('href')).toMatch(
      /\/sales-progress$/,
    )
    expect(screen.getByText('到期日历').closest('a')?.getAttribute('href')).toMatch(
      /\/crm\/calendar$/,
    )
  })

  it('renders nav items in the expected order', async () => {
    bookingsStatus = 200
    templatesBody = { featureState: 'ready' }
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('邮件模板')).toBeTruthy()
    })
    const nav = screen.getByRole('navigation', { name: '客户跟进导航' })
    const texts = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent)
    expect(texts).toEqual([
      '回 ME 主菜单',
      '今天先联系',
      '全部客人',
      '付款总览',
      '销售进度',
      '到期日历',
      '邮件模板',
      '设置',
    ])
  })

  it('shows 邮件模板 only when the feature is ready or I can configure it', async () => {
    const { unmount } = render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('今天先联系')).toBeTruthy()
    })
    expect(screen.queryByText('邮件模板')).toBeNull()
    unmount()

    resetCrmNavProbeCache()
    templatesBody = { featureState: 'ready' }
    const second = render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('邮件模板')).toBeTruthy()
    })
    expect(screen.getByText('邮件模板').closest('a')?.getAttribute('href')).toMatch(
      /\/crm\/templates$/,
    )
    second.unmount()

    resetCrmNavProbeCache()
    templatesBody = { featureState: 'x', canEditSettings: true }
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('邮件模板')).toBeTruthy()
    })
  })

  it('puts 邮件模板 and 设置 in the right-aligned group', async () => {
    templatesBody = { featureState: 'ready' }
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('邮件模板')).toBeTruthy()
    })
    expect(screen.getByText('邮件模板').closest('.ml-auto')).not.toBeNull()
    expect(screen.getByText('设置').closest('.ml-auto')).not.toBeNull()
    expect(screen.getByText('今天先联系').closest('.ml-auto')).toBeNull()
  })

  it('highlights the active nav item from the URL', async () => {
    navState.path = `${BASE}/crm/all`
    navState.search = ''
    const { unmount } = render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('今天先联系').getAttribute('aria-current')).toBe('page')
    })
    unmount()

    navState.search = 'view=all'
    const second = render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('全部客人').getAttribute('aria-current')).toBe('page')
    })
    expect(screen.getByText('今天先联系').getAttribute('aria-current')).toBeNull()
    second.unmount()

    // The earlier renders cached "no access" for five minutes; forget it before asking again.
    resetCrmNavProbeCache()
    bookingsStatus = 200
    navState.path = `${BASE}/crm/payments`
    navState.search = ''
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByText('付款总览')).toBeTruthy()
    })
    const payments = screen.getByText('付款总览')
    expect(payments.getAttribute('aria-current')).toBe('page')
    expect(payments.className).toContain('bg-me-charcoal')
    expect(screen.getByText('全部客人').getAttribute('aria-current')).toBeNull()
  })

  it('uses the expected sizes and accessible focus styles', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    const today = screen.getByText('今天先联系')
    expect(today.className).toContain('text-base')
    expect(today.className).toContain('px-4')
    expect(today.className).toContain('py-2.5')
    expect(today.className).toContain('focus-visible:ring-2')

    const nav = screen.getByRole('navigation', { name: '客户跟进导航' })
    expect(nav.className).toContain('min-h-[48px]')

    const sticky = nav.parentElement
    expect(sticky?.className ?? '').toContain('md:sticky')
    expect(sticky?.className ?? '').toContain('z-30')

    const classNames = Array.from(nav.querySelectorAll('*'))
      .map((el) => el.getAttribute('class') ?? '')
      .concat(nav.className)
    for (const cls of classNames) {
      expect(cls).not.toMatch(/text-me-charcoal\/(10|15|20|25|30|35|40|45|50|55)\b/)
    }
  })

  it('inlines an init script that restores the expanded state before paint', () => {
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    const script = document.querySelector('script')
    const text = script?.textContent ?? ''
    expect(text).toContain('me.crm.sidebarCollapsed')
    expect(text).toContain('data-crm-sidebar')
  })

  it('survives a throwing localStorage', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<CrmWorkspaceShell clientId={CLIENT}>body</CrmWorkspaceShell>)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '菜单' })).toBeTruthy()
    })
    expect(sidebarAttr()).toBe('closed')
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

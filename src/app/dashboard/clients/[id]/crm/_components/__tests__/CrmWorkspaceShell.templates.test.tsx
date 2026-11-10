/**
 * 顶部导航里的「邮件模板」入口：功能已开通，或者我是能去配置它的全局管理员，才显示。
 */

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

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

beforeEach(() => resetCrmNavProbeCache())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stub(templates: () => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/crm/email-templates')) return templates()
    if (url.includes('/crm/bookings/access')) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ client: { industry: 'travel' } }), { status: 200 })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const templateCalls = (mock: ReturnType<typeof stub>) => mock.mock.calls.filter((c) => String(c[0]).endsWith('/crm/email-templates'))

describe('CrmWorkspaceShell: 邮件模板 link', () => {
  it('shows when the feature is ready', async () => {
    stub(async () => json({ featureState: 'ready', canEditSettings: false }))
    render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    const link = await screen.findByRole('link', { name: /邮件模板/ })
    expect(link).toHaveAttribute('href', `/dashboard/clients/${ID}/crm/templates`)
  })

  it('shows for a global administrator even while the feature is off (so they can set it up)', async () => {
    stub(async () => json({ featureState: 'unconfigured', canEditSettings: true }))
    render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    expect(await screen.findByRole('link', { name: /邮件模板/ })).toBeInTheDocument()
  })

  it.each([
    ['the feature is off and I am not an administrator', async () => json({ featureState: 'disabled', canEditSettings: false })],
    ['the endpoint says no', async () => json({ error: 'x' }, 403)],
    ['the endpoint is broken', async () => json({ error: 'x' }, 503)],
    ['the answer is unrelated', async () => json({ client: {} })],
  ])('stays hidden when %s', async (_name, reply) => {
    const mock = stub(reply)
    render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(templateCalls(mock).length).toBeGreaterThan(0))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('link', { name: /邮件模板/ })).toBeNull()
  })

  it('a network failure hides it and is not cached', async () => {
    const mock = stub(async () => {
      throw new Error('offline')
    })
    const view = render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(templateCalls(mock).length).toBe(1))
    view.unmount()
    render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(templateCalls(mock).length).toBe(2))
  })

  it('an error answer is not cached either: the next page asks again', async () => {
    const mock = stub(async () => json({ error: 'x' }, 503))
    const view = render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(templateCalls(mock).length).toBe(1))
    view.unmount()
    render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    await waitFor(() => expect(templateCalls(mock).length).toBe(2))
  })

  it('remembers a good answer for five minutes (switching CRM pages does not ask again)', async () => {
    const mock = stub(async () => json({ featureState: 'ready', canEditSettings: false }))
    const view = render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    await screen.findByRole('link', { name: /邮件模板/ })
    view.unmount()
    render(<CrmWorkspaceShell clientId={ID}>body</CrmWorkspaceShell>)
    expect(await screen.findByRole('link', { name: /邮件模板/ })).toBeInTheDocument()
    expect(templateCalls(mock)).toHaveLength(1)
  })
})

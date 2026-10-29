/**
 * 抽屉里的「通话后发邮件」提示条（设计稿 §7.2）：
 *  · 放在回复区（drawer-replies）最前面
 *  · 功能没开通 / 读失败时什么都不渲染——回复区容器仍是空的（不占位）
 *  · 每个客人一个独立的提示条（换人不串状态）
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PersonDrawer, type DrawerRow } from '../PersonDrawer'

const row = (over: Partial<DrawerRow> = {}): DrawerRow => ({
  contactId: 'c1',
  name: 'Sue Masson',
  phone: '+64211234567',
  email: 'sue@example.com',
  stage: null,
  stageLabel: null,
  ...over,
})

const ready = {
  featureState: 'ready',
  templates: [{ key: 'post-call', version: 1, name: 'Post call', pickMode: 'none', factSource: 'none' }],
  callEvidenceAt: null,
  emailedSinceCall: false,
  canEditSettings: false,
}

function stub(postCall: { ok: boolean; body: unknown }) {
  const f = vi.fn(async (url: string) => {
    if (String(url).endsWith('/email/post-call')) return { ok: postCall.ok, status: postCall.ok ? 200 : 503, json: async () => postCall.body } as Response
    return { ok: true, status: 200, json: async () => ({ timeline: [], omittedMessages: 0 }) } as Response
  })
  vi.stubGlobal('fetch', f)
  return f
}

const draw = (r: DrawerRow = row()) =>
  render(<PersonDrawer clientId="cts" row={r} stages={[]} viewerEmail="fde@example.com" onClose={vi.fn()} onSaved={vi.fn()} />)

beforeEach(() => undefined)
afterEach(() => vi.unstubAllGlobals())

describe('PersonDrawer: post-call email bar', () => {
  it('appears first in the reply area when the feature is ready', async () => {
    const f = stub({ ok: true, body: ready })
    draw()
    const button = await screen.findByRole('button', { name: '用模板写邮件' })
    const replies = screen.getByTestId('drawer-replies')
    expect(replies.contains(button)).toBe(true)
    expect(replies.firstElementChild?.contains(button)).toBe(true)
    expect(f.mock.calls.some((c) => String(c[0]) === '/api/clients/cts/crm/contacts/c1/email/post-call')).toBe(true)
  })

  it.each([
    ['the feature is switched off', { ok: true, body: { ...ready, featureState: 'disabled', templates: [] } }],
    ['the read fails', { ok: false, body: {} }],
    ['there is no active template', { ok: true, body: { ...ready, templates: [] } }],
  ])('renders nothing (the reply area stays empty) when %s', async (_name, reply) => {
    const f = stub(reply)
    draw()
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).endsWith('/email/post-call'))).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByRole('button', { name: '用模板写邮件' })).toBeNull()
    expect(screen.getByTestId('drawer-replies')).toBeEmptyDOMElement()
  })

  it('a global administrator sees the grey "not available" line with the way to the settings', async () => {
    stub({ ok: true, body: { ...ready, featureState: 'unconfigured', templates: [], canEditSettings: true } })
    draw()
    expect(await screen.findByTestId('post-call-off')).toHaveTextContent('邮件模板功能还没配置')
  })

  it('an open template panel (with its draft) never carries over to the next guest', async () => {
    stub({ ok: true, body: ready })
    const view = draw(row({ contactId: 'c1' }))
    fireEvent.click(await screen.findByRole('button', { name: '用模板写邮件' }))
    expect(screen.getByTestId('template-email-panel')).toBeInTheDocument()
    view.rerender(
      <PersonDrawer clientId="cts" row={row({ contactId: 'c2', name: 'Other Person' })} stages={[]} viewerEmail="fde@example.com" onClose={vi.fn()} onSaved={vi.fn()} />,
    )
    expect(screen.queryByTestId('template-email-panel')).toBeNull()
  })

  it('asks about the guest that is open, and again when another guest is opened', async () => {
    const f = stub({ ok: true, body: ready })
    const view = draw(row({ contactId: 'c1' }))
    await screen.findByRole('button', { name: '用模板写邮件' })
    view.rerender(
      <PersonDrawer clientId="cts" row={row({ contactId: 'c2', name: 'Other Person' })} stages={[]} viewerEmail="fde@example.com" onClose={vi.fn()} onSaved={vi.fn()} />,
    )
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]) === '/api/clients/cts/crm/contacts/c2/email/post-call')).toBe(true))
  })
})

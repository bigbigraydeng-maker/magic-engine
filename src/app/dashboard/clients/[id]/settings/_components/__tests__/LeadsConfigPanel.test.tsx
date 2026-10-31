import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadsConfigPanel } from '../LeadsConfigPanel'

const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function mockFetch(responses: Array<{ ok?: boolean; json: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = []
  let i = 0
  global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = responses[Math.min(i, responses.length - 1)]
    i += 1
    return Promise.resolve({ ok: next.ok ?? true, json: async () => next.json })
  }) as unknown as typeof fetch
  return calls
}

afterEach(() => { vi.restoreAllMocks() })

describe('LeadsConfigPanel allowed events', () => {
  it('没填名单时显示不限制，保存发送 null', async () => {
    const calls = mockFetch([
      { json: { config: { mailchimpEnabled: false, mailchimpAudienceId: '', capiAllowedEvents: null } } },
      { json: { config: { mailchimpEnabled: false, mailchimpAudienceId: '', capiAllowedEvents: null } } },
    ])
    render(<LeadsConfigPanel clientId={CLIENT_ID} />)
    await waitFor(() => expect(screen.getByRole('radio', { name: /不限制/ })).toBeChecked())
    fireEvent.click(screen.getByRole('radio', { name: '只发勾选的' }))
    fireEvent.click(screen.getByRole('radio', { name: /不限制/ }))
    expect(screen.getByRole('button', { name: '保存发送名单' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: '只发勾选的' }))
    fireEvent.click(screen.getByRole('button', { name: '保存发送名单' }))
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeInTheDocument())
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ capiAllowedEvents: [] })
  })

  it('空名单和已勾选都能读出来，再存回去仍是清单', async () => {
    const calls = mockFetch([
      { json: { config: { capiAllowedEvents: [], capiAllowedEventsMalformed: false } } },
      { json: { config: { capiAllowedEvents: ['Purchase'] } } },
    ])
    render(<LeadsConfigPanel clientId={CLIENT_ID} />)
    await waitFor(() => expect(screen.getByRole('radio', { name: '只发勾选的' })).toBeChecked())
    expect(screen.getByText(/一项都没勾/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: '成交' }))
    fireEvent.click(screen.getByRole('button', { name: '保存发送名单' }))
    await waitFor(() => expect(screen.getByText(/已保存/)).toBeInTheDocument())
    const patch = calls.find((c) => c.init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ capiAllowedEvents: ['Purchase'] })
  })
})

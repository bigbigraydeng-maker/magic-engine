// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LitePreview } from '@/lib/social/story-lite/service'

import { useState } from 'react'

import { StoryPackView } from '../StoryPackView'

const CLIENT = '11111111-1111-4111-8111-111111111111'

function preview(overrides: Partial<LitePreview> = {}): LitePreview {
  return {
    pack_id: '22222222-2222-4222-8222-222222222222',
    client_id: CLIENT,
    title: '第3周',
    state: 'DRAFT',
    lifetime_days: 7,
    expires_at_if_authorized: '2026-10-20T00:00:00Z',
    content_hash: 'a'.repeat(64),
    can_authorize: true,
    blocking: [],
    items: [
      {
        item_id: 'i1',
        channel: 'facebook_story',
        slot_at: '2026-10-13T20:00:00Z',
        media_kind: 'image',
        media_url: 'https://example.com/a.jpg',
        text_line: '第一条',
        source_ref: 'https://example.com',
        status: 'PENDING',
        problems: [],
      },
    ],
    ...overrides,
  }
}

type ViewProps = Parameters<typeof StoryPackView>[0]

/** Renders the view the way the page does: the notice lives outside the view. */
function Host(props: Omit<ViewProps, 'onNotice'>) {
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <>
      {notice && <p role="status">{notice}</p>}
      <StoryPackView {...props} onNotice={setNotice} />
    </>
  )
}

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => cleanup())

describe('StoryPackView', () => {
  it('authorise sends the preview hash and confirm, and says what authorisation means in rehearsal', async () => {
    const fetchFn = mockFetch({ success: true })
    const onChanged = vi.fn(async () => {})
    render(<Host verified clientId={CLIENT} preview={preview()} live={false} otherAuthorized={0} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: '授权这一周' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/authorize')
    expect(JSON.parse(String(init.body))).toEqual({ confirm: true, lifetime_days: 7, content_hash: 'a'.repeat(64) })
    expect(await screen.findByText(/一旦开启真发/)).toBeTruthy()
  })

  it('a pack-level blocker (client not active) is shown in words and the button is disabled', () => {
    mockFetch({})
    render(
      <Host verified
        clientId={CLIENT}
        preview={preview({ can_authorize: false, blocking: ['CLIENT_NOT_ACTIVE'] })}
        live={false}
        otherAuthorized={0}
        onChanged={async () => {}}
      />,
    )
    expect(screen.getByText(/这个客户现在不是启用状态/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '授权这一周' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('stop needs a second click, names the week, and never says all-stopped while something is unsettled', async () => {
    const fetchFn = mockFetch({ success: true, sent: [{ item_id: 'x' }], in_flight: [{ item_id: 'y' }] })
    render(
      <Host verified clientId={CLIENT} preview={preview({ state: 'AUTHORIZED' })} live={false} otherAuthorized={0} onChanged={async () => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '停' }))
    expect(fetchFn).not.toHaveBeenCalled()
    expect(screen.getByText(/只停「第3周」这一周/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确定停' }))
    const text = await screen.findByText(/已停「第3周」/)
    expect(text.textContent).toContain('1 条不会撤回')
    expect(text.textContent).toContain('核对')
  })

  it('warns when other weeks are still authorised', () => {
    mockFetch({})
    render(<Host verified clientId={CLIENT} preview={preview()} live={false} otherAuthorized={2} onChanged={async () => {}} />)
    expect(screen.getByText(/另外还有 2 周也处于已授权状态/)).toBeTruthy()
  })

  it('after an authorised pack, per-item "cannot authorise" problems are not shown as red faults', () => {
    mockFetch({})
    const p = preview({ state: 'AUTHORIZED' })
    p.items[0].problems = ['NOT_PENDING', 'SLOT_IN_PAST']
    render(<Host verified clientId={CLIENT} preview={p} live={false} otherAuthorized={0} onChanged={async () => {}} />)
    expect(screen.queryByText(/已经处理过了/)).toBeNull()
  })

  it('a lost network answer says "not sure it worked" and refreshes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const onChanged = vi.fn(async () => {})
    render(<Host verified clientId={CLIENT} preview={preview()} live={false} otherAuthorized={0} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: '授权这一周' }))
    expect(await screen.findByText(/不确定有没有成功/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('stays busy until the refresh finished, so a second click cannot hit the old state', async () => {
    const fetchFn = mockFetch({ success: true })
    let release: () => void = () => {}
    const onChanged = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    render(<Host verified clientId={CLIENT} preview={preview()} live={false} otherAuthorized={0} onChanged={onChanged} />)
    const button = screen.getByRole('button', { name: '授权这一周' }) as HTMLButtonElement
    fireEvent.click(button)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
  })

  it('a stopped week does not show its unsent stories as waiting', () => {
    mockFetch({})
    render(<Host verified clientId={CLIENT} preview={preview({ state: 'REVOKED' })} live={false} otherAuthorized={0} onChanged={async () => {}} />)
    expect(screen.getByText(/已停，不会发/)).toBeTruthy()
    expect(screen.queryByText(/等待发布/)).toBeNull()
  })

  it('if the sent/in-flight summary could not be read, the stop notice says so instead of "all stopped"', async () => {
    mockFetch({ success: true, sent: [], in_flight: [], summary_available: false })
    render(<Host verified clientId={CLIENT} preview={preview({ state: 'AUTHORIZED' })} live={false} otherAuthorized={0} onChanged={async () => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '停' }))
    fireEvent.click(screen.getByRole('button', { name: '确定停' }))
    const text = await screen.findByText(/读不到哪些已经发出去/)
    expect(text.textContent).toContain('核对')
  })

  it('the stop notice is set BEFORE the refresh, so a slow or failed refresh cannot hide it', async () => {
    mockFetch({ success: true, sent: [{ item_id: 'x' }], in_flight: [] })
    const onChanged = vi.fn(() => new Promise<void>(() => {})) // a refresh that never comes back
    render(<Host verified clientId={CLIENT} preview={preview({ state: 'AUTHORIZED' })} live={false} otherAuthorized={0} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: '停' }))
    fireEvent.click(screen.getByRole('button', { name: '确定停' }))
    expect(await screen.findByText(/已停「第3周」/)).toBeTruthy()
  })

  it('while the pictures are still being re-checked, authorising stays off and says why', () => {
    mockFetch({})
    render(<StoryPackView clientId={CLIENT} preview={preview()} live={false} verified={false} otherAuthorized={0} onChanged={async () => {}} onNotice={() => {}} />)
    expect((screen.getByRole('button', { name: '授权这一周' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/正在核对图片/)).toBeTruthy()
  })
})

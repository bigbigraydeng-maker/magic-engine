/**
 * Tests for the send box.
 *
 * The PM decision this feature rests on is "AI 草稿必须有人点才发" — the AI
 * writes, a person sends. That is a UI promise, so it is pinned here:
 *   - showing a draft must never send it
 *   - send is behind an explicit confirm
 *   - a closed window cannot be sent into from the UI (the server refuses too)
 *   - usedAiDraft tells the audit log the truth about who wrote the words
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReplyBox } from '../ReplyBox'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONVO = 'convo-1'
const DRAFT = 'Happy to help — I will send the itinerary today.'

function renderBox(overrides: Partial<Parameters<typeof ReplyBox>[0]> = {}) {
  const onSent = vi.fn()
  render(
    <ReplyBox
      clientId={CLIENT}
      conversationId={CONVO}
      customerName="Kam"
      draft={DRAFT}
      window={{ kind: 'standard', msRemaining: 6 * 3_600_000 }}
      viewerEmail="bdm@ctstours.co.nz"
      onSent={onSent}
      {...overrides}
    />,
  )
  return { onSent }
}

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, window: 'standard' }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.spyOn(globalThis, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ReplyBox — the AI never sends by itself', () => {
  it('shows the draft without sending anything', () => {
    const fetchMock = mockFetchOk()
    renderBox()

    expect(screen.getByRole('textbox')).toHaveValue(DRAFT)
    expect(screen.getByText(/还没发出去/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing when the person cancels the confirm', async () => {
    const fetchMock = mockFetchOk()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names the customer in the confirm so nobody sends to the wrong thread', async () => {
    mockFetchOk()
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('Kam'))
  })
})

describe('ReplyBox — audit honesty', () => {
  it('reports usedAiDraft when the words are still the AI’s', async () => {
    const fetchMock = mockFetchOk()
    const { onSent } = renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      body: DRAFT,
      usedAiDraft: true,
    })
    expect(onSent).toHaveBeenCalled()
  })

  it('reports usedAiDraft false once a human has edited the draft', async () => {
    const fetchMock = mockFetchOk()
    renderBox()

    await userEvent.type(screen.getByRole('textbox'), ' Call me on 0800 287 888.')
    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).usedAiDraft).toBe(false)
  })

  it('never claims AI authorship for a reply typed from scratch', async () => {
    const fetchMock = mockFetchOk()
    renderBox({ draft: null })

    await userEvent.type(screen.getByRole('textbox'), 'Typed by hand.')
    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).usedAiDraft).toBe(false)
  })
})

describe('ReplyBox — refusals', () => {
  it('disables send when Facebook’s window has closed', () => {
    mockFetchOk()
    renderBox({ window: { kind: 'closed', msRemaining: 0 } })

    expect(screen.getByRole('button', { name: '发送给客户' })).toBeDisabled()
    expect(screen.getByText(/请改用电话或邮件/)).toBeInTheDocument()
  })

  it('disables send on an empty box', () => {
    mockFetchOk()
    renderBox({ draft: '   ' })

    expect(screen.getByRole('button', { name: '发送给客户' })).toBeDisabled()
  })

  it('explains a closed window in plain language instead of showing a status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'window closed', reason: 'window_closed' }),
      }),
    )
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/请改用电话或邮件联系客户/)).toBeInTheDocument()
    expect(screen.queryByText(/409/)).not.toBeInTheDocument()
  })

  it('keeps the typed text on screen when the send fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'graph failed', reason: 'graph_failed' }),
      }),
    )
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/稍等一分钟再试一次/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue(DRAFT)
  })

  it('explains that an inbound stop signal needs review instead of calling it a closed window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'review first', reason: 'dnc_review_required' }),
      }),
    )
    renderBox()

    await userEvent.click(screen.getByRole('button', { name: '发送给客户' }))

    expect(await screen.findByText(/核对原话并记录处理结果/)).toBeInTheDocument()
    expect(screen.queryByText(/Facebook 已经不让回/)).not.toBeInTheDocument()
  })
})

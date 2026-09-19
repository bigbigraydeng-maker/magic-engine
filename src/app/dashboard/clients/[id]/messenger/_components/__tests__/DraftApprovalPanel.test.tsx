/**
 * Tests for the "AI 草稿 · 待批准" tab (Issue #1588).
 *
 * The behaviours worth pinning:
 *   - all three buttons hit the same reply endpoint's draft-decision shape
 *     ({ draft_id, action, edited_body? }), not a bespoke one
 *   - each action is behind an explicit confirm naming the customer, same
 *     discipline as the free-text send box
 *   - a decided draft (approve/edit/reject) disappears from the panel —
 *     it is no longer awaiting a human
 *   - "改后发送" sends the edited text, not the original draft_body
 *   - the AI-origin badge never leaks into the textarea a human would submit
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftApprovalPanel } from '../DraftApprovalPanel'
import type { PendingDraft } from '../../types'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const CONVO = 'convo-1'

function draft(overrides: Partial<PendingDraft> = {}): PendingDraft {
  return {
    id: 'draft-1',
    draftBody: 'Kia ora — here is the itinerary for Golden China 12-Day.',
    agentConfidence: 0.82,
    quotedOfferingNames: ['Golden China 12-Day'],
    verifierOutputJson: { ok: true, blocked_reasons: [] },
    passedGateIds: ['brand_redline', 'length'],
    createdAt: '2026-09-15T01:00:00Z',
    ...overrides,
  }
}

function renderPanel(overrides: Partial<Parameters<typeof DraftApprovalPanel>[0]> = {}) {
  const onDecided = vi.fn()
  const onRejected = vi.fn()
  render(
    <DraftApprovalPanel
      clientId={CLIENT}
      conversationId={CONVO}
      customerName="Kam"
      drafts={[draft()]}
      draftsError={null}
      lastCustomerMessage={{
        direction: 'inbound',
        senderName: 'Kam',
        body: 'Hi, is the Golden China tour still available?',
        sentAt: '2026-09-15T00:00:00Z',
      }}
      onDecided={onDecided}
      onRejected={onRejected}
      {...overrides}
    />,
  )
  return { onDecided, onRejected }
}

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, verifier_status: 'approved' }),
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

describe('DraftApprovalPanel — one screen to review', () => {
  it('shows the customer message, the draft, confidence, and quoted products together', () => {
    mockFetchOk()
    renderPanel()

    expect(screen.getByText(/Golden China tour still available/)).toBeInTheDocument()
    expect(screen.getByText(/Kia ora — here is the itinerary/)).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
    expect(screen.getByText('Golden China 12-Day')).toBeInTheDocument()
  })

  it('lists the verifier gates the draft cleared', () => {
    mockFetchOk()
    renderPanel()

    expect(screen.getByText(/已过 2 项自动核验/)).toBeInTheDocument()
    expect(screen.getByText(/品牌红线用词/)).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing to approve', () => {
    mockFetchOk()
    renderPanel({ drafts: [] })

    expect(screen.getByText(/现在没有等待批准的 AI 草稿/)).toBeInTheDocument()
  })

  it('shows the loading state while drafts are still being fetched', () => {
    mockFetchOk()
    renderPanel({ drafts: null })

    expect(screen.getByText('读取中…')).toBeInTheDocument()
  })

  it('surfaces a fetch error instead of an empty panel', () => {
    mockFetchOk()
    renderPanel({ drafts: null, draftsError: '草稿读不出来' })

    expect(screen.getByText('草稿读不出来')).toBeInTheDocument()
  })
})

describe('DraftApprovalPanel — 批准发送', () => {
  it('confirms naming the customer, then posts the draft-decision shape', async () => {
    const fetchMock = mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '批准发送' }))

    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('Kam'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/clients/${CLIENT}/messenger/conversations/${CONVO}/reply`,
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      draft_id: 'draft-1',
      action: 'approve',
    })
  })

  it('removes the draft from the panel once approved', async () => {
    mockFetchOk()
    const { onDecided } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '批准发送' }))

    await waitFor(() => expect(onDecided).toHaveBeenCalledWith('draft-1'))
  })

  it('sends nothing when the person cancels the confirm', async () => {
    const fetchMock = mockFetchOk()
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '批准发送' }))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the backend error verbatim on a 409 (lost the concurrency race)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: '这条草稿现在不是待批准状态', reason: 'not_pending' }),
      }),
    )
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '批准发送' }))

    expect(await screen.findByText('这条草稿现在不是待批准状态')).toBeInTheDocument()
  })
})

describe('DraftApprovalPanel — 改后发送', () => {
  it('opens an editable textarea seeded with the original draft', async () => {
    mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '改后发送' }))

    expect(screen.getByRole('textbox')).toHaveValue(
      'Kia ora — here is the itinerary for Golden China 12-Day.',
    )
  })

  it('sends the edited text, not the AI original, as edited_body', async () => {
    const fetchMock = mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '改后发送' }))
    const box = screen.getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, 'Hi Kam, yes it is still available.')
    await userEvent.click(screen.getByRole('button', { name: '确认发送改后内容' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      draft_id: 'draft-1',
      action: 'edit_and_approve',
      edited_body: 'Hi Kam, yes it is still available.',
    })
  })

  it('never leaks the internal AI-origin badge text into the editable draft', async () => {
    mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '改后发送' }))

    expect(screen.getByRole('textbox')).not.toHaveValue(expect.stringContaining('AI 起草'))
  })

  it('cancelling the edit restores the original text without sending', async () => {
    const fetchMock = mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '改后发送' }))
    await userEvent.type(screen.getByRole('textbox'), ' extra words')
    await userEvent.click(screen.getByRole('button', { name: '取消改稿' }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '批准发送' })).toBeInTheDocument()
  })
})

describe('DraftApprovalPanel — 拒绝并接管', () => {
  it('posts action: reject and never notifies via the approve path', async () => {
    const fetchMock = mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '拒绝并接管' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      draft_id: 'draft-1',
      action: 'reject',
    })
  })

  it('calls onRejected (not onDecided) so the card can hand control to a human', async () => {
    mockFetchOk()
    const { onDecided, onRejected } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '拒绝并接管' }))

    await waitFor(() => expect(onRejected).toHaveBeenCalledWith('draft-1'))
    expect(onDecided).not.toHaveBeenCalled()
  })

  it('the confirm text warns nothing will be sent automatically', async () => {
    mockFetchOk()
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '拒绝并接管' }))

    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('不会有任何内容发给'))
  })
})

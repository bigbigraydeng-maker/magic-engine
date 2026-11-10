import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GO_LIVE_CONFIRM_HREF, GO_LIVE_CONFIRM_LABEL, GO_LIVE_WHAT } from '@/lib/ads-strategy/paused-draft-copy'
import { CardList } from '../card-list'

const CLIENT = 'client-1'
const GO_LIVE_RUN = '40000000-0000-4000-8000-000000001111'
const OTHER_RUN = '40000000-0000-4000-8000-000000002222'

function row(what: string, runId: string) {
  return {
    runId,
    expectedDecisionId: '22222222-2222-4222-8222-222222222222',
    fingerprint: 'a'.repeat(64),
    what,
    account: '演示账户',
    amount: '金额读不到',
    date: '开始日读不到',
    scope: '只开这一条',
    expiresLabel: '请在时限前点。',
    statusLine: '还没人点。',
    confirmEnabled: true,
    declineEnabled: true,
    blockedReason: null,
  }
}

describe('确认卡 page routes a go-live card', () => {
  it('links the go-live card to the approval page and posts other cards to the generic decision', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return {
          ok: true,
          json: async () => ({ cards: [row(GO_LIVE_WHAT, GO_LIVE_RUN), row('记下要不要调每周预算', OTHER_RUN)] }),
        }
      }
      return { ok: true, json: async () => row('记下要不要调每周预算', OTHER_RUN) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CardList clientId={CLIENT} />)
    const link = await screen.findByRole('link', { name: GO_LIVE_CONFIRM_LABEL })
    expect(link.getAttribute('href')).toBe(GO_LIVE_CONFIRM_HREF)

    const goLiveButton = screen.getAllByRole('button', { name: '确认' }).find((button) => button.hasAttribute('disabled'))
    expect(goLiveButton).toBeTruthy()
    fireEvent.click(goLiveButton as HTMLButtonElement)
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(
      `/api/clients/${CLIENT}/confirmation-cards/${GO_LIVE_RUN}/decision`,
    )

    const other = screen.getAllByRole('button', { name: '确认' }).find((button) => !button.hasAttribute('disabled'))
    fireEvent.click(other as HTMLButtonElement)
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(
        `/api/clients/${CLIENT}/confirmation-cards/${OTHER_RUN}/decision`,
      )
    })
  })
})

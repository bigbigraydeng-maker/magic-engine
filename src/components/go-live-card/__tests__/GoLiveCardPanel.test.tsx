import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GoLiveCardPanel } from '../GoLiveCardPanel'

const CLIENT = 'client-1'
const DRAFT = 'draft-1'

function card(confirmEnabled: boolean) {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    expectedDecisionId: '22222222-2222-4222-8222-222222222222',
    fingerprint: 'a'.repeat(64),
    what: '开投：把暂停的广告改成在投',
    account: '演示广告账户',
    amount: '每天 40，按这个广告账户自己的货币',
    date: '从点下去的这一天开始，计划跑 7 天',
    scope: '开到广告、广告组和广告系列这三层',
    expiresLabel: '30 分钟内有效',
    statusLine: '这件事还没有开始做',
    confirmEnabled,
    declineEnabled: true,
    blockedReason: confirmEnabled ? null : '像素在线：还不是绿灯',
  }
}

describe('GoLiveCardPanel', () => {
  it('issues the shared card and posts a click to the go-live decision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          card: card(true),
          resultLine: '还没有人点。点确认之前不会开投。',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          card: { ...card(false), confirmEnabled: false, declineEnabled: false },
          resultLine: 'opc@example.com点了确认。读回：广告系列在投。开投观察从现在开始计时。',
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<GoLiveCardPanel clientId={CLIENT} draftId={DRAFT} />)
    expect(await screen.findByText('还没有人点。点确认之前不会开投。')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${CLIENT}/go-live-cards`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ draftId: DRAFT }) }),
    )

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => {
      expect(screen.getByText(/开投观察从现在开始计时/)).toBeTruthy()
    })
    const decisionCall = fetchMock.mock.calls[1]
    expect(String(decisionCall?.[0])).toBe(`/api/clients/${CLIENT}/go-live-cards/${DRAFT}/decision`)
    expect(String(decisionCall?.[0])).not.toContain('/api/ad-approval')
    const posted = JSON.parse(String(decisionCall?.[1]?.body)) as { resolution: string }
    expect(posted.resolution).toBe('confirm')
  })

  it('keeps confirm disabled when the card says it is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ card: card(false), resultLine: '还没有人点。点确认之前不会开投。' }),
    }))
    render(<GoLiveCardPanel clientId={CLIENT} draftId={DRAFT} />)
    const button = await screen.findByRole('button', { name: '确认' })
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByText('像素在线：还不是绿灯')).toBeTruthy()
  })
})

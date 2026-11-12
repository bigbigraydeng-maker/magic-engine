import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PauseAdSetCardSwitchPanel } from '../PauseAdSetCardSwitchPanel'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const BASE = `/api/clients/${CLIENT_ID}/ad-strategy-config/pause-ad-set-card`

function mockFetchSequence(responses: Array<{ status?: number; json: unknown }>) {
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]
      i += 1
      const status = r.status ?? 200
      return new Response(JSON.stringify(r.json), { status })
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PauseAdSetCardSwitchPanel', () => {
  it('reflects GET enabled on the switch', async () => {
    mockFetchSequence([{ json: { enabled: false } }])
    render(<PauseAdSetCardSwitchPanel clientId={CLIENT_ID} />)

    const toggle = await screen.findByRole('switch', { name: '开关暂停广告组确认卡' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('已关闭')).toBeInTheDocument()
  })

  it('toggle on → POST enabled true', async () => {
    mockFetchSequence([
      { json: { enabled: false } },
      { json: { enabled: true } },
    ])
    render(<PauseAdSetCardSwitchPanel clientId={CLIENT_ID} />)

    const toggle = await screen.findByRole('switch', { name: '开关暂停广告组确认卡' })
    fireEvent.click(toggle)

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(global.fetch).toHaveBeenLastCalledWith(
      BASE,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      }),
    )
  })

  it('403 → shows API error and keeps switch on', async () => {
    mockFetchSequence([
      { json: { enabled: true } },
      { status: 403, json: { error: '你不能改这个开关。' } },
    ])
    render(<PauseAdSetCardSwitchPanel clientId={CLIENT_ID} />)

    const toggle = await screen.findByRole('switch', { name: '开关暂停广告组确认卡' })
    fireEvent.click(toggle)

    await waitFor(() => {
      expect(screen.getByText(/你不能改这个开关/)).toBeInTheDocument()
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})

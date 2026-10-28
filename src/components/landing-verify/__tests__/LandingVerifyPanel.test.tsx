import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LandingVerifyPanel } from '../LandingVerifyPanel'

const blocked = {
  lines: ['打得开吗：没通过。页面没有打开'],
  headline: '落地页没通过，还没有人确认，还不能开投。',
  card: null,
  clear: false,
}

const clear = {
  lines: ['打得开吗：通过。页面能打开'],
  headline: '落地页已核实。可以继续看开投。',
  card: null,
  clear: true,
}

describe('LandingVerifyPanel', () => {
  it('shows the check in plain words and can look again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => blocked })
      .mockResolvedValueOnce({ ok: true, json: async () => clear })
    vi.stubGlobal('fetch', fetchMock)
    const settled = vi.fn()
    render(
      <LandingVerifyPanel
        clientId="client-1"
        draftId="draft-1"
        onSettled={settled}
        onChanged={() => undefined}
      />,
    )
    expect(await screen.findByText('落地页没通过，还没有人确认，还不能开投。')).toBeInTheDocument()
    expect(screen.getByText('打得开吗：没通过。页面没有打开')).toBeInTheDocument()
    expect(settled).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '再查一次' }))
    expect(await screen.findByText('落地页已核实。可以继续看开投。')).toBeInTheDocument()
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    expect(body).toEqual({ draftId: 'draft-1', again: true })
  })
})

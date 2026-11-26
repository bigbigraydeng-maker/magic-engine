import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import OutsideChangePanel from '../outside-change-panel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body }
}

describe('OutsideChangePanel', () => {
  it('shows the tag with where, what, and New Zealand time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      changes: [{
        kind: 'budget',
        where: '广告组 · North',
        what: '每天预算 NZD 50 → NZD 60',
        capturedAt: '2026-10-30T00:28:00.000Z',
        entityId: 'set-1',
      }],
    })))
    render(<OutsideChangePanel clientId="client-1" />)
    expect((await screen.findAllByText('ME 外改动')).length).toBeGreaterThan(0)
    expect(screen.getByText(/广告组 · North/)).toBeTruthy()
    expect(screen.getByText(/每天预算 NZD 50 → NZD 60/)).toBeTruthy()
    expect(screen.getByText(/NZDT/)).toBeTruthy()
  })

  it('renders nothing when there is no unmatched change', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, changes: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<OutsideChangePanel clientId="client-1" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('ME 外改动')).toBeNull()
  })
})

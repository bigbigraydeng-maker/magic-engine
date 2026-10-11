/**
 * CampaignPanel — expired active campaigns fold into the collapsed "已结束" group.
 * No data is deleted; they are only hidden until the group is expanded.
 */
import React from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { CampaignPanel } from '../CampaignPanel'

vi.mock('../VisualDirectionSection', () => ({ VisualDirectionSection: () => null }))

const base = { client_id: 'c1', status: 'active' as const }

describe('CampaignPanel expired grouping', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('hides expired campaigns until the ended group is expanded', async () => {
    const campaigns = [
      { ...base, id: 'a', title: 'Live Campaign', valid_until: '2999-01-01' },
      { ...base, id: 'b', title: 'Old Campaign', valid_until: '2020-01-01' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ campaigns: String(url).includes('status=active') ? campaigns : [] }),
    })))

    render(<CampaignPanel clientId="c1" />)
    await waitFor(() => expect(screen.getByText('Live Campaign')).toBeTruthy())
    expect(screen.queryByText('Old Campaign')).toBeNull()

    fireEvent.click(screen.getByText(/已结束的活动/))
    await waitFor(() => expect(screen.getByText('Old Campaign')).toBeTruthy())
  })
})

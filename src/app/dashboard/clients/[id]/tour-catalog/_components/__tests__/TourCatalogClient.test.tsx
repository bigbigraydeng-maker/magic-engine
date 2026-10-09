import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TourCatalogClient } from '../TourCatalogClient'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('TourCatalogClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the AI assistant panel when tours exist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        tours: [
          {
            id: 't1',
            slug: 'silk-road',
            destination: 'China',
            tier: 'standard',
            name: 'Silk Road',
            displayPriceText: 'From NZD $4,999 per person',
            isActive: true,
            managesDepartures: true,
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
        departures: [],
        aliases: [],
        batches: [],
        domain: 'example.com',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<TourCatalogClient clientId="c1" />)
    await waitFor(() => expect(screen.getAllByText('AI 助手')[0]).toBeTruthy())
  })
})

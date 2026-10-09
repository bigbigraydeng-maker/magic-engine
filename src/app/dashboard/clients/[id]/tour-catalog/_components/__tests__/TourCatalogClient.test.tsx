import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TourCatalogClient } from '../TourCatalogClient'
import type { CatalogSnapshotResponse } from '../types'

function snapshot(overrides: Partial<CatalogSnapshotResponse> = {}): CatalogSnapshotResponse {
  return {
    tours: [],
    departures: [],
    aliases: [],
    batches: [],
    ...overrides,
  }
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

const CLIENT_ID = 'c1'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TourCatalogClient', () => {
  it('renders tour names and the upcoming departure count', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        snapshot({
          tours: [
            {
              id: 't1',
              slug: 'a',
              destination: 'JP',
              tier: 'std',
              name: '东京五日',
              displayPriceText: '¥8999',
              isActive: true,
              managesDepartures: true,
            },
            {
              id: 't2',
              slug: 'b',
              destination: 'JP',
              tier: 'std',
              name: '大阪四日',
              displayPriceText: null,
              isActive: true,
              managesDepartures: false,
            },
          ],
          departures: [
            {
              id: 'd1',
              tourId: 't1',
              departOn: '2999-01-01',
              returnOn: '2999-01-05',
              status: 'open',
              priceTextOverride: null,
            },
            {
              id: 'd2',
              tourId: 't1',
              departOn: '2999-02-01',
              returnOn: '2999-02-05',
              status: 'limited',
              priceTextOverride: null,
            },
            {
              id: 'd3',
              tourId: 't1',
              departOn: '2000-01-01',
              returnOn: '2000-01-05',
              status: 'open',
              priceTextOverride: null,
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    expect(await screen.findByText('东京五日')).toBeInTheDocument()
    expect(screen.getByText('大阪四日')).toBeInTheDocument()
    expect(screen.getByText('即将出发 2 个班期')).toBeInTheDocument()
    expect(screen.getByText('即将出发 0 个班期')).toBeInTheDocument()
    expect(screen.getByText('不管理班期')).toBeInTheDocument()
  })

  it('shows the empty state and posts the domain when seeding', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(snapshot()))
      .mockResolvedValueOnce(jsonResponse({ tours: 3, departures: 7 }))
      .mockResolvedValueOnce(jsonResponse(snapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    expect(await screen.findByText('还没有任何团')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('网站域名'), {
      target: { value: 'example.com' },
    })
    fireEvent.click(screen.getByText('从网站导入现有的团'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/clients/${CLIENT_ID}/tour-catalog/seed`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ domain: 'example.com' }),
        }),
      )
    })
  })

  it('only shows the rollback button on applied batches and posts on confirm', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          snapshot({
            tours: [
              {
                id: 't1',
                slug: 'a',
                destination: 'JP',
                tier: 'std',
                name: '东京五日',
                displayPriceText: null,
                isActive: true,
                managesDepartures: true,
              },
            ],
            batches: [
              {
                id: 'b1',
                kind: 'csv',
                status: 'applied',
                rowCounts: { adds: 2, updates: 1 },
                createdAt: '2024-01-01',
              },
              {
                id: 'b2',
                kind: 'csv',
                status: 'previewed',
                rowCounts: {},
                createdAt: '2024-01-02',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(snapshot()))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    const buttons = await screen.findAllByText('撤销这次导入')
    expect(buttons).toHaveLength(1)

    fireEvent.click(buttons[0])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/clients/${CLIENT_ID}/tour-catalog/batches/b1/rollback`,
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('does not post when the rollback confirm is declined', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        snapshot({
          tours: [
            {
              id: 't1',
              slug: 'a',
              destination: 'JP',
              tier: 'std',
              name: '东京五日',
              displayPriceText: null,
              isActive: true,
              managesDepartures: true,
            },
          ],
          batches: [
            {
              id: 'b1',
              kind: 'csv',
              status: 'applied',
              rowCounts: {},
              createdAt: '2024-01-01',
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    fireEvent.click(await screen.findByText('撤销这次导入'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the error state with a retry button', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'feed_unavailable' }, false, 500))
      .mockResolvedValueOnce(jsonResponse(snapshot()))
    vi.stubGlobal('fetch', fetchMock)

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    expect(await screen.findByText('网站暂时读取不到')).toBeInTheDocument()
    fireEvent.click(screen.getByText('重试'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  it('includes the batch row counts in the rollback confirm message', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        snapshot({
          tours: [
            {
              id: 't1',
              slug: 'a',
              destination: 'JP',
              tier: 'std',
              name: '东京五日',
              displayPriceText: null,
              isActive: true,
              managesDepartures: true,
            },
          ],
          batches: [
            {
              id: 'b1',
              kind: 'csv',
              status: 'applied',
              rowCounts: { adds: 3, updates: 2 },
              createdAt: '2024-01-01',
            },
          ],
        }),
      ),
    )
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', confirmMock)

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    fireEvent.click(await screen.findByText('撤销这次导入'))

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledTimes(1)
    })
    const message = confirmMock.mock.calls[0][0] as string
    expect(message).toContain('3')
    expect(message).toContain('2')
  })

  it('shows 价格待定 when the price text contains TBC', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        snapshot({
          tours: [
            {
              id: 't1',
              slug: 'a',
              destination: 'JP',
              tier: 'std',
              name: '东京五日',
              displayPriceText: 'TBC',
              isActive: true,
              managesDepartures: true,
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    expect(await screen.findByText('价格待定')).toBeInTheDocument()
  })

  it('lists aliases with their tour names and deletes on confirm', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          snapshot({
            tours: [
              {
                id: 't1',
                slug: 'a',
                destination: 'JP',
                tier: 'std',
                name: '东京五日',
                displayPriceText: null,
                isActive: true,
                managesDepartures: true,
              },
            ],
            aliases: [{ aliasNorm: '东京5日', tourId: 't1' }],
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(snapshot()))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    expect(await screen.findByText('已记住的叫法')).toBeInTheDocument()
    expect(screen.getByText('东京5日')).toBeInTheDocument()
    // The tour name appears both in the tour list and next to its alias.
    expect(screen.getAllByText('东京五日')).toHaveLength(2)

    fireEvent.click(screen.getByText('删除'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/clients/${CLIENT_ID}/tour-catalog/aliases`,
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ aliasNorm: '东京5日' }),
        }),
      )
    })
  })

  it('does not delete an alias when the confirm is declined', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        snapshot({
          tours: [
            {
              id: 't1',
              slug: 'a',
              destination: 'JP',
              tier: 'std',
              name: '东京五日',
              displayPriceText: null,
              isActive: true,
              managesDepartures: true,
            },
          ],
          aliases: [{ aliasNorm: '东京5日', tourId: 't1' }],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    fireEvent.click(await screen.findByText('删除'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  it('shows the empty alias message when there are no aliases', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(
        snapshot({
          tours: [
            {
              id: 't1',
              slug: 'a',
              destination: 'JP',
              tier: 'std',
              name: '东京五日',
              displayPriceText: null,
              isActive: true,
              managesDepartures: true,
            },
          ],
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<TourCatalogClient clientId={CLIENT_ID} />)

    expect(await screen.findByText('还没有记住任何叫法')).toBeInTheDocument()
  })
})

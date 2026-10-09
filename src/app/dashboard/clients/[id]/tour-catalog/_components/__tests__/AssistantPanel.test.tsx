import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssistantPanel } from '../AssistantPanel'
import type { CatalogDepartureView, CatalogTourView } from '../types'

const tours: CatalogTourView[] = [
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
    itinerary: [
      { day: 1, title: 'Arrival', description: 'Arrive' },
      { day: 2, title: 'Old title', description: 'Old body' },
    ],
  },
]

const departures: CatalogDepartureView[] = [
  {
    id: 'd1',
    tourId: 't1',
    departOn: '2027-05-13',
    returnOn: '2027-05-20',
    status: 'open',
    priceTextOverride: null,
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

function renderPanel(onApplied = vi.fn()) {
  render(
    <AssistantPanel
      clientId="c1"
      tours={tours}
      departures={departures}
      onApplied={onApplied}
    />,
  )
  return onApplied
}

async function sendMessage(text: string) {
  const box = screen.getByPlaceholderText('用大白话告诉我要改什么…')
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByText('发送'))
}

const priceProposal = {
  proposal: {
    kind: 'update_tour' as const,
    tourId: 't1',
    summary: '改展示价',
    patch: { displayPriceText: 'From NZD $5,999 per person' },
  },
  check: { ok: true as const },
}

const itineraryProposal = {
  proposal: {
    kind: 'update_tour' as const,
    tourId: 't1',
    summary: '改第 2 天标题',
    patch: {
      itinerary: [
        { day: 1, title: 'Arrival', description: 'Arrive' },
        { day: 2, title: 'New title', description: 'Old body' },
      ],
    },
  },
  check: { ok: true as const },
}

const secondItineraryProposal = {
  proposal: {
    kind: 'update_tour' as const,
    tourId: 't1',
    summary: '改第 1 天标题',
    patch: {
      itinerary: [
        { day: 1, title: 'New arrival', description: 'Arrive' },
        { day: 2, title: 'Old title', description: 'Old body' },
      ],
    },
  },
  check: { ok: true as const },
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs the message with prior history', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ reply: '好的', proposals: [], costUsd: 0 }))
      .mockResolvedValueOnce(jsonResponse({ reply: '好的', proposals: [], costUsd: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('第一句')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await sendMessage('第二句')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/clients/c1/tour-catalog/assistant')
    const body = JSON.parse(init.body as string) as {
      message: string
      history: Array<{ role: string; content: string }>
    }
    expect(body.message).toBe('第二句')
    expect(body.history).toEqual([
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '好的' },
    ])
  })

  it('renders a valid update_tour proposal and applies it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '已改展示价',
          proposals: [priceProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const onApplied = renderPanel()

    await sendMessage('把展示价改成 5999')
    await waitFor(() => expect(screen.getByText('应用这条')).toBeTruthy())
    expect(screen.getByText(/展示价：From NZD \$4,999 per person → From NZD \$5,999 per person/)).toBeTruthy()

    fireEvent.click(screen.getByText('应用这条'))
    await waitFor(() => expect(screen.getByText('已应用')).toBeTruthy())

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/clients/c1/tour-catalog/tours/t1')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as {
      expectedUpdatedAt: string
      patch: { displayPriceText: string }
    }
    expect(body.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(body.patch).toEqual({ displayPriceText: 'From NZD $5,999 per person' })
    expect(onApplied).toHaveBeenCalled()
  })

  it('shows an invalid proposal without an apply button', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        reply: '试试',
        proposals: [
          {
            proposal: { kind: 'update_tour', tourId: 't1', summary: '改团名', patch: { name: '' } },
            check: { ok: false, errors: [{ field: 'name', code: 'required' }] },
          },
        ],
        costUsd: 0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改团名')
    await waitFor(() => expect(screen.getByText('这条改不了：')).toBeTruthy())
    expect(screen.queryByText('应用这条')).toBeNull()
  })

  it('renders itinerary day changes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        reply: '改第 2 天',
        proposals: [itineraryProposal],
        costUsd: 0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改第 2 天标题')
    await waitFor(() => expect(screen.getByText(/第 2 天：标题 Old title → New title/)).toBeTruthy())
  })

  it('shows the refresh message on a 409 conflict', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '改展示价',
          proposals: [priceProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'conflict' }, 409))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价')
    await waitFor(() => expect(screen.getByText('应用这条')).toBeTruthy())
    fireEvent.click(screen.getByText('应用这条'))
    await waitFor(() =>
      expect(screen.getByText('这个团刚被别人改过，请刷新页面后再让我改')).toBeTruthy(),
    )
  })

  it('applyAll merges two update_tour proposals for the same tour into one PATCH', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处改动',
          proposals: [priceProposal, itineraryProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价和第 2 天')
    await waitFor(() => expect(screen.getByText('全部应用')).toBeTruthy())
    fireEvent.click(screen.getByText('全部应用'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/clients/c1/tour-catalog/tours/t1')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string) as {
      expectedUpdatedAt: string
      patch: Record<string, unknown>
    }
    expect(body.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(body.patch.displayPriceText).toBe('From NZD $5,999 per person')
    expect(body.patch.itinerary).toEqual(itineraryProposal.proposal.patch.itinerary)
    await waitFor(() => expect(screen.getAllByText('已应用').length).toBe(2))
  })

  it('per-card applies use the updatedAt returned by the previous apply', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处改动',
          proposals: [priceProposal, itineraryProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-03-03T00:00:00Z' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价和第 2 天')
    await waitFor(() => expect(screen.getAllByText('应用这条').length).toBe(2))

    fireEvent.click(screen.getAllByText('应用这条')[0])
    await waitFor(() => expect(screen.getAllByText('已应用').length).toBe(1))

    fireEvent.click(screen.getAllByText('应用这条')[0])
    await waitFor(() => expect(screen.getAllByText('已应用').length).toBe(2))

    const first = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string) as {
      expectedUpdatedAt: string
    }
    const second = JSON.parse((fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string) as {
      expectedUpdatedAt: string
    }
    expect(first.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(second.expectedUpdatedAt).toBe('2026-02-02T00:00:00Z')
  })

  it('applyAll: a conflict on the merged same-tour PATCH is shown on both cards and nothing is marked applied', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处改动',
          proposals: [priceProposal, itineraryProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'conflict' }, 409))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价和第 2 天')
    await waitFor(() => expect(screen.getByText('全部应用')).toBeTruthy())
    fireEvent.click(screen.getByText('全部应用'))
    // Both proposals target the same tour, so they were merged into one PATCH: one 409 → both cards say so.
    await waitFor(() =>
      expect(screen.getAllByText('这个团刚被别人改过，请刷新页面后再让我改').length).toBe(2),
    )
    expect(screen.queryByText('已应用')).toBeNull()
  })

  it('applyAll: two itinerary proposals for the same tour stay separate, second uses the first updatedAt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处行程改动',
          proposals: [itineraryProposal, secondItineraryProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-03-03T00:00:00Z' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改两天行程')
    await waitFor(() => expect(screen.getByText('全部应用')).toBeTruthy())
    fireEvent.click(screen.getByText('全部应用'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    const first = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string) as {
      expectedUpdatedAt: string
      patch: { itinerary: unknown }
    }
    const second = JSON.parse((fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string) as {
      expectedUpdatedAt: string
      patch: { itinerary: unknown }
    }
    expect(first.expectedUpdatedAt).toBe('2026-01-01T00:00:00Z')
    expect(second.expectedUpdatedAt).toBe('2026-02-02T00:00:00Z')
    expect(first.patch.itinerary).toEqual(itineraryProposal.proposal.patch.itinerary)
    expect(second.patch.itinerary).toEqual(secondItineraryProposal.proposal.patch.itinerary)
  })

  it('shows a warning box and requires confirmation before applying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '改行程',
          proposals: [
            {
              proposal: itineraryProposal.proposal,
              check: { ok: true, warnings: [{ code: 'itinerary_shrinks', from: 5, to: 3 }] },
            },
          ],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改行程')
    await waitFor(() =>
      expect(
        screen.getByText('行程会从 5 天减到 3 天，后面的天会被删掉。确定吗？'),
      ).toBeTruthy(),
    )
    const applyBtn = screen.getByText('应用这条') as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)

    fireEvent.click(screen.getByText('我看过了，确认这样改'))
    await waitFor(() => expect((screen.getByText('应用这条') as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByText('应用这条'))
    await waitFor(() => expect(screen.getByText('已应用')).toBeTruthy())
  })

  it('shows the mostly-changed warning text', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        reply: '改行程',
        proposals: [
          {
            proposal: itineraryProposal.proposal,
            check: {
              ok: true,
              warnings: [{ code: 'itinerary_mostly_changed', changed: 4, total: 5 }],
            },
          },
        ],
        costUsd: 0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改行程')
    await waitFor(() =>
      expect(
        screen.getByText('行程里 5 天有 4 天标题都变了，像是换成了别的行程，请仔细核对。'),
      ).toBeTruthy(),
    )
  })

  it('applyAll skips unconfirmed warning cards and reports the count', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处改动',
          proposals: [
            priceProposal,
            {
              proposal: itineraryProposal.proposal,
              check: { ok: true, warnings: [{ code: 'itinerary_shrinks', from: 5, to: 3 }] },
            },
          ],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价和行程')
    await waitFor(() => expect(screen.getByText('全部应用')).toBeTruthy())
    fireEvent.click(screen.getByText('全部应用'))
    await waitFor(() => expect(screen.getByText('有 1 条需要你先勾选确认')).toBeTruthy())
    // Only the price proposal was applied.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.getAllByText('已应用').length).toBe(1))
  })

  it('disables card apply buttons while applyAll is running', async () => {
    let resolvePatch: ((value: Response) => void) | undefined
    const pending = new Promise<Response>(resolve => {
      resolvePatch = resolve
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处改动',
          proposals: [priceProposal, itineraryProposal],
          costUsd: 0,
        }),
      )
      .mockImplementationOnce(() => pending)
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价和第 2 天')
    await waitFor(() => expect(screen.getByText('全部应用')).toBeTruthy())
    fireEvent.click(screen.getByText('全部应用'))

    await waitFor(() => {
      const buttons = screen.getAllByText('应用这条') as HTMLButtonElement[]
      expect(buttons.every(b => b.disabled)).toBe(true)
    })

    resolvePatch?.(jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }))
    await waitFor(() => expect(screen.getAllByText('已应用').length).toBe(2))
  })

  it('history marks applied and unapplied proposals on the next send', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '两处改动',
          proposals: [priceProposal, itineraryProposal],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ tour: { ...tours[0], updatedAt: '2026-02-02T00:00:00Z' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ reply: '好的', proposals: [], costUsd: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改展示价和第 2 天')
    await waitFor(() => expect(screen.getAllByText('应用这条').length).toBe(2))
    fireEvent.click(screen.getAllByText('应用这条')[0])
    await waitFor(() => expect(screen.getAllByText('已应用').length).toBe(1))

    await sendMessage('还有别的吗')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    const body = JSON.parse((fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string) as {
      history: Array<{ role: string; content: string }>
    }
    const assistantTurn = body.history.find(h => h.role === 'assistant')
    expect(assistantTurn?.content).toContain('[建议] 改展示价 — 已应用')
    expect(assistantTurn?.content).toContain('[建议] 改第 2 天标题 — 未应用')
  })

  it('shows the ignored-count line when the response has ignoredCount > 0', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ reply: '好的', proposals: [], costUsd: 0, ignoredCount: 2 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('随便改改')
    await waitFor(() =>
      expect(screen.getByText('有 2 条建议我没看懂，已忽略')).toBeTruthy(),
    )
  })

  it('shows the departure conflict message for update_departure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          reply: '改班期',
          proposals: [
            {
              proposal: {
                kind: 'update_departure',
                tourId: 't1',
                departureId: 'd1',
                summary: '改返程',
                patch: { returnOn: '2027-05-22' },
              },
              check: { ok: true },
            },
          ],
          costUsd: 0,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'conflict' }, 409))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改班期')
    await waitFor(() => expect(screen.getByText('应用这条')).toBeTruthy())
    fireEvent.click(screen.getByText('应用这条'))
    await waitFor(() =>
      expect(screen.getByText('这个班期刚被别人改过，请刷新页面后再让我改')).toBeTruthy(),
    )
  })

  it('shows the price hint for any invalid_price* error code', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        reply: '试试',
        proposals: [
          {
            proposal: { kind: 'update_tour', tourId: 't1', summary: '改价', patch: { displayPriceText: 'x' } },
            check: { ok: false, errors: [{ field: 'displayPriceText', code: 'invalid_price_format' }] },
          },
        ],
        costUsd: 0,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()

    await sendMessage('改价')
    await waitFor(() => expect(screen.getByText('展示价：价格写法不对')).toBeTruthy())
  })
})

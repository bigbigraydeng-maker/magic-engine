import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TourEditor } from '../TourEditor'
import type { CatalogTourView } from '../types'
import { CatalogUiProvider } from '../catalog-context'

function makeTour(overrides: Partial<CatalogTourView> = {}): CatalogTourView {
  return {
    id: 'tour-1',
    slug: 'tour-1',
    destination: 'NZ',
    tier: 'standard',
    name: '南岛经典',
    displayPriceText: 'From NZD $4,999 per person',
    isActive: true,
    managesDepartures: true,
    title: '南岛经典 12 天',
    shortDescription: '内部简介',
    durationText: '12 Days',
    highlights: ['看雪山', '泡温泉'],
    itinerary: [
      { day: 1, title: '抵达', description: '接机', meals: ['早餐'] },
      { day: 2, title: '冰川', description: '徒步', meals: [] },
    ],
    inclusions: ['机票'],
    exclusions: ['小费'],
    tourCities: ['皇后镇'],
    singleSupplement: 'NZD 800',
    maxGroupSize: 20,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('TourEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefills fields from the tour', () => {
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByDisplayValue('南岛经典')).toBeTruthy()
    expect(screen.getByDisplayValue('南岛经典 12 天')).toBeTruthy()
    expect(screen.getByDisplayValue('12 Days')).toBeTruthy()
    expect(screen.getByDisplayValue('From NZD $4,999 per person')).toBeTruthy()
    expect(screen.getByDisplayValue('NZD 800')).toBeTruthy()
    expect(screen.getByDisplayValue('20')).toBeTruthy()
    expect(screen.getByDisplayValue('看雪山\n泡温泉', { normalizer: (s) => s })).toBeTruthy()
    expect(screen.getByDisplayValue('抵达')).toBeTruthy()
    expect(screen.getByDisplayValue('冰川')).toBeTruthy()
  })

  it('sends only changed fields (price only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { tour: makeTour({ displayPriceText: 'TBC' }) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={onSaved} onCancel={vi.fn()} />,
    )
    const priceInput = screen.getByDisplayValue('From NZD $4,999 per person')
    fireEvent.change(priceInput, { target: { value: 'TBC' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/clients/c1/tour-catalog/tours/tour-1')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.patch).toEqual({ displayPriceText: 'TBC' })
    expect(body.expectedUpdatedAt).toBe('2026-01-01T00:00:00.000Z')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })

  it('sends only the price when only the price was touched, even with messy original itinerary', async () => {
    const tour = makeTour({
      itinerary: [
        { day: 2, title: '', description: '  接机  ', meals: ['Lunch (local, Sichuan style)'] },
        { day: 3, title: '冰川', description: '徒步', meals: [] },
      ],
    })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tour }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TourEditor clientId="c1" tour={tour} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.change(screen.getByDisplayValue('From NZD $4,999 per person'), {
      target: { value: 'TBC' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.patch).toEqual({ displayPriceText: 'TBC' })
  })

  it('keeps original meal strings intact when only another day is edited', async () => {
    const tour = makeTour({
      itinerary: [
        { day: 1, title: '抵达', description: '接机', meals: ['Lunch (local, Sichuan style)'] },
        { day: 2, title: '冰川', description: '徒步', meals: [] },
      ],
    })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tour }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TourEditor clientId="c1" tour={tour} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.change(screen.getByDisplayValue('冰川'), { target: { value: '冰川徒步' } })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.patch.itinerary).toEqual([
      { day: 1, title: '抵达', description: '接机', meals: ['Lunch (local, Sichuan style)'] },
      { day: 2, title: '冰川徒步', description: '徒步' },
    ])
  })

  it('shows 没有改动 and does not call fetch when nothing changed', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(screen.getByText('没有改动')).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renumbers days 1..n after adding and deleting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tour: makeTour() }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('加一天'))
    const deleteButtons = screen.getAllByText('删除这一天')
    fireEvent.click(deleteButtons[0])
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.patch.itinerary).toEqual([
      { day: 1, title: '冰川', description: '徒步' },
      { day: 2, title: '', description: '' },
    ])
  })

  it('shows the Chinese price hint for invalid_price errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        error: 'invalid_fields',
        fields: [{ field: 'displayPriceText', code: 'invalid_price_format' }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.change(screen.getByDisplayValue('From NZD $4,999 per person'), {
      target: { value: 'cheap' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() =>
      expect(
        screen.getByText(
          '价格写法不对，要写成 From NZD $4,999 per person 这样，或写 TBC 表示待定',
        ),
      ).toBeTruthy(),
    )
  })

  it('shows the refresh message on conflict', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: 'conflict' }))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.change(screen.getByDisplayValue('From NZD $4,999 per person'), {
      target: { value: 'TBC' },
    })
    fireEvent.click(screen.getByText('保存'))
    await waitFor(() =>
      expect(screen.getByText('这个团刚被别人改过，请刷新页面后再改')).toBeTruthy(),
    )
  })

  it('asks confirm when managesDepartures changes and sends nothing if declined', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByLabelText('管理班期'))
    fireEvent.click(screen.getByText('保存'))
    expect(confirmMock).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the managesDepartures confirm promises nothing about channels while none is connected', () => {
    vi.stubGlobal('fetch', vi.fn())
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)
    render(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: false }}>
        <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />
      </CatalogUiProvider>,
    )
    fireEvent.click(screen.getByLabelText('管理班期'))
    fireEvent.click(screen.getByText('保存'))
    const asked = String(confirmMock.mock.calls[0][0])
    expect(asked).toMatch(/上架后的目录里/)
    expect(asked).not.toMatch(/网站|广告|对外/)
    expect(screen.getByText('上架后的目录里用这个标题；留空则用团名')).toBeTruthy()
  })

  it('the managesDepartures confirm keeps the original wording once channels are connected', () => {
    vi.stubGlobal('fetch', vi.fn())
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)
    render(
      <CatalogUiProvider value={{ channelsConnected: true, canPublish: true }}>
        <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />
      </CatalogUiProvider>,
    )
    fireEvent.click(screen.getByLabelText('管理班期'))
    fireEvent.click(screen.getByText('保存'))
    expect(String(confirmMock.mock.calls[0][0])).toMatch(/网站和广告都不再推|继续对外显示/)
  })

  it('shows the 仅内部参考 tag on the highlights textarea', () => {
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    const tags = screen.getAllByText('仅内部参考，网站暂不读取')
    expect(tags.length).toBeGreaterThanOrEqual(1)
  })

  it('shows the title hint under 对外标题', () => {
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText('网站上显示的是这个标题；留空则显示团名')).toBeTruthy()
  })

  it('shows the amber duration hint when the number of days differs', () => {
    render(
      <TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText('天数写的是 12 天，行程里有 2 天，请确认')).toBeTruthy()
  })

  it('does not show the duration hint when the numbers match', () => {
    render(
      <TourEditor
        clientId="c1"
        tour={makeTour({ durationText: '2 Days' })}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText(/请确认/)).toBeNull()
  })

  it('updates the duration hint as days are added', () => {
    render(
      <TourEditor
        clientId="c1"
        tour={makeTour({ durationText: '3 Days' })}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('天数写的是 3 天，行程里有 2 天，请确认')).toBeTruthy()
    fireEvent.click(screen.getByText('加一天'))
    expect(screen.queryByText(/请确认/)).toBeNull()
  })

  it('cancels straight away when nothing was changed', () => {
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)
    const onCancel = vi.fn()
    render(<TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(confirmMock).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('asks before throwing away unsaved edits on cancel', () => {
    const confirmMock = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirmMock)
    const onCancel = vi.fn()
    render(<TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={onCancel} />)
    fireEvent.change(screen.getByDisplayValue('南岛经典'), { target: { value: '南岛经典 2' } })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(confirmMock).toHaveBeenCalledWith('放弃这次没保存的修改吗？')
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('南岛经典 2')).toBeTruthy()

    confirmMock.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps the save / cancel row stuck to the bottom of the screen', () => {
    render(<TourEditor clientId="c1" tour={makeTour()} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const row = screen.getByRole('button', { name: '保存' }).parentElement
    expect(row).toHaveClass('sticky', 'bottom-0')
  })

  it('reports unsaved input through onDirtyChange, and clean again when it goes away', () => {
    const onDirtyChange = vi.fn()
    const { unmount } = render(
      <TourEditor
        clientId="c1"
        tour={makeTour()}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    )
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    const name = screen.getByDisplayValue('南岛经典')
    fireEvent.change(name, { target: { value: '南岛经典 2' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    // Typing the original value back is not a pending change.
    fireEvent.change(name, { target: { value: '南岛经典' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(name, { target: { value: '南岛经典 3' } })
    unmount()
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  })
})

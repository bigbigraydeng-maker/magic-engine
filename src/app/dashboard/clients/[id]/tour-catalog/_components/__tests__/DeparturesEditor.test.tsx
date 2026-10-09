import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DeparturesEditor } from '../DeparturesEditor'
import { ChangeLog } from '../ChangeLog'
import type { CatalogDepartureView } from '../types'

function makeDeparture(overrides: Partial<CatalogDepartureView> = {}): CatalogDepartureView {
  return {
    id: 'dep-1',
    tourId: 'tour-1',
    departOn: '2027-05-13',
    returnOn: '2027-05-20',
    status: 'open',
    priceTextOverride: null,
    updatedAt: '2027-01-01T00:00:00.000Z',
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

describe('DeparturesEditor', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends only changed fields with tourId and expectedUpdatedAt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()

    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[makeDeparture()]}
        onChanged={onChanged}
      />,
    )

    fireEvent.click(screen.getByText('修改'))
    fireEvent.change(screen.getByDisplayValue('2027-05-20'), {
      target: { value: '2027-05-22' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/clients/c1/tour-catalog/departures/dep-1')
    expect(init.method).toBe('PATCH')
    const body = JSON.parse(init.body as string)
    expect(body.tourId).toBe('tour-1')
    expect(body.expectedUpdatedAt).toBe('2027-01-01T00:00:00.000Z')
    expect(body.patch).toEqual({ returnOn: '2027-05-22' })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('does not render an input for 出团日 in edit mode', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[makeDeparture()]}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('修改'))
    expect(screen.queryByDisplayValue('2027-05-13')).toBeNull()
    expect(screen.getByText(/出团日不能改/)).toBeTruthy()
  })

  it('renders the edit row as a single full-width cell with stacked fields', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[makeDeparture()]}
        onChanged={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('修改'))
    const cell = document.querySelector('td[colspan="5"]')
    expect(cell).not.toBeNull()
    // The stacked form lives inside that one cell (the table header repeats the same words).
    const inCell = within(cell as HTMLElement)
    expect(inCell.getByText('出团日')).toBeTruthy()
    expect(inCell.getByText('返程日')).toBeTruthy()
    expect(inCell.getByText('状态')).toBeTruthy()
    expect(inCell.getByText('该班展示价')).toBeTruthy()
  })

  it('POSTs a new departure and shows the success message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'dep-2' }, true, 201))
    vi.stubGlobal('fetch', fetchMock)
    const onChanged = vi.fn()

    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[]}
        onChanged={onChanged}
      />,
    )

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2027-06-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2027-06-08' } })
    fireEvent.click(screen.getByText('添加这个班期'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/clients/c1/tour-catalog/tours/tour-1/departures')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      departOn: '2027-06-01',
      returnOn: '2027-06-08',
      status: 'open',
      priceTextOverride: null,
    })
    await waitFor(() => expect(screen.getByText('已新增')).toBeTruthy())
    expect(onChanged).toHaveBeenCalled()
  })

  it('shows the duplicate_departure message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'duplicate_departure' }, false, 409))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[]}
        onChanged={vi.fn()}
      />,
    )

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2027-06-01' } })
    fireEvent.click(screen.getByText('添加这个班期'))

    await waitFor(() => expect(screen.getByText('这一天已经有班期了')).toBeTruthy())
  })

  it('shows the conflict message for departures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'conflict' }, false, 409))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[makeDeparture()]}
        onChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('修改'))
    fireEvent.change(screen.getByDisplayValue('2027-05-20'), {
      target: { value: '2027-05-22' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() =>
      expect(screen.getByText('这个班期刚被别人改过，请刷新页面后再改')).toBeTruthy(),
    )
  })

  it('shows a field error under the matching input on edit save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'invalid_fields',
          fields: [{ field: 'returnOn', code: 'return_before_depart' }],
        },
        false,
        400,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[makeDeparture()]}
        onChanged={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('修改'))
    fireEvent.change(screen.getByDisplayValue('2027-05-20'), {
      target: { value: '2027-05-10' },
    })
    fireEvent.click(screen.getByText('保存'))

    await waitFor(() => expect(screen.getByText('返程不能早于出团')).toBeTruthy())
  })

  it('shows a field error under the matching input on create save', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'invalid_fields',
          fields: [{ field: 'departOn', code: 'invalid_date' }],
        },
        false,
        400,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[]}
        onChanged={vi.fn()}
      />,
    )

    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2027-06-01' } })
    fireEvent.click(screen.getByText('添加这个班期'))

    await waitFor(() =>
      expect(screen.getByText('日期要写成 2027-05-13 这样')).toBeTruthy(),
    )
  })

  it('renders the price hint under the table', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(
      <DeparturesEditor
        clientId="c1"
        tourId="tour-1"
        departures={[]}
        onChanged={vi.fn()}
      />,
    )
    expect(
      screen.getByText(
        '某个班期单独填了展示价时，网站上这个班期以它为准；没填就用团的展示价。',
      ),
    ).toBeTruthy()
  })
})

describe('ChangeLog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function openPanel() {
    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))
  }

  it('requests the tour history by tourId and renders an update entry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-1',
            entity: 'departure',
            entityId: 'dep-1',
            action: 'update',
            before: { status: 'open', return_on: '2027-05-20', depart_on: '2027-05-13' },
            after: { status: 'cancelled', return_on: '2027-05-22', depart_on: '2027-05-13' },
            actor: 'edit by pm@x',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)

    openPanel()

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/clients/c1/tour-catalog/changes?tourId=tour-1',
      ),
    )
    await waitFor(() => expect(screen.getByText(/手工修改（pm@x）/)).toBeTruthy())
    expect(screen.getByText(/班期 2027-05-13：/)).toBeTruthy()
    expect(screen.getByText(/状态：可订 → 已取消/)).toBeTruthy()
    expect(screen.getByText(/返程日：2027-05-20 → 2027-05-22/)).toBeTruthy()
  })

  it('labels an import actor with the importer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-2',
            entity: 'departure',
            entityId: 'dep-1',
            action: 'insert',
            before: null,
            after: { depart_on: '2027-06-01' },
            actor: 'import:batch-1 by pm@x',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)
    openPanel()

    await waitFor(() => expect(screen.getByText(/班期表导入（pm@x）/)).toBeTruthy())
    expect(screen.getByText(/新增班期 2027-06-01/)).toBeTruthy()
  })

  it('shows a delete-departure entry with its date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-3',
            entity: 'departure',
            entityId: 'dep-1',
            action: 'delete',
            before: { depart_on: '2027-07-01' },
            after: null,
            actor: 'rollback:batch-1',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)
    openPanel()

    await waitFor(() => expect(screen.getByText(/撤销导入/)).toBeTruthy())
    expect(screen.getByText(/删除班期 2027-07-01/)).toBeTruthy()
  })

  it('describes the internal field as an operations update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-4',
            entity: 'tour',
            entityId: 'tour-1',
            action: 'update',
            before: { internal: { airline: 'A' } },
            after: { internal: { airline: 'B' } },
            actor: 'edit by pm@x',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)
    openPanel()

    await waitFor(() =>
      expect(screen.getByText(/运营信息（航司\/航段\/人数）已更新/)).toBeTruthy(),
    )
  })

  it('shows added and removed list items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-5',
            entity: 'tour',
            entityId: 'tour-1',
            action: 'update',
            before: { highlights: ['A', 'B'] },
            after: { highlights: ['A', 'C'] },
            actor: 'edit by pm@x',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)
    openPanel()

    await waitFor(() => expect(screen.getByText(/亮点：\+ C；− B/)).toBeTruthy())
  })

  it('describes itinerary changes per day', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-6',
            entity: 'tour',
            entityId: 'tour-1',
            action: 'update',
            before: {
              itinerary: [
                { day: 1, title: 'A', description: 'x' },
                { day: 2, title: 'B', description: 'y' },
              ],
            },
            after: {
              itinerary: [
                { day: 1, title: 'A', description: 'x' },
                { day: 2, title: 'B2', description: 'y' },
              ],
            },
            actor: 'edit by pm@x',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)
    openPanel()

    await waitFor(() => expect(screen.getByText(/第 2 天：修改/)).toBeTruthy())
  })

  it('reloads when refreshKey changes while the panel is open', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ changes: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k1" />)
    openPanel()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    rerender(<ChangeLog clientId="c1" tourId="tour-1" refreshKey="k2" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

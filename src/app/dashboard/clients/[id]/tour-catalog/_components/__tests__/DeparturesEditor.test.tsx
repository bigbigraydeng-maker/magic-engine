import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
})

describe('ChangeLog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders an update entry with Chinese field name, old → new values and actor label', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        changes: [
          {
            id: 'log-1',
            entity: 'departure',
            entityId: 'dep-1',
            action: 'update',
            before: { status: 'open', return_on: '2027-05-20' },
            after: { status: 'cancelled', return_on: '2027-05-22' },
            actor: 'edit by pm@x',
            createdAt: '2027-10-10T02:05:00.000Z',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ChangeLog clientId="c1" entityIds={['dep-1']} />)

    const details = document.querySelector('details') as HTMLDetailsElement
    details.open = true
    fireEvent(details, new Event('toggle'))

    await waitFor(() => expect(screen.getByText(/手工修改（pm@x）/)).toBeTruthy())
    expect(screen.getByText(/状态：可订 → 已取消/)).toBeTruthy()
    expect(screen.getByText(/返程日：2027-05-20 → 2027-05-22/)).toBeTruthy()
  })
})

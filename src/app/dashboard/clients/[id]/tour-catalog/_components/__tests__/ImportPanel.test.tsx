import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImportPanel } from '../ImportPanel'
import type { CatalogTourView, PreviewResponse } from '../types'

const TOURS: CatalogTourView[] = [
  {
    id: 'tour-1',
    slug: 'natural-china',
    destination: 'China',
    tier: 'standard',
    name: 'Natural China',
    displayPriceText: null,
    isActive: true,
    managesDepartures: true,
  },
  {
    id: 'tour-2',
    slug: 'natural-china-premium',
    destination: 'China',
    tier: 'premium',
    name: 'Natural China Premium',
    displayPriceText: null,
    isActive: true,
    managesDepartures: true,
  },
]

function makePreview(overrides: Partial<PreviewResponse> = {}): PreviewResponse {
  return {
    batchId: 'batch-1',
    summary: { adds: 0, updates: 0, unchanged: 0, rejected: 0, warningCount: 0 },
    adds: [],
    updates: [],
    rejected: [],
    warnings: [],
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** jsdom may lack File.prototype.text; stub it to return the file's content. */
function stubFileText() {
  if (typeof File.prototype.text !== 'function') {
    Object.defineProperty(File.prototype, 'text', {
      value: function (this: File) {
        return Promise.resolve('csv-content')
      },
      writable: true,
    })
  }
}

function selectFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'], 'a.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  stubFileText()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ImportPanel', () => {
  it('previews 2 adds and applies with acknowledgeWarnings false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(
          makePreview({
            summary: { adds: 2, updates: 0, unchanged: 0, rejected: 0, warningCount: 0 },
            adds: [
              { line: 1, tourId: 'tour-1', departOn: '2025-01-01', returnOn: '2025-01-10', status: 'open' },
              { line: 2, tourId: 'tour-1', departOn: '2025-02-01', returnOn: '2025-02-10', status: 'open' },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const onChanged = vi.fn()
    render(<ImportPanel clientId="c1" tours={TOURS} onChanged={onChanged} />)

    selectFile()
    fireEvent.click(screen.getByText('预览'))

    await waitFor(() => expect(screen.getByText(/新增 2 个/)).toBeTruthy())

    const applyBtn = screen.getByText('确认导入') as HTMLButtonElement
    expect(applyBtn.disabled).toBe(false)
    fireEvent.click(applyBtn)

    await waitFor(() => expect(onChanged).toHaveBeenCalled())

    const applyCall = fetchMock.mock.calls[1]
    expect(applyCall[0]).toBe('/api/clients/c1/tour-catalog/batches/batch-1/apply')
    expect(JSON.parse(applyCall[1].body)).toEqual({ acknowledgeWarnings: false })
  })

  it('requires the warning checkbox before applying', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(
          makePreview({
            summary: { adds: 1, updates: 0, unchanged: 0, rejected: 0, warningCount: 1 },
            adds: [
              { line: 1, tourId: 'tour-1', departOn: '2025-01-01', returnOn: '2025-01-10', status: 'open' },
            ],
            warnings: [
              { kind: 'suspected_typo', tourId: 'tour-1', newDate: '2025-01-01', nearDate: '2025-01-03', days: 2 },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const onChanged = vi.fn()
    render(<ImportPanel clientId="c1" tours={TOURS} onChanged={onChanged} />)

    selectFile()
    fireEvent.click(screen.getByText('预览'))

    await waitFor(() => expect(screen.getByText('请先看一眼这些提醒')).toBeTruthy())

    const applyBtn = screen.getByText('确认导入') as HTMLButtonElement
    expect(applyBtn.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('我已看过以上提醒，其余班期保持不变'))
    await waitFor(() => expect(applyBtn.disabled).toBe(false))

    fireEvent.click(applyBtn)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())

    const applyCall = fetchMock.mock.calls[1]
    expect(JSON.parse(applyCall[1].body)).toEqual({ acknowledgeWarnings: true })
  })

  it('shows the Chinese reason and remembers an alias', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse(
          makePreview({
            summary: { adds: 0, updates: 0, unchanged: 0, rejected: 1, warningCount: 0 },
            rejected: [
              { line: 3, reason: 'tour_ambiguous', tourName: 'Natural China' },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ImportPanel clientId="c1" tours={TOURS} onChanged={vi.fn()} />)

    selectFile()
    fireEvent.click(screen.getByText('预览'))

    await waitFor(() =>
      expect(screen.getByText('同时对上了多个团（例如高端款和普通款）')).toBeTruthy(),
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'tour-2' } })
    fireEvent.click(screen.getByText('记住这个叫法'))

    await waitFor(() => expect(screen.getByText('已记住，请再点一次预览')).toBeTruthy())

    const aliasCall = fetchMock.mock.calls[1]
    expect(aliasCall[0]).toBe('/api/clients/c1/tour-catalog/aliases')
    expect(JSON.parse(aliasCall[1].body)).toEqual({ alias: 'Natural China', tourId: 'tour-2' })
  })

  it('shows the duplicate_file message', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ error: 'duplicate_file' }, 409),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ImportPanel clientId="c1" tours={TOURS} onChanged={vi.fn()} />)

    selectFile()
    fireEvent.click(screen.getByText('预览'))

    await waitFor(() => expect(screen.getByText('这份文件已经导入过了')).toBeTruthy())
  })

  it('shows nothing-to-import text and no apply button when batchId is null', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(makePreview({ batchId: null })),
    )
    vi.stubGlobal('fetch', fetchMock)

    render(<ImportPanel clientId="c1" tours={TOURS} onChanged={vi.fn()} />)

    selectFile()
    fireEvent.click(screen.getByText('预览'))

    await waitFor(() =>
      expect(screen.getByText('这份文件里没有可以导入的新内容')).toBeTruthy(),
    )
    expect(screen.queryByText('确认导入')).toBeNull()
  })
})

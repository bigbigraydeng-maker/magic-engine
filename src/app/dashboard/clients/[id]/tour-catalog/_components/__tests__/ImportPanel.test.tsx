import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { renderConnected as render } from './render-connected'
import { ImportPanel } from '../ImportPanel'
import { BatchHistory } from '../BatchHistory'
import { CatalogUiProvider } from '../catalog-context'
import type { CatalogBatchView, CatalogTourView, PreviewResponse } from '../types'

const TOUR: CatalogTourView = {
  id: 't1',
  slug: 'a',
  destination: 'JP',
  tier: 'std',
  name: '东京五日',
  displayPriceText: null,
  isActive: true,
  managesDepartures: true,
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

function previewWithWarnings(warnings: PreviewResponse['warnings']): PreviewResponse {
  return {
    batchId: 'b1',
    planHash: 'h1',
    summary: {
      adds: 0,
      updates: 0,
      unchanged: 0,
      rejected: 0,
      warningCount: warnings.length,
    },
    adds: [],
    updates: [],
    rejected: [],
    warnings,
  }
}

/** Upload a CSV file and click 预览, returning once the preview is rendered. */
async function previewWith(warnings: PreviewResponse['warnings']) {
  const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(previewWithWarnings(warnings)))
  vi.stubGlobal('fetch', fetchMock)

  render(<ImportPanel clientId="c1" tours={[TOUR]} onChanged={() => {}} />)

  const file = new File(['depart_on,tour,return_on\n'], 'a.csv', { type: 'text/csv' })
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  fireEvent.click(screen.getByText('预览'))

  await waitFor(() => {
    expect(screen.getByText('请先看一眼这些提醒')).toBeInTheDocument()
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImportPanel warnings', () => {
  it('explains a cancelled departure that the file left alone', async () => {
    await previewWith([
      { kind: 'cancelled_kept', tourId: 't1', departureId: 'd1', departOn: '2027-05-13' },
    ])
    expect(
      screen.getByText(
        '东京五日：2027-05-13 这个班期在系统里是已取消，表里没写状态，所以保持已取消不变',
      ),
    ).toBeInTheDocument()
  })

  it('explains a cancelled departure that the file reopens', async () => {
    await previewWith([
      {
        kind: 'reopens_cancelled',
        tourId: 't1',
        departureId: 'd1',
        departOn: '2027-05-13',
        newStatus: 'open',
      },
    ])
    expect(
      screen.getByText(
        '东京五日：2027-05-13 这个班期原来是已取消，表里写的是可订，导入后会重新开放',
      ),
    ).toBeInTheDocument()
  })
})

describe('ImportPanel intro', () => {
  it('says the import only changes the draft and still needs publishing', () => {
    render(<ImportPanel clientId="c1" tours={[TOUR]} onChanged={() => {}} />)
    expect(screen.getByRole('heading', { name: '上传出团表' })).toBeInTheDocument()
    expect(
      screen.getByText(
        '选一份出团表文件（Excel 另存为 CSV 格式），先预览会改什么，确认没问题再导入。导入只改草稿，客人看不到；导入后还要点上面的「查看并上架」才会对外生效。',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/班期表/)).toBeNull()
  })
})

const BATCH: CatalogBatchView = {
  id: 'b1',
  kind: 'departures',
  status: 'applied',
  createdAt: '2026-10-10T03:30:00Z',
  rowCounts: { adds: 2, updates: 1 },
}

describe('ImportPanel and BatchHistory while no channel is connected', () => {
  it('the intro says the import only changes the draft, nothing about customers', () => {
    rtlRender(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <ImportPanel clientId="c1" tours={[TOUR]} onChanged={() => {}} />
      </CatalogUiProvider>,
    )
    expect(
      screen.getByText(/导入只改草稿，还没上架；导入后还要点上面的「查看并上架」。$/),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/对外|客人/)
  })

  it('the import history says the same, and so does the undo question', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rtlRender(
      <CatalogUiProvider value={{ channelsConnected: false, canPublish: true }}>
        <BatchHistory
          clientId="c1"
          batches={[BATCH]}
          onChanged={() => {}}
        />
      </CatalogUiProvider>,
    )
    expect(
      screen.getByText('导入和撤销改的都是草稿，还没上架；之后还要点页面上方的「查看并上架」。'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤销这次导入' }))
    expect(String(confirm.mock.calls[0][0])).not.toMatch(/对外|客人/)
    expect(document.body.textContent).not.toMatch(/对外|客人/)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImportPanel } from '../ImportPanel'
import type { CatalogTourView, PreviewResponse } from '../types'

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

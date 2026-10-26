import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextResponse } from 'next/server'

const requireCatalogAccess = vi.fn()
const clientHasIndustryFeature = vi.fn()

vi.mock('@/lib/tour-catalog/access', () => ({
  requireCatalogAccess: (...args: unknown[]) => requireCatalogAccess(...args),
}))
vi.mock('@/lib/clients/industry-guard', () => ({
  clientHasIndustryFeature: (...args: unknown[]) => clientHasIndustryFeature(...args),
  INDUSTRY_FEATURE_NOTICE: { tour_catalog: { title: '这个客户没有开通团目录。', body: '' } },
}))
vi.mock('../_components/TourCatalogClient', () => ({
  TourCatalogClient: ({ clientId }: { clientId: string }) => (
    <div data-testid="catalog-client">{clientId}</div>
  ),
}))

import TourCatalogPage from '../page'

async function renderPage() {
  render(await TourCatalogPage({ params: { id: 'c1' } }))
}

function denied(status: number) {
  return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status }) }
}

beforeEach(() => {
  requireCatalogAccess.mockReset()
  clientHasIndustryFeature.mockReset()
})

describe('tour-catalog page shell', () => {
  it('asks for the view capability of this client', async () => {
    requireCatalogAccess.mockResolvedValue({ ok: true })
    clientHasIndustryFeature.mockResolvedValue(true)
    await renderPage()
    expect(requireCatalogAccess).toHaveBeenCalledWith('c1', 'view')
    expect(clientHasIndustryFeature).toHaveBeenCalledWith('c1', 'tour_catalog')
    expect(screen.getByTestId('catalog-client')).toHaveTextContent('c1')
  })

  it('403: a Chinese explanation, no English Forbidden, no catalog', async () => {
    requireCatalogAccess.mockResolvedValue(denied(403))
    await renderPage()
    expect(
      screen.getByText('你的账号还没有开通团目录。需要使用请联系 Magic Engine 团队。'),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Forbidden/)
    expect(screen.queryByTestId('catalog-client')).toBeNull()
    // the industry lookup is not even made for someone without access
    expect(clientHasIndustryFeature).not.toHaveBeenCalled()
  })

  it('any other failure: the page says it cannot open right now', async () => {
    requireCatalogAccess.mockResolvedValue(denied(500))
    await renderPage()
    expect(screen.getByText('页面暂时打不开，请稍后再试。')).toBeInTheDocument()
    expect(screen.queryByTestId('catalog-client')).toBeNull()
  })

  it('a client outside the travel industry: not switched on', async () => {
    requireCatalogAccess.mockResolvedValue({ ok: true })
    clientHasIndustryFeature.mockResolvedValue(false)
    await renderPage()
    expect(screen.getByText('这个客户没有开通团目录。')).toBeInTheDocument()
    expect(screen.queryByTestId('catalog-client')).toBeNull()
  })
})

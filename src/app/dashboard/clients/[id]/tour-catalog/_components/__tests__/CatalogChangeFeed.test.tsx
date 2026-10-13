import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { CatalogChangeFeed, CHANGE_FEED_INTRO, CHANGE_FEED_ERROR } from '../CatalogChangeFeed'
import type { CatalogChangeView, CatalogChangesResponse } from '@/lib/tour-catalog/catalog-contract'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

const CHANGES: CatalogChangeView[] = [
  {
    id: 'c1',
    createdAt: '2026-10-10T03:30:00Z',
    actorLabel: 'amy@example.test',
    source: 'manual',
    tourId: 't1',
    tourName: 'Coral Loop',
    summary: '展示价：NZD $1 → NZD $2',
  },
  {
    id: 'c2',
    createdAt: '2026-10-10T04:30:00Z',
    actorLabel: 'amy@example.test',
    source: 'assistant',
    tourId: 't2',
    tourName: 'Deep Trench',
    summary: '把出发时间改成 08:00',
  },
  {
    id: 'c3',
    createdAt: '2026-10-10T05:30:00Z',
    actorLabel: 'Magic Engine 团队',
    source: 'import',
    tourId: null,
    tourName: '',
    summary: '出团表导入：新增 12 个班期、更新 3 个',
  },
  {
    id: 'c4',
    createdAt: '2026-10-10T06:30:00Z',
    actorLabel: '系统',
    source: 'system',
    tourId: null,
    tourName: '',
    summary: '系统整理',
  },
]

function rows(): Element[] {
  return Array.from(document.querySelectorAll('[data-testid^="change-row-"]'))
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url === '/api/clients/c1/tour-catalog/changes') {
      return jsonResponse({ changes: CHANGES } satisfies CatalogChangesResponse)
    }
    return jsonResponse({ error: 'not_found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CatalogChangeFeed', () => {
  it('fetches the changes endpoint and renders rows with a formatted time', async () => {
    render(<CatalogChangeFeed clientId="c1" />)
    expect(await screen.findByTestId('change-row-c1')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/clients/c1/tour-catalog/changes')
    expect(rows()).toHaveLength(4)
    expect(screen.getByTestId('change-row-c1').textContent).toMatch(/2026年10月\d+日 \d{2}:\d{2}/)
  })

  it('shows source tags and the self-reported marker only for assistant rows', async () => {
    render(<CatalogChangeFeed clientId="c1" />)
    const manual = await screen.findByTestId('change-row-c1')
    const assistant = screen.getByTestId('change-row-c2')
    const imported = screen.getByTestId('change-row-c3')

    expect(manual.textContent).toContain('手动')
    expect(assistant.textContent).toContain('AI 助手')
    expect(imported.textContent).toContain('出团表导入')

    const selfReported = screen.getByTitle('来源由浏览器上报')
    expect(selfReported).toHaveTextContent('自报')
    expect(manual.textContent).not.toContain('自报')
  })

  it('filters by person', async () => {
    render(<CatalogChangeFeed clientId="c1" />)
    await screen.findByTestId('change-row-c1')
    fireEvent.change(screen.getByLabelText('按人'), { target: { value: 'Magic Engine 团队' } })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toHaveAttribute('data-testid', 'change-row-c3')
  })

  it('filters by source and only offers sources that occur', async () => {
    render(<CatalogChangeFeed clientId="c1" />)
    await screen.findByTestId('change-row-c1')
    const sourceSelect = screen.getByLabelText('按来源')
    expect(within(sourceSelect).queryByRole('option', { name: '撤销导入' })).toBeNull()
    fireEvent.change(sourceSelect, { target: { value: 'assistant' } })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0]).toHaveAttribute('data-testid', 'change-row-c2')
  })

  it('shows an empty-filter message when both filters exclude everything', async () => {
    render(<CatalogChangeFeed clientId="c1" />)
    await screen.findByTestId('change-row-c1')
    fireEvent.change(screen.getByLabelText('按人'), { target: { value: '系统' } })
    fireEvent.change(screen.getByLabelText('按来源'), { target: { value: 'manual' } })
    expect(await screen.findByText('没有符合条件的记录')).toBeInTheDocument()
    expect(rows()).toHaveLength(0)
  })

  it('shows the empty state and the intro when there are no changes', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ changes: [] }))
    render(<CatalogChangeFeed clientId="c1" />)
    expect(await screen.findByText('还没有修改记录')).toBeInTheDocument()
    expect(screen.getByText(CHANGE_FEED_INTRO)).toBeInTheDocument()
  })

  it('shows an alert and retries after a failure', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: 'catalog_load_failed' }, 500))
    render(<CatalogChangeFeed clientId="c1" />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(CHANGE_FEED_ERROR)

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByTestId('change-row-c1')).toBeInTheDocument()
  })

  it('never renders undefined or null text', async () => {
    render(<CatalogChangeFeed clientId="c1" />)
    await screen.findByTestId('change-row-c1')
    expect(document.body.textContent).not.toMatch(/undefined|null/)
  })
})

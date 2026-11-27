import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdsAutomationSwitchesPanel } from '../AdsAutomationSwitchesPanel'

const CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const BASE = `/api/clients/${CLIENT_ID}/ad-strategy-config/automation-switches`

const OFF = {
  ads_predictive_early_warning: false,
  ads_trend_check: false,
  ads_tune_cards: false,
}

function mockFetchSequence(responses: Array<{ status?: number; json: unknown }>) {
  let i = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)]
      i += 1
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AdsAutomationSwitchesPanel', () => {
  it('shows the current state and a plain explanation beside each switch', async () => {
    mockFetchSequence([{ json: { switches: { ...OFF, ads_trend_check: true } } }])
    render(<AdsAutomationSwitchesPanel clientId={CLIENT_ID} />)

    expect(await screen.findByRole('switch', { name: '开关日趋势检查' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: '开关日内成本预警' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: '开关调优确认卡' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/比过去 7 天的平均贵了两成/)).toBeInTheDocument()
    expect(screen.getByText(/写进巡察和今日待办/)).toBeInTheDocument()
    expect(screen.getByText(/先出一张确认卡等人点头/)).toBeInTheDocument()
  })

  it('sends only the switch that was clicked', async () => {
    mockFetchSequence([
      { json: { switches: OFF } },
      { json: { switches: { ...OFF, ads_predictive_early_warning: true } } },
    ])
    render(<AdsAutomationSwitchesPanel clientId={CLIENT_ID} />)
    fireEvent.click(await screen.findByRole('switch', { name: '开关日内成本预警' }))

    await waitFor(() => expect(screen.getByRole('switch', { name: '开关日内成本预警' })).toHaveAttribute('aria-checked', 'true'))
    expect(global.fetch).toHaveBeenLastCalledWith(
      BASE,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ads_predictive_early_warning: true }),
      }),
    )
  })

  it('stays hidden when the viewer is not allowed to see the switches', async () => {
    mockFetchSequence([{ status: 403, json: { error: '你不能改这个开关。' } }])
    const { container } = render(<AdsAutomationSwitchesPanel clientId={CLIENT_ID} />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('puts the switch back when the save is refused', async () => {
    mockFetchSequence([
      { json: { switches: OFF } },
      { status: 500, json: { error: '这次没有改，因为没能记进工作日志。' } },
    ])
    render(<AdsAutomationSwitchesPanel clientId={CLIENT_ID} />)
    fireEvent.click(await screen.findByRole('switch', { name: '开关调优确认卡' }))
    await waitFor(() => expect(screen.getByText(/没能记进工作日志/)).toBeInTheDocument())
    expect(screen.getByRole('switch', { name: '开关调优确认卡' })).toHaveAttribute('aria-checked', 'false')
  })
})

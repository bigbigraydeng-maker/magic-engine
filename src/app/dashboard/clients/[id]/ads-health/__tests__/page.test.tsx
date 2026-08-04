/**
 * Ads Health page — copy + closure guards.
 *
 * These tests exist because of a specific PM verdict (2026-07-25): the page's
 * only button answered "本轮爆款池里暂时没有新的合格素材,系统明天会再自动扫" and
 * the PM's reply was "这不叫解决问题,没有闭环". A reply with no next step, and any
 * mention of a "团队" that does not exist, are product defects — not wording
 * nits — so they are locked here rather than left to review.
 *
 * The page is auth-gated, so it cannot be eyeballed in a local browser without
 * signing in. Rendering it here with real narrative data is the verification.
 */

import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }),
}))

vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import AdsHealthPage from '../page'

/** Oztop's real 2026-07-23 alert, the one card that mattered. */
const OZTOP_ALERT = {
  campaign_id: '120215',
  campaign_name: 'Oztop — Lead Form — Cold Broad — 20260709',
  verdict: 'alert' as const,
  headline: '每个询盘成本比自身最好一周高 60%($20.51 → $32.85)',
  metrics: [{
    metric: 'cost_per_result' as const,
    verdict: 'alert' as const,
    baseline: 20.51, recent: 32.85, ratio: 1.6,
    reason: '每个询盘成本比自身最好一周高 60%',
  }],
  ctr_series: [{ date: '2026-07-23', ctr: 0.0192 }],
  latest_spend_7d: 528,
  latest_results_7d: 13,
  frequency_7d: 1.39,
  prescription: {
    kind: 'refresh_creatives' as const,
    title: '从爆款池补新素材',
    why: '观众没被打扰过度,但点击率持续走低。',
    executable: true,
    execute_hint: '新素材一律先暂停、不花钱。',
  },
}

const HEALTHY = {
  ...OZTOP_ALERT,
  campaign_id: '999',
  campaign_name: 'Oztop — Retargeting',
  verdict: 'healthy' as const,
  headline: '表现正常',
  latest_spend_7d: 100,
  latest_results_7d: 20,
  prescription: null,
}

function respond(campaigns: unknown[]) {
  return {
    success: true,
    latest: {
      insight_date: '2026-07-23',
      overall_verdict: 'alert',
      headline: '1 条广告该动手了',
      payload: {
        overall_verdict: 'alert',
        headline: '1 条广告该动手了',
        campaigns,
        evaluated: campaigns.length,
        generated_for: '2026-07-23',
      },
    },
    history: [],
  }
}

/** Route fetches by URL so one test can drive both the page load and a click. */
function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = Object.keys(routes).find(k => url.includes(k))
    const body = key ? routes[key] : {}
    const status = (body as { __status?: number }).__status ?? 200
    return {
      ok: status < 400,
      status,
      json: async () => body,
      // Record the method so tests can assert nothing was written on a preview.
      __method: init?.method ?? 'GET',
    } as unknown as Response
  })
}

beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('the money question is answered before any diagnosis', () => {
  it('opens with what the week actually cost, and names the worst payer', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT, HEALTHY]) }))
    render(<AdsHealthPage />)

    // $628 spent, 33 results → $19.0 each. Plain sums of the card figures.
    await waitFor(() => expect(screen.getByText(/过去 7 天花了/)).toBeTruthy())
    const summary = screen.getByText(/过去 7 天花了/).textContent ?? ''
    expect(summary).toContain('628')
    expect(summary).toContain('33')

    // Oztop's alert pays $40.6/lead vs the $19.0 average → named.
    expect(screen.getByText(/最贵的是/).textContent).toContain('Lead Form')
  })

  it('says so plainly when the money bought nothing', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health': respond([{ ...OZTOP_ALERT, latest_results_7d: 0 }]),
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText(/一个询盘都没来/)).toBeTruthy())
  })

  it('labels the per-lead figure 实付 so it cannot be mistaken for the verdict number', async () => {
    // The headline compares a typical DAY (median); this is total ÷ total. Both
    // are correct and they differ — unlabelled they read as a contradiction.
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT]) }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText(/实付每个询盘/)).toBeTruthy())
  })
})

describe('every card that is burning money offers a way to stop it', () => {
  it('shows the stop-loss controls on an alert, ABOVE the creative prescription', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT]) }))
    const { container } = render(<AdsHealthPage />)

    await waitFor(() => expect(screen.getByText('预算降 20%')).toBeTruthy())
    expect(screen.getByText('先全停')).toBeTruthy()
    expect(screen.getByText('先不动')).toBeTruthy()

    // Money decision must come first in the DOM — it needs no creative supply
    // and takes effect immediately.
    const text = container.textContent ?? ''
    expect(text.indexOf('先按住钱')).toBeLessThan(text.indexOf('处方:'))
  })

  it('does NOT offer stop-loss on a healthy card', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([HEALTHY]) }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText(/表现正常/)).toBeTruthy())
    expect(screen.queryByText('预算降 20%')).toBeNull()
  })

  it('"先不动" is a real choice, not a no-op — it says what happens next', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT]) }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText('先不动')).toBeTruthy())

    await userEvent.click(screen.getByText('先不动'))
    expect(screen.getByText(/明天体检还会看它/)).toBeTruthy()
  })

  it('a budget cut reports the new daily number, so the PM can verify it', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health/stop-loss': { current_daily: 60, planned_daily: 48, cuttable: true, pausable: true, executed: true, action: 'cut', ok: true, new_daily: 48, warnings: [] },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText('预算降 20%')).toBeTruthy())

    await userEvent.click(screen.getByText('预算降 20%'))
    await waitFor(() => expect(screen.getByText(/已降到每天/)).toBeTruthy())
    expect(screen.getByText(/已降到每天/).textContent).toContain('48')
  })

  it('an un-cuttable budget still leaves a next step — never "go do it yourself"', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health/stop-loss': { current_daily: 60, planned_daily: null, cuttable: false, pausable: true },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText('预算降 20%')).toBeTruthy())

    await userEvent.click(screen.getByText('预算降 20%'))
    await waitFor(() => expect(screen.getByText(/改不了/)).toBeTruthy())
    const msg = screen.getByText(/改不了/).textContent ?? ''
    expect(msg).toContain('先全停')          // an action, offered here
    expect(msg).not.toContain('后台')         // not an errand for the operator
  })
})

describe('no reply may end without a next step, and there is no "团队"', () => {
  it('the no-supply case points at the money controls instead of at tomorrow', async () => {
    // The exact 2026-07-25 failure: nothing to recycle. Old copy said "系统明天
    // 会再自动扫" and stopped there.
    vi.stubGlobal('fetch', mockFetch({
      '/execute-prescription': { __status: 409, no_supply: true, reason: 'recycle_pool_not_connected' },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText('执行')).toBeTruthy())

    await userEvent.click(screen.getByText('执行'))
    await waitFor(() => expect(screen.getByText(/新片要现做/)).toBeTruthy())

    const msg = screen.getByText(/新片要现做/).textContent ?? ''
    expect(msg).toContain('预算降 20%')       // a next step that works today
    expect(msg).not.toContain('明天')          // never defer with no owner
    expect(msg).not.toContain('团队')          // no invented third party
    expect(msg).not.toContain('爆款素材池')     // no internal jargon
  })

  it('an empty recycle result reads the same way — not "明天再扫"', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/execute-prescription': { adsAdded: [] },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText('执行')).toBeTruthy())

    await userEvent.click(screen.getByText('执行'))
    await waitFor(() => expect(screen.getByText(/没补上/)).toBeTruthy())
    const msg = screen.getByText(/没补上/).textContent ?? ''
    expect(msg).toContain('预算')
    expect(msg).not.toContain('明天会再自动扫')
  })

  it('a successful top-up credits ME and the PM — nobody else', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/execute-prescription': { adsAdded: [{ name: 'a' }, { name: 'b' }] },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText('执行')).toBeTruthy())

    await userEvent.click(screen.getByText('执行'))
    await waitFor(() => expect(screen.getByText(/已补 2 条新素材/)).toBeTruthy())
    const msg = screen.getByText(/已补 2 条新素材/).textContent ?? ''
    expect(msg).toContain('一分钱不花')
    expect(msg).not.toContain('团队')
  })
})

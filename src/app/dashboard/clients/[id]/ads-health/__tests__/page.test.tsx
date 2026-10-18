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

/** 页面读 `?tab=` 定初始标签，所以这个 mock 要能被各用例换掉。 */
let searchParamsValue = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84' }),
  useSearchParams: () => searchParamsValue,
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

beforeEach(() => { vi.stubGlobal('confirm', vi.fn(() => true)); searchParamsValue = new URLSearchParams() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** 逐条广告卡片在「每条广告」标签里，先点过去 */
async function renderAdsTab() {
  const result = render(<AdsHealthPage />)
  await userEvent.click(await screen.findByText('每条广告'))
  return result
}

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
    // No industry in the response → neutral playbook words (G11).
    await waitFor(() => expect(screen.getByText(/一个结果都没来/)).toBeTruthy())
  })

  it('labels the per-lead figure 实付 so it cannot be mistaken for the verdict number', async () => {
    // The headline compares a typical DAY (median); this is total ÷ total. Both
    // are correct and they differ — unlabelled they read as a contradiction.
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT]) }))
    await renderAdsTab()
    await waitFor(() => expect(screen.getByText(/实付每个结果/)).toBeTruthy())
  })

  it('uses the client industry words from the playbook — a travel client never sees 询盘 (G11)', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health': { ...respond([OZTOP_ALERT, HEALTHY]), industry: 'travel' },
    }))
    render(<AdsHealthPage />)
    await waitFor(() => expect(screen.getByText(/过去 7 天花了/)).toBeTruthy())
    expect(screen.getByText(/过去 7 天花了/).textContent).toContain('个咨询')
    expect(screen.getByText(/最贵的是/).textContent).toContain('一个咨询')
    await userEvent.click(screen.getByText('每条广告'))
    await waitFor(() => expect(screen.getAllByText(/实付每个咨询/).length).toBe(2))
    expect(screen.getAllByText(/近 7 天咨询/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/实付每个询盘|实付每个结果/)).toBeNull()
  })
})

describe('every card that is burning money offers a way to stop it', () => {
  it('shows the stop-loss controls on an alert, ABOVE the creative prescription', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT]) }))
    const { container } = await renderAdsTab()

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
    await renderAdsTab()
    await waitFor(() => expect(screen.getByText(/表现正常/)).toBeTruthy())
    expect(screen.queryByText('预算降 20%')).toBeNull()
  })

  it('"先不动" is a real choice, not a no-op — it says what happens next', async () => {
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([OZTOP_ALERT]) }))
    await renderAdsTab()
    await waitFor(() => expect(screen.getByText('先不动')).toBeTruthy())

    await userEvent.click(screen.getByText('先不动'))
    expect(screen.getByText(/明天体检还会看它/)).toBeTruthy()
  })

  it('a budget cut reports the new daily number, so the PM can verify it', async () => {
    const randomUUID = vi.fn().mockReturnValue('de305d54-75b4-431b-adb2-eb6b9e546014')
    vi.stubGlobal('crypto', { randomUUID })
    const fetch = mockFetch({
      '/ad-health/stop-loss': { current_daily: 60, planned_daily: 48, cuttable: true, pausable: true, executed: true, action: 'cut', ok: true, new_daily: 48, warnings: [] },
      '/ad-health': respond([OZTOP_ALERT]),
    })
    vi.stubGlobal('fetch', fetch)
    await renderAdsTab()
    await waitFor(() => expect(screen.getByText('预算降 20%')).toBeTruthy())

    await userEvent.click(screen.getByText('预算降 20%'))
    await waitFor(() => expect(screen.getByText(/已降到每天/)).toBeTruthy())
    expect(screen.getByText(/已降到每天/).textContent).toContain('48')
    expect(screen.queryByText(/广告还在跑/)).toBeNull()
    const post = (fetch.mock.calls as unknown as Array<[string, RequestInit | undefined]>).find(([, init]) => init?.method === 'POST')
    expect(randomUUID).toHaveBeenCalledOnce()
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ request_id: 'de305d54-75b4-431b-adb2-eb6b9e546014' })
  })

  it('shows a campaign state warning without claiming the ad is still running', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health/stop-loss': { current_daily: 60, planned_daily: 48, cuttable: true, pausable: true, executed: true, action: 'cut', ok: true, new_daily: 48, warnings: ['广告系列状态已变化，未自动重新开启，请检查。'] },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    await renderAdsTab()
    await waitFor(() => expect(screen.getByText('预算降 20%')).toBeTruthy())

    await userEvent.click(screen.getByText('预算降 20%'))

    await waitFor(() => expect(screen.getByText(/未自动重新开启/)).toBeTruthy())
    expect(screen.queryByText(/广告还在跑/)).toBeNull()
  })

  it('an un-cuttable budget still leaves a next step — never "go do it yourself"', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health/stop-loss': { current_daily: 60, planned_daily: null, cuttable: false, pausable: true },
      '/ad-health': respond([OZTOP_ALERT]),
    }))
    await renderAdsTab()
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
    await renderAdsTab()
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
    await renderAdsTab()
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
    await renderAdsTab()
    await waitFor(() => expect(screen.getByText('执行')).toBeTruthy())

    await userEvent.click(screen.getByText('执行'))
    await waitFor(() => expect(screen.getByText(/已补 2 条新素材/)).toBeTruthy())
    const msg = screen.getByText(/已补 2 条新素材/).textContent ?? ''
    expect(msg).toContain('一分钱不花')
    expect(msg).not.toContain('团队')
  })
})

/**
 * 「等你点头」标签（设计稿 2026-10-18-ads-door-merge-design §5 步 1）。
 * 这一步只立门牌 + 给直达链接，所以用例盯三件：标签在、点开有链接、链接来自登记表而不是写死的网址。
 */
describe('「等你点头」标签', () => {
  it('标签在，点开就是真的批准面板（没有待批准时如实说没有）', async () => {
    vi.stubGlobal('fetch', mockFetch({
      '/ad-health': respond([]),
      '/ad-health/auto-pause': { items: [], hasMore: false },
    }))
    render(<AdsHealthPage />)

    await userEvent.click(await screen.findByText('等你点头'))

    // 面板自己去取待批准列表，取到空就如实说没有 —— 不是一个指向别处的链接
    await waitFor(() => expect(screen.getByText('目前没有等你点头的暂停建议。')).toBeTruthy())
    expect(screen.queryByText(/去「.*」处理/)).toBeNull()
  })

  it('有待批准时列出来，且批准按钮打的是原来那个接口、请求体一个字没变', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.includes('/ad-health/auto-pause/')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, kind: 'done' }) })
      }
      if (url.includes('/ad-health/auto-pause')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            items: [{
              runId: 'run-1', expectedDecisionId: 'dec-1', adsetId: '123', adsetName: '物流组',
              adAccountId: 'act_1', diagnosisTitle: '花钱没结果', insightDate: '2026-10-17',
              createdAt: '2026-10-17T00:00:00Z',
            }],
            hasMore: false,
          }),
        })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(respond([])) })
    }))
    render(<AdsHealthPage />)

    await userEvent.click(await screen.findByText('等你点头'))
    await waitFor(() => expect(screen.getByText('物流组', { exact: false })).toBeTruthy())

    await userEvent.click(screen.getByText('批准（立刻暂停）'))

    // 🔴 这一刀的全部红线：接口网址、方法、请求体一个字都不许变
    const decide = calls.find((c) => c.url.includes('/decision'))
    expect(decide).toBeTruthy()
    expect(decide!.url).toBe('/api/clients/d5c98811-1c1d-4ded-bdf0-4cefec6afb84/ad-health/auto-pause/run-1/decision')
    expect(decide!.init?.method).toBe('POST')
    expect(JSON.parse(String(decide!.init?.body))).toEqual({ resolution: 'approve', expectedDecisionId: 'dec-1' })
  })

  it('网址带 ?tab=approvals 时直接落在这个标签上', async () => {
    searchParamsValue = new URLSearchParams('tab=approvals')
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([]) }))
    render(<AdsHealthPage />)

    await waitFor(() =>
      expect(screen.getByText(/系统发现这些广告组连续花钱没结果/)).toBeTruthy(),
    )
  })

  /**
   * 🔴 这条用例第一版是空的：只断言「等你点头」那段**不在**。
   * 可是给一个认不出的标签名时，那段本来就不会渲染 —— 无论 `tabFromQuery`
   * 落不落回 'today'，断言都成立。变异验证（把判据改成「什么值都认」）
   * 16 条全绿，才发现它什么都没测。
   * 所以改成**正向**断言：必须真的落在「今天看这里」上，看到那个标签的内容。
   */
  it('?tab= 给了认不出的值，落回「今天看这里」而不是空白', async () => {
    searchParamsValue = new URLSearchParams('tab=nonsense')
    vi.stubGlobal('fetch', mockFetch({ '/ad-health': respond([]) }))
    render(<AdsHealthPage />)

    // 断言「哪个标签是选中态」，而不是断言某块面板的文字 ——
    // 选中态是这条用例真正要测的事，而面板内容会随取数结果变。
    const active = await screen.findByTitle('三句话：池子、频率、今天调什么')
    expect(active.className).toContain('border-gray-800')
    expect(screen.getByTitle('这个客户等人点头的广告动作').className).toContain('border-transparent')
    expect(screen.queryByText(/系统发现这些广告组连续花钱没结果/)).toBeNull()
  })
})

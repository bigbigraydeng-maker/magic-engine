import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import { PLAY_CATALOG } from '@/lib/ads-strategy/play-vocabulary'
import { STALE_AFTER_MS, STALE_LABEL } from '@/lib/ads-strategy/plan-seed/constants'
import { PlanSeedPanel, describeCapture } from '../PlanSeedPanel'

function mockFetch(response: { ok?: boolean; json: unknown } | 'throw'): void {
  if (response === 'throw') {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    )
    return
  }
  const ok = response.ok ?? true
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok,
        json: async () => response.json,
      }),
    ),
  )
}

function seed(over: Partial<PlanSeed> = {}): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: '2026-10-26T02:00:00Z',
    currency: 'NZD',
    period: { start_date: '2026-10-27', end_date: '2026-11-10' },
    captured_at: { act_A: '2026-10-26T01:31:00Z' },
    ad_steps: [
      {
        step_key: 's1',
        play: 'thruplay_pool_build',
        page_id: {
          ok: true,
          value: '555',
          basis: [
            {
              label: '客户主页',
              value: '555',
              source: '客户设置（clients.facebook_page_id）',
              as_of: null,
            },
          ],
          notes: [],
        },
        ad_account_id: {
          ok: true,
          value: 'act_A',
          basis: [
            {
              label: '余量数据抓取时间',
              value: '2026-10-26T01:31:00Z',
              source: 'ad_snapshot_captures',
              as_of: '2026-10-26T01:31:00Z',
            },
          ],
          notes: ['这个数没算进该时间之后新开的广告'],
        },
        daily_budget_cents: {
          ok: true,
          value: 5000,
          basis: [
            {
              label: '预算怎么算的',
              value: '客户余量 $150.00 NZD ÷ N=1 → $150.00 NZD',
              source: '剧本参数 + 广告快照',
              as_of: null,
            },
          ],
          notes: [],
        },
      },
    ],
    skipped: [],
    notes: [],
    ...over,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('describeCapture', () => {
  it('describes a fresh capture in Auckland time', () => {
    expect(describeCapture('2026-10-26T01:31:00Z', '2026-10-26T02:00:00Z')).toBe(
      '这个余量是按 10月26日 14:31 的数据算的，之后新开的广告没算进去',
    )
  })

  it('handles a null capture time', () => {
    const text = describeCapture(null, '2026-10-26T02:00:00Z')
    expect(text).toBe('读不到这个账户最近一次数据抓取的时间，预算建议不可靠，请看依据里的说明')
    expect(text.includes('减半')).toBe(false)
  })

  it('handles an unparseable capture time', () => {
    const text = describeCapture('not-a-date', '2026-10-26T02:00:00Z')
    expect(text).toBe('读不到这个账户最近一次数据抓取的时间，预算建议不可靠，请看依据里的说明')
    expect(text.includes('减半')).toBe(false)
  })

  it('flags a stale capture (16 hours old)', () => {
    expect(describeCapture('2026-10-25T10:00:00Z', '2026-10-26T02:00:00Z')).toBe(
      `这个余量是按 10月25日 23:00 的数据算的，之后新开的广告没算进去；数据已不是最新一轮（超过 ${STALE_LABEL}），预算已按保守口径减半`,
    )
  })

  it('does not flag a capture exactly STALE_AFTER_MS old', () => {
    const factsAsOf = '2026-10-26T02:00:00Z'
    const capturedAt = new Date(Date.parse(factsAsOf) - STALE_AFTER_MS).toISOString()
    const text = describeCapture(capturedAt, factsAsOf)
    expect(text.includes('数据已不是最新一轮')).toBe(false)
    expect(text.includes('减半')).toBe(false)
  })

  it('stale threshold is 6.5 hours in real terms', () => {
    const factsAsOf = '2026-10-26T02:00:00Z'

    const sixHoursBefore = describeCapture('2026-10-25T20:00:00Z', factsAsOf)
    expect(sixHoursBefore.includes('数据已不是最新一轮')).toBe(false)

    const sevenHoursBefore = describeCapture('2026-10-25T19:00:00Z', factsAsOf)
    expect(sevenHoursBefore).toContain(
      '数据已不是最新一轮（超过 6 小时半），预算已按保守口径减半',
    )
  })

  it('flags a capture one minute past STALE_AFTER_MS', () => {
    const factsAsOf = '2026-10-26T02:00:00Z'
    const capturedAt = new Date(
      Date.parse(factsAsOf) - STALE_AFTER_MS - 60_000,
    ).toISOString()
    const text = describeCapture(capturedAt, factsAsOf)
    expect(text.includes(`数据已不是最新一轮（超过 ${STALE_LABEL}），预算已按保守口径减半`)).toBe(
      true,
    )
  })
})

describe('PlanSeedPanel', () => {
  it('shows the loading state while the request is pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const loading = await screen.findByText('正在算 Agent 的建议…')
    expect(loading).not.toBeNull()
    expect(document.body.textContent).toContain(
      '这些数字只是 Agent 的建议，批准这份处方不等于批准花这些钱',
    )
  })

  it('shows the error state when fetch throws', async () => {
    mockFetch('throw')
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText('读不到 Agent 的建议（接口出错），稍后刷新再试')
    expect(el).not.toBeNull()
  })

  it('shows the error state when the response is not ok', async () => {
    mockFetch({ ok: false, json: {} })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText('读不到 Agent 的建议（接口出错），稍后刷新再试')
    expect(el).not.toBeNull()
  })

  it('shows the error state when success is false', async () => {
    mockFetch({ json: { success: false, error: 'x' } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText('读不到 Agent 的建议（接口出错），稍后刷新再试')
    expect(el).not.toBeNull()
  })

  it('shows the empty reason verbatim', async () => {
    mockFetch({
      json: { success: true, seed: null, reason: '这份处方没有填广告打法（ad_plays）' },
    })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText('这份处方没有填广告打法（ad_plays）')
    expect(el).not.toBeNull()
  })

  it('renders the ready state with budget, ids, basis and play label', async () => {
    mockFetch({ json: { success: true, seed: seed() } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await screen.findByText('广告步骤的建议')

    const text = document.body.textContent ?? ''
    expect(text).toContain('$50.00 NZD')
    expect(text).toContain('555')
    expect(text).toContain('act_A')
    expect(text).toContain('凭什么')
    expect(text).toContain('客户余量 $150.00 NZD ÷ N=1 → $150.00 NZD')
    expect(text).toContain('来源：剧本参数 + 广告快照')
    expect(text).toContain(PLAY_CATALOG.thruplay_pool_build.label)
    expect(text).toContain('批准这份处方不等于批准花这些钱')
    expect(text).toContain('日预算才是以后真能花出去的数')
  })

  it('shows the why_empty text for a field that could not be filled', async () => {
    const s = seed()
    const step = s.ad_steps[0]
    const withEmpty: PlanSeed = {
      ...s,
      ad_steps: [
        {
          ...step,
          daily_budget_cents: {
            ok: false,
            why_empty: '预算余量不够这一步（客户余量 0 ÷ 1）',
            notes: [],
          },
        },
      ],
    }
    mockFetch({ json: { success: true, seed: withEmpty } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText('没填上：预算余量不够这一步（客户余量 0 ÷ 1）')
    expect(el).not.toBeNull()
    expect(document.body.textContent).not.toContain('$')
  })

  it('shows skipped steps and notes', async () => {
    mockFetch({
      json: {
        success: true,
        seed: seed({
          skipped: [
            {
              step_key: 's2',
              why_empty: '没有合格的广告账户：act_A：账户状态码是 2，不是 1（可投放）',
            },
          ],
          notes: ['多币种'],
        }),
      },
    })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const skipped = await screen.findByText(
      's2：没有合格的广告账户：act_A：账户状态码是 2，不是 1（可投放）',
    )
    expect(skipped).not.toBeNull()
    expect(document.body.textContent).toContain('多币种')
  })

  it('renders the fresh capture sentence', async () => {
    mockFetch({ json: { success: true, seed: seed() } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText(
      '账户 act_A：这个余量是按 10月26日 14:31 的数据算的，之后新开的广告没算进去',
    )
    expect(el).not.toBeNull()
  })

  it('renders the stale capture sentence', async () => {
    mockFetch({
      json: { success: true, seed: seed({ captured_at: { act_A: '2026-10-25T10:00:00Z' } }) },
    })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await screen.findByText('广告步骤的建议')
    expect(document.body.textContent).toContain(
      `数据已不是最新一轮（超过 ${STALE_LABEL}），预算已按保守口径减半`,
    )
  })

  it('renders the null capture sentence', async () => {
    mockFetch({ json: { success: true, seed: seed({ captured_at: { act_A: null } }) } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    const el = await screen.findByText(
      '账户 act_A：读不到这个账户最近一次数据抓取的时间，预算建议不可靠，请看依据里的说明',
    )
    expect(el).not.toBeNull()
  })

  it('shows the unreadable-currency note next to the amount', async () => {
    mockFetch({ json: { success: true, seed: seed({ currency: null }) } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await screen.findByText('广告步骤的建议')
    expect(document.body.textContent).toContain('$50.00（币种读不到）')
  })

  it('renders nothing and does not fetch when prescriptionId is null', () => {
    mockFetch({ json: { success: true, seed: seed() } })
    const { container } = render(<PlanSeedPanel clientId="c1" prescriptionId={null} />)
    expect(container.textContent).toBe('')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('calls the plan-seed endpoint with client and prescription ids', async () => {
    mockFetch({ json: { success: true, seed: seed() } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/clients/c1/prescription/p1/plan-seed',
        expect.anything(),
      )
    })
  })

  it('does not leak forbidden jargon in the ready state', async () => {
    mockFetch({ json: { success: true, seed: seed() } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await screen.findByText('广告步骤的建议')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('seed')
    expect(text).not.toContain('schema')
    expect(text).not.toContain('Basis')
  })
})

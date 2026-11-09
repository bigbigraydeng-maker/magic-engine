import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import { PlanSeedPanel } from '../PlanSeedPanel'

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

const FOOTER = '读到的在投合计来自最近一次数据抓取，抓取之后新开的广告不在内。'

function seedWithBudgetBasis(
  basis: Array<{ label: string; value: string; source: string; as_of: string | null }>,
): PlanSeed {
  const s = seed()
  const step = s.ad_steps[0]
  return {
    ...s,
    ad_steps: [
      {
        ...step,
        daily_budget_cents: {
          ok: true,
          value: 2750,
          basis,
          notes: [],
        },
      },
    ],
  }
}

describe('PlanSeedPanel snapshot-limit footer', () => {
  it('shows the footer when the live read was not used (incomplete live read)', async () => {
    const s = seedWithBudgetBasis([
      {
        label: '在投合计（实时）',
        value:
          '实时读到的不含系列级预算（CBO），和快照口径不同，不能比，这次不用实时数，仍按 10月26日 14:31 的快照算',
        source: '广告快照',
        as_of: '2026-10-26T01:31:00Z',
      },
      {
        label: '数据口径',
        value: FOOTER,
        source: '剧本参数 + 广告快照',
        as_of: null,
      },
    ])
    mockFetch({ json: { success: true, seed: s } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await screen.findByText('广告步骤的建议')
    const text = document.body.textContent ?? ''
    expect(text.split(FOOTER).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('hides the footer when the live read was used', async () => {
    const s = seedWithBudgetBasis([
      {
        label: '在投合计（实时）',
        value:
          '快照 $45.00（抓取 10月26日 14:31），实时 $55.00（读数 10月26日 14:45），这次用 $55.00',
        source: '实时读 Meta（只读）',
        as_of: '2026-10-26T01:45:00Z',
      },
    ])
    mockFetch({ json: { success: true, seed: s } })
    render(<PlanSeedPanel clientId="c1" prescriptionId="p1" />)
    await screen.findByText('广告步骤的建议')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain(FOOTER)
  })
})

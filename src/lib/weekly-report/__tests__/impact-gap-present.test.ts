import { describe, expect, it } from 'vitest'
import { presentCiLines, presentImpactGapBlock, presentM2Lines } from '../impact-gap-present'
import type { ClientImpactGapBundle, M2SpendVsCapSlice } from '../impact-gap-present'

const m2 = (over: Partial<M2SpendVsCapSlice> = {}): M2SpendVsCapSlice => ({
  status: 'gap',
  windowLabel: '2026-11-01 ～ 2026-11-07',
  accounts: [],
  spend7dTotal: null,
  currency: null,
  mixedCurrency: true,
  clientDailyCapCents: null,
  capSource: 'missing',
  gaps: ['多账户币种不一致'],
  settingsHref: '/settings',
  ...over,
})

describe('impact-gap-present', () => {
  it('跨币种不合计，缺上限不代填，无 winner 为 UNKNOWN', () => {
    const spend = presentM2Lines(m2())
    expect(spend.some(l => l.includes('币种不一致'))).toBe(true)
    expect(spend.some(l => l.includes('未在 ME 设置里填写'))).toBe(true)
    expect(presentCiLines({
      status: 'unknown', winnerHold: false, minLeads: 20,
      segments: [{ name: '钩子', state: 'unknown', note: '缺可比 winner' }],
      gaps: [], entityTreeHref: '/entities',
    })[0]).toContain('UNKNOWN')
  })

  it('四段标题都进周报块', () => {
    const bundle: ClientImpactGapBundle = {
      clientId: 'c1',
      m2: m2({ mixedCurrency: false, spend7dTotal: 10, currency: 'NZD', capSource: 'me_settings', clientDailyCapCents: 4000, gaps: [] }),
      i1: { status: 'ok', hasActiveBrief: true, missingFields: [], gaps: [], settingsHref: '/settings' },
      c3: { status: 'ok', lines: [], gaps: [], adsHealthHref: '/ads' },
      ci: { status: 'unknown', winnerHold: false, minLeads: 20, segments: [], gaps: [], entityTreeHref: '/entities' },
    }
    const html = presentImpactGapBlock(bundle)
    for (const title of ['M-2', 'I-1', 'C-3', 'C-i']) expect(html).toContain(title)
  })
})

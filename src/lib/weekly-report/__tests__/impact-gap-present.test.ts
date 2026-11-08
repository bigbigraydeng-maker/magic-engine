import { describe, expect, it } from 'vitest'
import {
  presentCiLines,
  presentM2Lines,
  presentImpactGapBlock,
} from '../impact-gap-present'
import type { CiFunnelCheckSlice, ClientImpactGapBundle, M2SpendVsCapSlice } from '../impact-gap-present'

const baseM2 = (over: Partial<M2SpendVsCapSlice> = {}): M2SpendVsCapSlice => ({
  status: 'gap',
  windowLabel: '2026-11-01 ～ 2026-11-07',
  accounts: [],
  spend7dTotal: null,
  currency: null,
  mixedCurrency: true,
  clientDailyCapCents: null,
  capSource: 'missing',
  gaps: ['多账户币种不一致'],
  settingsHref: '/dashboard/clients/x/ads-health?tab=settings',
  ...over,
})

describe('impact-gap-present', () => {
  it('跨币种不混算：不写合计金额', () => {
    const lines = presentM2Lines(baseM2())
    expect(lines.some(l => l.includes('币种不一致'))).toBe(true)
    expect(lines.some(l => l.includes('近 7 天实花：没读到') || lines.some(x => x.includes('未做跨币种')))).toBe(true)
  })

  it('缺上限须写明 Ray/设置，不代填', () => {
    const lines = presentM2Lines(baseM2())
    expect(lines.some(l => l.includes('未在 ME 设置里填写'))).toBe(true)
  })

  it('C-i 无 winner 时 UNKNOWN', () => {
    const slice: CiFunnelCheckSlice = {
      status: 'unknown',
      winnerHold: false,
      minLeads: 20,
      segments: [{ name: '钩子', state: 'unknown', note: '缺可比 winner' }],
      gaps: [],
      entityTreeHref: '/entities',
    }
    const lines = presentCiLines(slice)
    expect(lines[0]).toContain('UNKNOWN')
  })

  it('render block 含四段标题', () => {
    const bundle: ClientImpactGapBundle = {
      clientId: 'c1',
      m2: baseM2({ mixedCurrency: false, spend7dTotal: 10, currency: 'NZD', capSource: 'me_settings', clientDailyCapCents: 4000, gaps: [] }),
      i1: {
        status: 'ok',
        hasActiveBrief: true,
        missingFields: [],
        gaps: [],
        settingsHref: '/settings',
      },
      c3: { status: 'ok', lines: [], gaps: [], adsHealthHref: '/ads' },
      ci: {
        status: 'unknown',
        winnerHold: false,
        minLeads: 20,
        segments: [],
        gaps: [],
        entityTreeHref: '/entities',
      },
    }
    const html = presentImpactGapBlock(bundle)
    expect(html).toContain('M-2')
    expect(html).toContain('I-1')
    expect(html).toContain('C-3')
    expect(html).toContain('C-i')
  })
})

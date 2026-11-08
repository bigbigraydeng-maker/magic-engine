import { describe, expect, it } from 'vitest'
import { PAGE_TABS, tabFromQuery } from '@/app/dashboard/clients/[id]/ads-health/tabs'
import { WINNER_ADS_TAB, WINNER_TAB_LABEL, winnerBoardPath, winnerBoardUrl } from '../winner-links'

describe('广告样板链接', () => {
  it('链接里的 tab 值就是广告健康页真实认得的标签，标签排在「每条广告」之后', () => {
    expect(tabFromQuery(WINNER_ADS_TAB)).toBe(WINNER_ADS_TAB)
    const keys = PAGE_TABS.map((t) => t.key)
    expect(keys.indexOf(WINNER_ADS_TAB)).toBe(keys.indexOf('ads') + 1)
    expect(PAGE_TABS.find((t) => t.key === WINNER_ADS_TAB)?.label).toBe(WINNER_TAB_LABEL)
  })

  it('路径与完整网址同一个落点', () => {
    expect(winnerBoardPath('c1')).toBe('/dashboard/clients/c1/ads-health?tab=winners')
    expect(winnerBoardUrl('c1')).toBe('https://app.magicengine.com.au/dashboard/clients/c1/ads-health?tab=winners')
  })
})

/**
 * 上线卡读账本里的暂停草稿：多个广告组的草稿只有 adSetIds、没有单个 adSetId，
 * 上线卡只会开一个组，所以必须读成「编号不全」（ids = null），不能挑第一个组去开。
 */
import { describe, it, expect } from 'vitest'
import { parsePausedDraft } from '../draft'

const SINGLE = {
  status: 'awaiting_approval',
  draft: { kind: 'lead_form', dailyBudget: 30, durationDays: 7 },
  campaignId: 'camp1',
  adSetId: 'as1',
  adIds: ['ad1'],
}

describe('parsePausedDraft', () => {
  it('单组草稿：编号齐全 → ids 有值（行为不变）', () => {
    expect(parsePausedDraft(SINGLE)?.ids).toEqual({ campaignId: 'camp1', adSetId: 'as1', adIds: ['ad1'] })
  })

  it('多组草稿（账本只有 adSetIds、没有 adSetId）→ ids = null', () => {
    const multi = { ...SINGLE, adSetId: undefined, adSetIds: ['as1', 'as2', 'as3'], adIds: ['ad1', 'ad2', 'ad3'] }
    expect(parsePausedDraft(multi)?.ids).toBeNull()
  })

  it('多组草稿即使被人补上了 adSetId，也不能读成可开的单组 → ids = null', () => {
    const multi = { ...SINGLE, adSetIds: ['as1', 'as2', 'as3'], adIds: ['ad1', 'ad2', 'ad3'] }
    expect(parsePausedDraft(multi)?.ids).toBeNull()
  })

  it('草稿正文里写着 adSets 的也不当单组', () => {
    const multi = { ...SINGLE, draft: { ...SINGLE.draft, adSets: [{ name: 'a' }] } }
    expect(parsePausedDraft(multi)?.ids).toBeNull()
  })

  it('adSetIds 是空数组（旧记录）→ 仍按单组读', () => {
    expect(parsePausedDraft({ ...SINGLE, adSetIds: [] })?.ids).not.toBeNull()
  })
})

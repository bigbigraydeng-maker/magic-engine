import { describe, expect, it } from 'vitest'
import { addCreativeOutcomeFromHold } from '../outcome'
import type { CreativeHold } from '../ledger'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'

function hold(status: CreativeHold['status'], resultLine?: string): CreativeHold {
  return {
    kind: 'add_ad_creative',
    status,
    cardRunId: '40000000-0000-4000-8000-000000001111',
    subjectKey: 'add-set:abc',
    fingerprint: 'f'.repeat(64),
    orderKey: 'k1',
    order: {
      adAccountId: 'act_123456789012',
      adSetId: '998877665544',
      imagePath: `renders/${CLIENT}/wo/poster.jpg`,
      primaryText: '正文',
      headline: '标题',
      ctaType: 'LEARN_MORE',
      adName: '广告名',
      status: 'PAUSED',
    },
    copy: { sourceAdId: 'ad1', pageId: 'pg1', link: 'https://example.com', leadFormId: null },
    planId: 'plan-1',
    imageHash: null,
    creativeId: null,
    adId: null,
    wrote: false,
    resultLine,
  }
}

describe('addCreativeOutcomeFromHold', () => {
  it('maps executed holds to 已做完 and the stored line', () => {
    const line = '新广告已建成，状态是暂停。没有改这一组的预算。'
    expect(addCreativeOutcomeFromHold(hold('executed', line))).toEqual({ statusChip: '已做完', statusLine: line })
  })

  it('maps failed holds to 没做成 and the stored line', () => {
    const line = '图没传上去：HTTP 500。没有去建广告。'
    expect(addCreativeOutcomeFromHold(hold('failed', line))).toEqual({ statusChip: '没做成', statusLine: line })
  })

  it('leaves holding and declined without an outcome overlay', () => {
    expect(addCreativeOutcomeFromHold(hold('holding'))).toBeNull()
    expect(addCreativeOutcomeFromHold(hold('declined', '没有加这条广告。'))).toBeNull()
  })
})
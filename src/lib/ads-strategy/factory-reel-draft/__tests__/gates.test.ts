import { describe, it, expect } from 'vitest'
import { REEL_HUMAN_CHECK_KEYS, REEL_AUTO_CHECK_KEYS } from '@/lib/social/content-review'
import {
  checkIdentity,
  checkApprovalEvidence,
  checkFreshness,
  collectReelTexts,
  checkCopyRedlines,
  evaluateReelDraftGates,
  type ReelDraftEventClaim,
  type ReelWorkOrderRow,
} from '../gates'

const PUBLISHED_AT = '2026-10-09T01:00:00.000Z'
const PUBLISHED_MS = Date.parse(PUBLISHED_AT)

function humanItems(): Array<Record<string, unknown>> {
  return REEL_HUMAN_CHECK_KEYS.map((key) => ({
    key,
    judge: 'HUMAN',
    outcome: 'PASS',
    detail: null,
    source_ref:
      key === 'factual_claims_have_source' || key === 'factual_claims_source_verified'
        ? 'https://example.test/source'
        : null,
  }))
}

function autoItems(): Array<Record<string, unknown>> {
  return REEL_AUTO_CHECK_KEYS.map((key) => ({
    key,
    judge: 'AUTO',
    outcome: 'PASS',
    detail: null,
    source_ref: null,
  }))
}

function goodRow(): ReelWorkOrderRow {
  return {
    id: 'w1',
    client_id: 'c1',
    status: 'published',
    brief: {
      copy: {
        caption: 'Explore the coast this summer',
        endcard: {
          cta: 'Book now',
          vo: 'See you there',
          offer: ['From the weekend'],
        },
      },
    },
    output: {
      quality_checklist_auto: autoItems(),
      redline_hits: [],
    },
    review_ref: {
      approved_by: 'pm@example.test',
      checklist_human: humanItems(),
    },
    published_ref: {
      platform: 'facebook',
      page_id: '111111',
      video_id: '222222',
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
    },
  }
}

function goodClaim(): ReelDraftEventClaim {
  return {
    clientId: 'c1',
    workOrderId: 'w1',
    pageId: '111111',
    videoId: '222222',
    publishedAt: PUBLISHED_AT,
  }
}

describe('evaluateReelDraftGates 全部通过', () => {
  it('全部通过时返回 ok 且包含文案', () => {
    const result = evaluateReelDraftGates({
      claim: goodClaim(),
      row: goodRow(),
      redlines: [],
      nowMs: PUBLISHED_MS + 60 * 60 * 1000,
      maxAgeHours: 6,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.texts).toContain('Explore the coast this summer')
      expect(result.texts).toContain('Book now')
    }
  })
})

describe('checkIdentity', () => {
  it('客户不一致 => client_mismatch', () => {
    const row = goodRow()
    row.client_id = 'other'
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('client_mismatch')
  })

  it('工单号不一致 => client_mismatch', () => {
    const row = goodRow()
    row.id = 'w2'
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('client_mismatch')
  })

  it('主页不一致 => page_mismatch', () => {
    const row = goodRow()
    row.published_ref = {
      platform: 'facebook',
      page_id: '999999',
      video_id: '222222',
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
    }
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('page_mismatch')
  })

  it('published_ref 为 null => page_mismatch', () => {
    const row = goodRow()
    row.published_ref = null
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('page_mismatch')
  })

  it('video_id 缺失时用 post_id 兜底也能对上', () => {
    const row = goodRow()
    row.published_ref = {
      platform: 'facebook',
      page_id: '111111',
      post_id: '222222',
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
    }
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(true)
  })

  it('视频不一致 => video_mismatch', () => {
    const row = goodRow()
    row.published_ref = {
      platform: 'facebook',
      page_id: '111111',
      video_id: '333333',
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
    }
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('video_mismatch')
  })

  it('状态不是 published => not_published', () => {
    const row = goodRow()
    row.status = 'approved'
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_published')
  })

  it('video_state 不是 PUBLISHED => not_published', () => {
    const row = goodRow()
    row.published_ref = {
      platform: 'facebook',
      page_id: '111111',
      video_id: '222222',
      video_state: 'DRAFT',
      published_at: PUBLISHED_AT,
    }
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_published')
  })

  it('平台不是 facebook => not_published', () => {
    const row = goodRow()
    row.published_ref = {
      platform: 'instagram',
      page_id: '111111',
      video_id: '222222',
      video_state: 'PUBLISHED',
      published_at: PUBLISHED_AT,
    }
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('not_published')
  })

  it('发布时间不一致 => published_at_mismatch', () => {
    const row = goodRow()
    row.published_ref = {
      platform: 'facebook',
      page_id: '111111',
      video_id: '222222',
      video_state: 'PUBLISHED',
      published_at: '2026-10-09T02:00:00.000Z',
    }
    const result = checkIdentity(goodClaim(), row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('published_at_mismatch')
  })
})

describe('checkApprovalEvidence', () => {
  it('approved_by 为空串 => approval_missing', () => {
    const row = goodRow()
    row.review_ref = { approved_by: '', checklist_human: humanItems() }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('approval_missing')
  })

  it('approved_by 缺失 => approval_missing', () => {
    const row = goodRow()
    row.review_ref = { checklist_human: humanItems() }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('approval_missing')
  })

  it('人工清单有一项 FAIL => checklist_not_passed', () => {
    const row = goodRow()
    const items = humanItems().map((item, i) =>
      i === 0 ? { ...item, outcome: 'FAIL', detail: '有问题' } : item,
    )
    row.review_ref = { approved_by: 'pm@example.test', checklist_human: items }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('checklist_not_passed')
  })

  it('人工清单缺失 => checklist_not_passed', () => {
    const row = goodRow()
    row.review_ref = { approved_by: 'pm@example.test' }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('checklist_not_passed')
  })

  it('自动清单有一项 NOT_MEASURED => checklist_not_passed', () => {
    const row = goodRow()
    const items = autoItems().map((item, i) =>
      i === 0 ? { ...item, outcome: 'NOT_MEASURED' } : item,
    )
    row.output = { quality_checklist_auto: items, redline_hits: [] }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('checklist_not_passed')
  })

  it('redline_hits 缺失 => redline_scan_missing', () => {
    const row = goodRow()
    row.output = { quality_checklist_auto: autoItems() }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('redline_scan_missing')
  })

  it('redline_hits 非空 => redline_hits_present', () => {
    const row = goodRow()
    row.output = { quality_checklist_auto: autoItems(), redline_hits: ['x'] }
    const result = checkApprovalEvidence(row)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('redline_hits_present')
  })
})

describe('checkFreshness', () => {
  it('发布后 1 小时、上限 6 小时 => ok', () => {
    const result = checkFreshness(PUBLISHED_AT, PUBLISHED_MS + 60 * 60 * 1000, 6)
    expect(result.ok).toBe(true)
  })

  it('正好 6 小时 => ok', () => {
    const result = checkFreshness(PUBLISHED_AT, PUBLISHED_MS + 6 * 60 * 60 * 1000, 6)
    expect(result.ok).toBe(true)
  })

  it('超过 6 小时 1 毫秒 => stale', () => {
    const result = checkFreshness(PUBLISHED_AT, PUBLISHED_MS + 6 * 60 * 60 * 1000 + 1, 6)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('stale')
  })

  it('发布时间比现在晚 10 分钟 => bad_published_at', () => {
    const result = checkFreshness(PUBLISHED_AT, PUBLISHED_MS - 10 * 60 * 1000, 6)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad_published_at')
  })

  it('发布时间不是合法 ISO => bad_published_at', () => {
    const result = checkFreshness('not-a-date', PUBLISHED_MS, 6)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad_published_at')
  })

  it('maxAgeHours 为 0 => bad_published_at', () => {
    const result = checkFreshness(PUBLISHED_AT, PUBLISHED_MS, 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad_published_at')
  })

  it('maxAgeHours 为 NaN => bad_published_at', () => {
    const result = checkFreshness(PUBLISHED_AT, PUBLISHED_MS, Number.NaN)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('bad_published_at')
  })
})

describe('collectReelTexts', () => {
  it('brief 为 null => copy_unreadable', () => {
    const result = collectReelTexts(null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('copy_unreadable')
  })

  it('copy 缺失 => copy_unreadable', () => {
    const result = collectReelTexts({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('copy_unreadable')
  })

  it('copy 为空对象 => copy_unreadable', () => {
    const result = collectReelTexts({ copy: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('copy_unreadable')
  })
})

describe('checkCopyRedlines', () => {
  const texts = ['Explore the coast this summer', 'Book now', 'See you there', 'From the weekend']

  it('redlines 为 null => redlines_unreadable', () => {
    const result = checkCopyRedlines(texts, null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('redlines_unreadable')
  })

  it('redlines 为空数组 => ok', () => {
    const result = checkCopyRedlines(texts, [])
    expect(result.ok).toBe(true)
  })

  it('命中 endcard offer 文案 => copy_redline_hit', () => {
    const result = checkCopyRedlines(texts, ['From the weekend'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('copy_redline_hit')
      expect(result.message).toContain('From the weekend')
    }
  })

  it('只命中 caption => copy_redline_hit', () => {
    const result = checkCopyRedlines(texts, ['coast'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('copy_redline_hit')
  })

  it('任何文案都没命中 => ok', () => {
    const result = checkCopyRedlines(texts, ['zebra'])
    expect(result.ok).toBe(true)
  })
})

describe('evaluateReelDraftGates 顺序', () => {
  it('同时违反身份和红线时先报身份问题', () => {
    const row = goodRow()
    row.client_id = 'other'
    const result = evaluateReelDraftGates({
      claim: goodClaim(),
      row,
      redlines: ['Explore'],
      nowMs: PUBLISHED_MS + 60 * 60 * 1000,
      maxAgeHours: 6,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('client_mismatch')
  })
})

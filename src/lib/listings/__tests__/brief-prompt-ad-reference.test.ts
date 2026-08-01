/**
 * 提示词里那一段「我们自己投过的」。
 *
 * 光在代码里挡住「实测改排序」还不够 —— 模型看到数字的那一刻就在推理了。
 * 所以两件事必须在提示词里成立，而且必须**跟数字贴在一起**：
 *   · 明写「不许据此改排序」
 *   · 每个数字后面缝着样本量（不给样本量，模型会跟人犯一模一样的错）
 */

import { describe, expect, it } from 'vitest'
import { buildBriefUserMessage, describeAdReference, LISTING_BRIEF_SYSTEM_PROMPT } from '../brief-prompt'
import { buildAdReference, type AdInsightRow } from '../ad-benchmarks'
import type { ListingRow } from '../queries'

const LISTING: ListingRow = {
  id: 'l1',
  client_id: 'c1',
  address_line: '2/30 Kiteroa Terrace',
  suburb: 'Rothesay Bay',
  city: 'Auckland',
  property_type: 'house',
  bedrooms: 3,
  price_band: '1m_1_5m',
  status: 'live',
  listed_on: '2026-07-20',
  delisted_on: null,
  sold_on: null,
  sold_price: null,
  vendor_notes: null,
  external_ref: null,
  created_at: '2026-07-20T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
}

const ROWS: AdInsightRow[] = [
  { entity_id: 'ad_a', insight_date: '2026-07-28', spend: '27.83', impressions: '1153', clicks: '35', leads: 0, messaging_conversations: 1 },
]

const REFERENCE = buildAdReference({
  similarity: { price_band: '1m_1_5m', suburb: 'Rothesay Bay', property_type: 'house' },
  own: { scope: 'this_client', rows: ROWS, listings: 1, clients: 1, listingsInAccounts: 2 },
  peers: null,
  evidence: { confirmedListings: 1, distinctClients: 1, consecutiveReversals: 0 },
  now: new Date('2026-08-01T00:00:00Z'),
})

describe('系统提示词', () => {
  it('明写实测只作参考、不许改排序', () => {
    expect(LISTING_BRIEF_SYSTEM_PROMPT).toContain('REFERENCE ONLY')
    expect(LISTING_BRIEF_SYSTEM_PROMPT).toContain('MUST NOT let it change "angle_ranking" or "buyer_segments"')
  })
})

describe('实测那一段', () => {
  const text = describeAdReference(REFERENCE)

  it('禁令跟数字贴在同一段里，不是只丢在系统提示词', () => {
    expect(text).toContain('must not change your ranking')
    expect(text).toContain('as if this section did not exist')
  })

  it('每个成本数后面都缝着样本量', () => {
    expect(text).toContain('$27.83 · 基于 1 次对话')
  })

  it('明说这些数字不是按角度拆的', () => {
    expect(text).toContain('NOT broken down by angle')
    expect(text).toContain('不是按卖点角度拆开的')
  })

  it('成色写出来：还没攒够 6 套', () => {
    expect(text).toContain('单轮观察，样本不足')
  })

  it('没有实测就整段不出现，不给模型一段空表格去脑补', () => {
    expect(describeAdReference(null)).toBe('')
  })
})

describe('拼进完整用户消息', () => {
  it('带实测时，段落和禁令都在', () => {
    const msg = buildBriefUserMessage({
      listing: LISTING, pageMarkdown: null, pageUrl: null, country: 'NZ', city: 'Auckland',
      adReference: REFERENCE,
    })
    expect(msg).toContain('## Our own past ad results')
    expect(msg).toContain('基于 1 次对话')
    expect(msg).toContain('it must NOT move a single angle up or down')
  })

  it('不带实测时，整段不出现（老行为不变）', () => {
    const msg = buildBriefUserMessage({
      listing: LISTING, pageMarkdown: null, pageUrl: null, country: 'NZ', city: 'Auckland',
    })
    expect(msg).not.toContain('## Our own past ad results')
    expect(msg).not.toContain('基于')
  })
})

/**
 * CTS policy × content_claims gate. The point of these tests: a Chinese price / date /
 * promise that the old `$` and ISO-date gate could not see must now make `ok` false
 * (blocked), and a Chinese price that equals a confirmed fact must still pass.
 * Mutation target: removing the gate from `ctsVerifierGates` must turn these red.
 */

import { describe, expect, it } from 'vitest'
import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'
import { CTS_CLIENT_ID, ctsVerifierGates, verifyCtsReply, type CtsVerifierContext } from '../policies/cts'

const GOLDEN: KnowledgeEntry = {
  id: 'fact-golden',
  clientId: CTS_CLIENT_ID,
  factKey: 'tour.active.golden-china',
  scope: {},
  statement: 'China Discovery — Golden China',
  structuredValue: {
    code: 'golden-china',
    name: 'China Discovery — Golden China',
    aliases: ['Golden China'],
    price_nzd: 4999,
    departure_dates: ['2026-11-16'],
    itinerary_url: 'https://www.ctstours.co.nz/tours/china/discovery/golden-china',
  },
  conflictGroupId: null,
  status: 'approved',
  visibility: 'customer_ok',
  sensitivity: 'price',
  validFrom: '2026-09-01T00:00:00Z',
  validUntil: null,
  lastVerifiedAt: null,
  approvedByEmail: 'ray@magicengine.cloud',
  approvedAt: '2026-09-01T00:00:00Z',
  clientConfirmedByEmail: 'client@ctstours.co.nz',
  clientConfirmedAt: '2026-09-01T00:00:00Z',
}

const WITH_FACTS: KnowledgeReadResult = { entries: [GOLDEN], forbiddenFactKeys: [] }
const NO_FACTS: KnowledgeReadResult = { entries: [], forbiddenFactKeys: [] }

function ctx(replyText: string, knowledge: KnowledgeReadResult, withOffering = false): CtsVerifierContext {
  return {
    clientId: CTS_CLIENT_ID,
    agentOutput: {
      reply_text: replyText,
      confidence: 0.9,
      offerings: withOffering ? [{ name: 'Golden China', code: 'golden-china' }] : [],
    },
    brandRedlinePhrases: [],
    knowledge,
  }
}

function contentClaimsReasons(replyText: string, knowledge: KnowledgeReadResult, withOffering = false): string[] {
  return verifyCtsReply(ctx(replyText, knowledge, withOffering)).blocked_reasons.filter((r) =>
    r.startsWith('content_claims:'),
  )
}

describe('content_claims gate is part of the CTS pipeline', () => {
  it('is registered in ctsVerifierGates', () => {
    expect(ctsVerifierGates.map((g) => g.id)).toContain('content_claims')
  })
})

describe('Chinese claims that the old gate could not see are now blocked', () => {
  it.each([
    '每人3880纽币',
    '3月18号出发',
    '有效期至2026年12月31日',
    '保证出签',
    '您不需要办签证',
    '仅剩2个名额',
    '三千八就能走',
  ])('blocks with no confirmed facts: %s', (text) => {
    const r = verifyCtsReply(ctx(text, NO_FACTS))
    expect(r.ok).toBe(false)
    expect(contentClaimsReasons(text, NO_FACTS).length).toBe(1)
  })

  it('blocks a Chinese price that is not the confirmed price', () => {
    const text = 'Golden China 团费3880纽币'
    expect(contentClaimsReasons(text, WITH_FACTS, true).length).toBe(1)
  })

  it('blocks a Chinese date that is not a confirmed departure date', () => {
    expect(contentClaimsReasons('Golden China 12月5日出发', WITH_FACTS, true).length).toBe(1)
  })

  it('a promise is blocked even when the price and date are confirmed facts', () => {
    expect(contentClaimsReasons('Golden China 4999纽币，11月16日出发，保证出签', WITH_FACTS, true).length).toBe(1)
  })
})

describe('Chinese claims that equal a confirmed fact still pass this gate', () => {
  it('price 4999 and date 11月16日 written in Chinese', () => {
    expect(contentClaimsReasons('Golden China 团费4999纽币，11月16日出发', WITH_FACTS, true)).toEqual([])
  })
  it('an ordinary courtesy reply', () => {
    const text = '感谢您的留言，我们的顾问稍后回复您。'
    expect(contentClaimsReasons(text, NO_FACTS)).toEqual([])
    expect(verifyCtsReply(ctx(text, NO_FACTS)).ok).toBe(true)
  })
})

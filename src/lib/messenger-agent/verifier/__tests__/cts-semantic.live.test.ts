// Live API regression tests — calls the real Jev/TypeSafe endpoint, no mock
// (kept in a separate file from cts-semantic.test.ts, which mocks
// '@/lib/jev/client' at module scope; a vitest module mock can't be reliably
// bypassed within the same file without breaking module caching — same
// convention as fact-check.live.test.ts).
//
// Requires TYPESAFE_API_KEY. Skipped (not failed) when the key isn't present
// in the environment running this suite, so CI without the key still passes;
// only a run with the key actually exercises the real model. These two
// question types (brand_redline_semantic / number_claim_semantic) had never
// been run against the real Jev API before this file — 子牙+魏征复审
// 2026-09-20 required this validation before merge, since the mocked suite
// only proves the internal wiring, not that the real model's response shape
// matches what the code expects (`result.answers.<key>.noul`).

import { describe, expect, it } from 'vitest'
import type { KnowledgeEntry, KnowledgeReadResult } from '@/lib/knowledge'
import { CTS_CLIENT_ID, verifyCtsReplyWithSemanticChecks, type CtsVerifierContext } from '../policies/cts'

function activeProductFact(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: 'fact-golden-china',
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
    ...overrides,
  }
}

const KNOWLEDGE: KnowledgeReadResult = { entries: [activeProductFact()], forbiddenFactKeys: [] }
const BRAND_REDLINES = ['Auckland since 1928']

function baseContext(overrides: Partial<CtsVerifierContext> = {}): CtsVerifierContext {
  return {
    clientId: CTS_CLIENT_ID,
    agentOutput: {
      reply_text: 'Kia ora! The Golden China tour departs 2026-11-16 and costs $4999.',
      confidence: 0.9,
      offerings: [],
    },
    brandRedlinePhrases: BRAND_REDLINES,
    knowledge: KNOWLEDGE,
    ...overrides,
  }
}

describe.skipIf(!process.env.TYPESAFE_API_KEY)('CTS semantic verifier gates — live Jev regression cases', () => {
  it(
    'brand_redline_semantic: a paraphrase of the redline claim is caught',
    async () => {
      const result = await verifyCtsReplyWithSemanticChecks(
        baseContext({
          agentOutput: {
            reply_text:
              "We've been proudly running tours out of Auckland for nearly a century now, going all " +
              'the way back to the late 1920s!',
            confidence: 0.9,
            offerings: [],
          },
        }),
      )
      expect(result.checked_gate_ids).toContain('brand_redline_semantic')
      expect(result.ok).toBe(false)
      expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(true)
    },
    15000,
  )

  it(
    'brand_redline_semantic: an unrelated clean reply is not flagged',
    async () => {
      const result = await verifyCtsReplyWithSemanticChecks(baseContext())
      expect(result.checked_gate_ids).toContain('brand_redline_semantic')
      expect(result.blocked_reasons.some((r) => r.startsWith('brand_redline_semantic:'))).toBe(false)
    },
    15000,
  )

  it(
    'number_claim_semantic: a spelled-out price/date mismatch is caught',
    async () => {
      const result = await verifyCtsReplyWithSemanticChecks(
        baseContext({
          agentOutput: {
            reply_text:
              'The Golden China tour departs the sixteenth of December twenty twenty six and costs ' +
              'around six thousand New Zealand dollars.',
            confidence: 0.9,
            offerings: [],
          },
        }),
      )
      expect(result.checked_gate_ids).toContain('number_claim_semantic')
      expect(result.ok).toBe(false)
      expect(result.blocked_reasons.some((r) => r.startsWith('number_claim_semantic:'))).toBe(true)
    },
    15000,
  )

  it(
    'number_claim_semantic: a spelled-out price/date that matches the confirmed product is not flagged',
    async () => {
      const result = await verifyCtsReplyWithSemanticChecks(
        baseContext({
          agentOutput: {
            reply_text: 'The Golden China tour costs about five thousand New Zealand dollars.',
            confidence: 0.9,
            offerings: [],
          },
        }),
      )
      expect(result.checked_gate_ids).toContain('number_claim_semantic')
      expect(result.blocked_reasons.some((r) => r.startsWith('number_claim_semantic:'))).toBe(false)
    },
    15000,
  )
})

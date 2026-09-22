/**
 * Tests for brief trigger rules and the no-API-key fallback.
 *
 * shouldGenerateBrief is where the money leaks if it is wrong: without the quiet
 * period and the daily ceiling, a fast back-and-forth re-summarises on every
 * message. Each rule gets a test that fails if the rule is removed.
 */

import { describe, expect, it } from 'vitest'
import {
  shouldGenerateBrief,
  fallbackBrief,
  stripMarkdown,
  normaliseFollowUpDueAt,
  QUIET_PERIOD_MS,
  MAX_REGENS_PER_DAY,
  type BriefCandidate,
} from '../brief'

const NOW = new Date('2026-07-26T12:00:00.000Z')
const TODAY = '2026-07-26'

function candidate(over: Partial<BriefCandidate> = {}): BriefCandidate {
  return {
    conversationId: 'conv-1',
    clientId: 'c0000000-0000-0000-0000-000000000000',
    messageCount: 4,
    // Comfortably outside the quiet period.
    lastMessageAt: new Date(NOW.getTime() - QUIET_PERIOD_MS - 60_000).toISOString(),
    existingBriefMessageCount: null,
    regenCount: 0,
    regenCountDate: null,
    ...over,
  }
}

describe('shouldGenerateBrief', () => {
  it('generates for a settled thread with no brief yet', () => {
    expect(shouldGenerateBrief(candidate(), NOW)).toBe(true)
  })

  it('skips an empty thread', () => {
    expect(shouldGenerateBrief(candidate({ messageCount: 0 }), NOW)).toBe(false)
  })

  it('skips a thread with no last-message timestamp', () => {
    expect(shouldGenerateBrief(candidate({ lastMessageAt: null }), NOW)).toBe(false)
  })

  it('waits out the quiet period rather than summarising mid-exchange', () => {
    const stillTalking = candidate({
      lastMessageAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
    })
    expect(shouldGenerateBrief(stillTalking, NOW)).toBe(false)
  })

  it('generates the moment the quiet period is reached', () => {
    const exactly = candidate({
      lastMessageAt: new Date(NOW.getTime() - QUIET_PERIOD_MS).toISOString(),
    })
    expect(shouldGenerateBrief(exactly, NOW)).toBe(true)
  })

  it('skips when the brief already covers every message', () => {
    expect(shouldGenerateBrief(candidate({ existingBriefMessageCount: 4 }), NOW)).toBe(false)
  })

  it('regenerates when the thread has grown since the brief', () => {
    expect(shouldGenerateBrief(candidate({ existingBriefMessageCount: 3 }), NOW)).toBe(true)
  })

  it('stops at the daily ceiling', () => {
    const maxed = candidate({
      existingBriefMessageCount: 3,
      regenCount: MAX_REGENS_PER_DAY,
      regenCountDate: TODAY,
    })
    expect(shouldGenerateBrief(maxed, NOW)).toBe(false)
  })

  it('allows one more below the daily ceiling', () => {
    const under = candidate({
      existingBriefMessageCount: 3,
      regenCount: MAX_REGENS_PER_DAY - 1,
      regenCountDate: TODAY,
    })
    expect(shouldGenerateBrief(under, NOW)).toBe(true)
  })

  it('resets the ceiling on a new day', () => {
    const yesterdayMaxed = candidate({
      existingBriefMessageCount: 3,
      regenCount: MAX_REGENS_PER_DAY,
      regenCountDate: '2026-07-25',
    })
    expect(shouldGenerateBrief(yesterdayMaxed, NOW)).toBe(true)
  })

  /**
   * Issue #1647 §5: a knowledge-base read failure writes the brief with an
   * empty draft_reply and `knowledge_status='read_failed'`. Without this
   * carve-out, a quiet thread whose brief already "covers every message"
   * would never be retried — the card would sit with a permanently empty
   * draft_reply until a new customer message happened to arrive.
   */
  it('🔴 read_failed 状态即使没有新消息也要重试（否则永远卡在空 draft_reply）', () => {
    const stuck = candidate({ existingBriefMessageCount: 4, existingKnowledgeStatus: 'read_failed' })
    expect(shouldGenerateBrief(stuck, NOW)).toBe(true)
  })

  it('read_failed 重试仍然受每日上限约束', () => {
    const stuckButMaxed = candidate({
      existingBriefMessageCount: 4,
      existingKnowledgeStatus: 'read_failed',
      regenCount: MAX_REGENS_PER_DAY,
      regenCountDate: TODAY,
    })
    expect(shouldGenerateBrief(stuckButMaxed, NOW)).toBe(false)
  })

  it('正常状态（null）没有新消息时仍然跳过——只有 read_failed 才有这条例外', () => {
    expect(shouldGenerateBrief(candidate({ existingBriefMessageCount: 4, existingKnowledgeStatus: null }), NOW)).toBe(
      false,
    )
  })
})

describe('fallbackBrief', () => {
  const messages = [
    {
      direction: 'inbound' as const,
      senderName: 'Sarah',
      body: 'Is the Great Wall included?',
      sentAt: '2026-07-26T09:00:00Z',
    },
    {
      direction: 'outbound' as const,
      senderName: 'CTS',
      body: 'Yes it is.',
      sentAt: '2026-07-26T09:05:00Z',
    },
  ]

  it('never produces a draft the salesperson could send by accident', () => {
    expect(fallbackBrief(messages).draft_reply).toBe('')
  })

  it('flags itself so the card cannot be mistaken for a real summary', () => {
    const brief = fallbackBrief(messages)
    expect(brief.intent_level).toBe('unknown')
    expect(brief.risk_flags.join()).toContain('AI 摘要未生成')
  })

  it('counts only the customer messages', () => {
    expect(fallbackBrief(messages).summary).toContain('客户共发送 1 条消息')
  })

  it('leaves contact empty rather than guessing', () => {
    expect(fallbackBrief(messages).contact).toEqual({ phone: null, email: null })
  })
})

/**
 * Messenger renders markdown literally, and the source threads are full of it
 * (the Meta agent writes `**Best of China**`). Anything reaching a real customer
 * with visible asterisks is a defect, so this is belt-and-braces over the prompt.
 */
describe('stripMarkdown', () => {
  it('unwraps bold', () => {
    expect(stripMarkdown('our **Best of China** tour')).toBe('our Best of China tour')
  })

  it('unwraps italics and code', () => {
    expect(stripMarkdown('a *great* trip with `code`')).toBe('a great trip with code')
    expect(stripMarkdown('an _early_ start')).toBe('an early start')
  })

  it('leaves a lone asterisk and mid-word underscores alone', () => {
    expect(stripMarkdown('5 * 3 seats left')).toBe('5 * 3 seats left')
    expect(stripMarkdown('email best_of_china@example.com')).toBe(
      'email best_of_china@example.com',
    )
  })

  it('is a no-op on plain text', () => {
    const plain = 'Hi Kam, happy to send the full itinerary.'
    expect(stripMarkdown(plain)).toBe(plain)
  })
})

/**
 * follow_up_due_at lands in a TIMESTAMPTZ column. A model that answers with a
 * phrase does not merely look wrong — the INSERT throws and the salesperson
 * gets no card for that thread at all. One bad date must not cost the brief.
 */
describe('normaliseFollowUpDueAt', () => {
  it('keeps a real instant, normalised to ISO', () => {
    expect(normaliseFollowUpDueAt('2026-08-03T21:00:00Z')).toBe('2026-08-03T21:00:00.000Z')
  })

  it('accepts a bare date as that day at midnight UTC', () => {
    expect(normaliseFollowUpDueAt('2026-08-03')).toBe('2026-08-03T00:00:00.000Z')
  })

  it('drops a Chinese phrase instead of letting the whole brief fail to save', () => {
    expect(normaliseFollowUpDueAt('下周三')).toBeNull()
  })

  it('drops an English phrase', () => {
    expect(normaliseFollowUpDueAt('in 3 days')).toBeNull()
  })

  it('drops whitespace-only text', () => {
    expect(normaliseFollowUpDueAt('   ')).toBeNull()
  })

  it('passes null through', () => {
    expect(normaliseFollowUpDueAt(null)).toBeNull()
  })
})

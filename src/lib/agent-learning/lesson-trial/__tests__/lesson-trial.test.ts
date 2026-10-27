import { describe, expect, it } from 'vitest'
import { createFakeLedger } from '@/lib/agent-learning/budget/fake-ledger'
import { DEEPSEEK_FLASH_PRICE } from '@/lib/agent-learning/llm/deepseek-client'
import { isTrialEligible, trialSampleKind } from '../eligible'
import { buildTrialPrompts, parseSuggestions, runTrial, type TrialLlm } from '../run-trial'
import { trialStatus } from '../trial-budget'

const NOW = new Date('2026-10-28T01:00:00Z')
const GOOD = JSON.stringify({ suggestions: [{ title: '换素材', reason: '素材太久没换' }] })

function fakeLlm(opts: { in?: number; out?: number } = {}) {
  const calls: Array<{ user: string }> = []
  const llm: TrialLlm = {
    price: DEEPSEEK_FLASH_PRICE,
    completeJson: async (req) => {
      calls.push({ user: req.user })
      return { ok: true, value: { text: GOOD, inputTokens: opts.in ?? 1000, outputTokens: opts.out ?? 300, model: 'm' } }
    },
  }
  return { llm, calls }
}

const input = { lessonKey: 'expert-jon-loomer-abc', lesson: 'Rotate creatives every 7 days', rationale: null, kind: 'ad' as const }

describe('eligibility by key prefix', () => {
  it('allows jon-loomer / glenn-gabe candidates only', () => {
    const ev = { kind: 'expert_rss_candidate' }
    expect(isTrialEligible('expert-jon-loomer-1a2b', ev)).toBe(true)
    expect(isTrialEligible('expert-glenn-gabe-1a2b', ev)).toBe(true)
    expect(isTrialEligible('expert-common-thread-collective-1a2b', ev)).toBe(false)
    expect(isTrialEligible('some-other-key', ev)).toBe(false)
    expect(isTrialEligible('expert-jon-loomer-1a2b', { kind: 'other' })).toBe(false)
    expect(isTrialEligible('expert-jon-loomer-1a2b', null)).toBe(false)
  })
  it('maps source to sample kind', () => {
    expect(trialSampleKind('expert-jon-loomer-x')).toBe('ad')
    expect(trialSampleKind('expert-glenn-gabe-x')).toBe('seo')
    expect(trialSampleKind('expert-common-thread-collective-x')).toBeNull()
  })
})

describe('buildTrialPrompts', () => {
  it('the two prompts differ only by the lesson block', () => {
    const p = buildTrialPrompts('ad', 'Rotate creatives', 'because fatigue')
    expect(p.withLesson.system).toBe(p.without.system)
    expect(p.withLesson.user.startsWith(p.without.user)).toBe(true)
    expect(p.without.user).not.toContain('Rotate creatives')
    expect(p.withLesson.user).toContain('Rotate creatives')
  })
})

describe('parseSuggestions', () => {
  it('rejects malformed output as a whole', () => {
    expect(parseSuggestions('nope')).toBeNull()
    expect(parseSuggestions(JSON.stringify({ suggestions: [{ title: 'a' }] }))).toBeNull()
    expect(parseSuggestions(GOOD)).toHaveLength(1)
  })
})

describe('runTrial', () => {
  it('asks twice with inputs differing only by the lesson, and settles actual cost', async () => {
    const ledger = createFakeLedger()
    const { llm, calls } = fakeLlm()
    const res = await runTrial({ llm, ledger, now: NOW }, input)
    expect(res.ok).toBe(true)
    expect(calls).toHaveLength(2)
    const [a, b] = calls.map((c) => c.user).sort((x, y) => x.length - y.length)
    expect(b.startsWith(a)).toBe(true)
    const st = trialStatus(ledger, NOW)
    expect(st.trials).toBe(1)
    expect(st.spentUsd).toBeGreaterThan(0)
    expect(st.spentUsd).toBeLessThan(0.01)
  })

  it('refuses with zero model calls once the $1 daily cap is reached', async () => {
    const ledger = createFakeLedger()
    // 每次实际花 ~$0.5：两次后只剩不到最坏预留额度
    const { llm, calls } = fakeLlm({ in: 800_000, out: 200_000 })
    const first = await runTrial({ llm, ledger, now: NOW }, input)
    expect(first.ok).toBe(true)
    const before = calls.length
    let blocked = false
    for (let i = 0; i < 4 && !blocked; i++) {
      const r = await runTrial({ llm, ledger, now: NOW }, input)
      if (!r.ok && r.code === 'gate_blocked') blocked = true
    }
    expect(blocked).toBe(true)
    const callsAtBlock = calls.length
    const again = await runTrial({ llm, ledger, now: NOW }, input)
    expect(again.ok).toBe(false)
    expect(calls.length).toBe(callsAtBlock)
    expect(callsAtBlock).toBeGreaterThan(before - 1)
  })

  it('a new UTC day gets a fresh allowance', async () => {
    const ledger = createFakeLedger()
    const { llm } = fakeLlm({ in: 1_500_000, out: 100_000 })
    await runTrial({ llm, ledger, now: NOW }, input)
    const blocked = await runTrial({ llm, ledger, now: NOW }, input)
    expect(blocked.ok).toBe(false)
    const next = await runTrial({ llm, ledger, now: new Date('2026-10-29T01:00:00Z') }, input)
    expect(next.ok).toBe(true)
  })
})

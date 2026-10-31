import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEEPSEEK_FLASH_PRICE } from '@/lib/agent-learning/llm/deepseek-client'
import { autoJudgeLesson, buildJudgePrompt, parseJudge } from '../auto-judge'
import type { TrialSpendStore } from '../spend-store'

const SUG = JSON.stringify({ suggestions: [{ title: '建议', reason: '理由' }] })
const now = () => new Date('2026-10-28T01:00:00Z')

/** judgeBetter: 每次评判返回的 better，按调用顺序取；A/B 位置由提示词决定，这里直接回放 */
function fakeLlm(judgeReplies: string[], opts: { failJudge?: boolean } = {}) {
  let j = 0
  let calls = 0
  return {
    get calls() {
      return calls
    },
    price: DEEPSEEK_FLASH_PRICE,
    completeJson: async (req: { system: string }) => {
      calls += 1
      const isJudge = req.system.includes('评审')
      if (isJudge && opts.failJudge) return { ok: false as const, error: 'x', code: 'db_error' as const }
      const text = isJudge ? judgeReplies[j++ % judgeReplies.length] : SUG
      return { ok: true as const, value: { text, inputTokens: 1000, outputTokens: 200, model: 'm' } }
    },
  }
}

function memoryStore(cap = 1) {
  const state = { reserved: 0, spent: 0 }
  const store: TrialSpendStore = {
    reserve: async (_d, amount) => {
      if (state.reserved + state.spent + amount > cap) return { ok: true, value: { claimed: false } }
      state.reserved += amount
      return { ok: true, value: { claimed: true } }
    },
    settle: async (_d, reserved, actual) => {
      state.reserved -= reserved
      state.spent += actual
      return { ok: true, value: undefined }
    },
  }
  return { store, state }
}

const j = (better: string) => JSON.stringify({ better, confidence: 0.8, reason: '更具体' })

describe('parseJudge', () => {
  it('maps A/B back to with/without by position', () => {
    expect(parseJudge(j('A'), true)?.better).toBe('with')
    expect(parseJudge(j('A'), false)?.better).toBe('without')
    expect(parseJudge(j('same'), true)?.better).toBe('same')
  })
  it('rejects malformed output', () => {
    expect(parseJudge('nope', true)).toBeNull()
    expect(parseJudge(JSON.stringify({ better: 'C', confidence: 0.5, reason: 'x' }), true)).toBeNull()
    expect(parseJudge(JSON.stringify({ better: 'A', confidence: 2, reason: 'x' }), true)).toBeNull()
    expect(parseJudge(JSON.stringify({ better: 'A', confidence: 0.5, reason: ' ' }), true)).toBeNull()
  })
})

describe('buildJudgePrompt', () => {
  it('swaps positions between rounds', () => {
    const w = [{ title: '没经验', reason: 'r' }]
    const l = [{ title: '有经验', reason: 'r' }]
    const a = buildJudgePrompt('seo', w, l, true).user
    const b = buildJudgePrompt('seo', w, l, false).user
    expect(a.indexOf('有经验')).toBeLessThan(a.indexOf('没经验'))
    expect(b.indexOf('没经验')).toBeLessThan(b.indexOf('有经验'))
  })
})

describe('autoJudgeLesson', () => {
  const input = { sample: 'seo' as const, lesson: 'Show content in raw HTML' }

  it('adopts only when both rounds prefer the lesson version', async () => {
    // 第 1 轮 with 在 A，第 2 轮 with 在 B
    const llm = fakeLlm([j('A'), j('B')])
    const r = await autoJudgeLesson({ llm, store: memoryStore().store, now }, input)
    expect(r.ok && r.value.verdict).toBe('adopt')
  })

  it('rejects when the rounds disagree', async () => {
    const llm = fakeLlm([j('A'), j('A')])
    const r = await autoJudgeLesson({ llm, store: memoryStore().store, now }, input)
    expect(r.ok && r.value.verdict).toBe('reject')
  })

  it('rejects on a tie', async () => {
    const llm = fakeLlm([j('same'), j('same')])
    const r = await autoJudgeLesson({ llm, store: memoryStore().store, now }, input)
    expect(r.ok && r.value.verdict).toBe('reject')
  })

  it('makes zero model calls when the daily cap is used up', async () => {
    const llm = fakeLlm([j('A')])
    const r = await autoJudgeLesson({ llm, store: memoryStore(0.0001).store, now }, input)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.code).toBe('gate_blocked')
    expect(llm.calls).toBe(0)
  })

  it('judge calls count toward spend and stay within the reservation', async () => {
    const m = memoryStore()
    const llm = fakeLlm([j('A'), j('B')])
    await autoJudgeLesson({ llm, store: m.store, now }, input)
    expect(llm.calls).toBe(6)
    expect(m.state.reserved).toBe(0)
    expect(m.state.spent).toBeGreaterThan(0)
  })

  it('gives no verdict and keeps the hold when the judge call fails', async () => {
    const m = memoryStore()
    const r = await autoJudgeLesson({ llm: fakeLlm([], { failJudge: true }), store: m.store, now }, input)
    expect(r.ok).toBe(false)
    expect(m.state.reserved).toBeGreaterThan(0)
    expect(m.state.spent).toBe(0)
  })
})

describe('auto route never enables a lesson', () => {
  it('does not write is_active', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/admin/agent-learning/trial/auto/route.ts'), 'utf8')
    expect(src).not.toMatch(/is_active\s*:/)
    expect(src).not.toContain('/api/ad-engine/lessons')
    expect(src).toContain('guardGlobalAdmin')
  })
})

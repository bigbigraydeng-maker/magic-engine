import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEEPSEEK_FLASH_PRICE } from '@/lib/agent-learning/llm/deepseek-client'
import { trialSampleFor } from '../eligibility'
import { buildTrialPrompt, parseSuggestions, runTrial } from '../run-trial'
import { createRpcTrialStore, type RpcFn, type TrialSpendStore } from '../spend-store'

const OK_TEXT = JSON.stringify({ suggestions: [{ title: '建议一', reason: '理由一' }] })

function fakeLlm(opts: { fail?: boolean } = {}) {
  const calls: string[] = []
  return {
    calls,
    price: DEEPSEEK_FLASH_PRICE,
    completeJson: async (req: { user: string }) => {
      calls.push(req.user)
      if (opts.fail) return { ok: false as const, error: 'x', code: 'db_error' as const }
      return { ok: true as const, value: { text: OK_TEXT, inputTokens: 1000, outputTokens: 300, model: 'm' } }
    },
  }
}

/** 与 SQL 函数同语义的内存替身：检查与扣减之间没有 await */
function memoryStore(cap0 = 1) {
  const state = { reserved: 0, spent: 0, comparisons: 0, reserveCalls: 0 }
  const store: TrialSpendStore = {
    reserve: async (_d, amount, cap) => {
      state.reserveCalls += 1
      if (state.reserved + state.spent + amount > Math.min(cap, cap0)) return { ok: true, value: { claimed: false } }
      state.reserved += amount
      state.comparisons += 1
      return { ok: true, value: { claimed: true } }
    },
    settle: async (_d, reserved, actual) => {
      state.reserved = Math.max(state.reserved - reserved, 0)
      state.spent += actual
      return { ok: true, value: undefined }
    },
  }
  return { store, state }
}

const now = () => new Date('2026-10-28T01:00:00Z')

describe('trialSampleFor', () => {
  it('only the first-batch prefixes with the candidate evidence kind', () => {
    expect(trialSampleFor('expert-jon-loomer-abc', 'expert_rss_candidate')).toBe('ads')
    expect(trialSampleFor('expert-glenn-gabe-abc', 'expert_rss_candidate')).toBe('seo')
    expect(trialSampleFor('expert-common-thread-collective-abc', 'expert_rss_candidate')).toBeNull()
    expect(trialSampleFor('some-other-lesson', 'expert_rss_candidate')).toBeNull()
    expect(trialSampleFor('expert-jon-loomer-abc', 'other')).toBeNull()
  })
})

describe('buildTrialPrompt', () => {
  it('the two inputs differ only by the lesson block', () => {
    const without = buildTrialPrompt('seo', null)
    const withLesson = buildTrialPrompt('seo', 'Show content in raw HTML')
    expect(withLesson.system).toBe(without.system)
    expect(withLesson.user.startsWith(without.user)).toBe(true)
    expect(withLesson.user).toContain('Show content in raw HTML')
    expect(without.user).not.toContain('参考规则>\nShow')
  })
  it('uses only fictional sample data', () => {
    expect(buildTrialPrompt('ads', null).user).toContain('示例客户 A')
  })
})

describe('parseSuggestions', () => {
  it('rejects malformed output as a whole', () => {
    expect(parseSuggestions('nope')).toBeNull()
    expect(parseSuggestions(JSON.stringify({ suggestions: [{ title: 'a' }] }))).toBeNull()
    expect(parseSuggestions(OK_TEXT)).toHaveLength(1)
  })
})

describe('runTrial', () => {
  it('runs the model twice and returns side-by-side results, settling actual cost', async () => {
    const { store, state } = memoryStore()
    const llm = fakeLlm()
    const r = await runTrial({ llm, store, now }, { sample: 'seo', lesson: 'rule X' })
    expect(r.ok).toBe(true)
    expect(llm.calls).toHaveLength(2)
    expect(llm.calls.filter((u) => u.includes('rule X'))).toHaveLength(1)
    expect(state.reserved).toBe(0)
    expect(state.spent).toBeGreaterThan(0)
    expect(state.comparisons).toBe(1)
  })

  it('refuses with zero model calls once the daily cap is reached', async () => {
    const { store, state } = memoryStore()
    state.spent = 0.999
    const llm = fakeLlm()
    const r = await runTrial({ llm, store, now }, { sample: 'seo', lesson: 'rule X' })
    expect(r).toMatchObject({ ok: false, code: 'gate_blocked' })
    expect(llm.calls).toHaveLength(0)
  })

  it('parallel runs never exceed the cap', async () => {
    const { store, state } = memoryStore(0.01)
    const llm = fakeLlm()
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runTrial({ llm, store, now }, { sample: 'ads', lesson: 'r' })),
    )
    expect(state.reserved + state.spent).toBeLessThanOrEqual(0.01)
    expect(results.filter((r) => r.ok).length).toBeLessThan(10)
    expect(llm.calls.length).toBe(results.filter((r) => r.ok).length * 2)
  })

  it('keeps the reservation when the model fails (fail-closed)', async () => {
    const { store, state } = memoryStore()
    const r = await runTrial({ llm: fakeLlm({ fail: true }), store, now }, { sample: 'seo', lesson: 'r' })
    expect(r.ok).toBe(false)
    expect(state.reserved).toBeGreaterThan(0)
    expect(state.spent).toBe(0)
  })

  it('zero model calls when the ledger is unavailable', async () => {
    const broken: TrialSpendStore = {
      reserve: async () => {
        throw new Error('db down')
      },
      settle: async () => ({ ok: true, value: undefined }),
    }
    const llm = fakeLlm()
    const r = await runTrial({ llm, store: broken, now }, { sample: 'seo', lesson: 'r' })
    expect(r).toMatchObject({ ok: false, error: 'budget_ledger_unavailable' })
    expect(llm.calls).toHaveLength(0)
  })
})

describe('createRpcTrialStore', () => {
  it('maps SQL results strictly; unknown shapes mean unavailable', async () => {
    const mk = (data: unknown, error: { message: string } | null = null): RpcFn => async () => ({ data, error })
    expect(await createRpcTrialStore(mk({ ok: true, claimed: true })).reserve('2026-10-28', 0.01, 1)).toEqual({
      ok: true,
      value: { claimed: true },
    })
    expect(await createRpcTrialStore(mk({ ok: false, reason: 'cap_exceeded' })).reserve('d', 0.01, 1)).toEqual({
      ok: true,
      value: { claimed: false },
    })
    expect((await createRpcTrialStore(mk({ ok: true })).reserve('d', 0.01, 1)).ok).toBe(false)
    expect((await createRpcTrialStore(mk(null, { message: 'x' })).reserve('d', 0.01, 1)).ok).toBe(false)
    expect((await createRpcTrialStore(mk({ ok: false, reason: 'unknown_day' })).settle('d', 0.01, 0.01)).ok).toBe(false)
  })
})

describe('page component', () => {
  it('adopt never calls the enable endpoint or writes anything', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/ad-engine/_components/LessonTrial.tsx'), 'utf8')
    expect(src).not.toContain('/api/ad-engine/lessons')
    expect(src).not.toContain('PATCH')
    expect(src).not.toContain('is_active')
  })
})

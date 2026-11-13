/**
 * A Tune lesson is stored inactive, with evidence marked candidate.
 * Adopting it is the existing is_active flip. Only then can a prescription read it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { buildHuatuoGenerationPrompt } from '@/lib/huatuo/prompts'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { PrescriptionIntake } from '@/types/diagnostic'
import type { HuatuoLookupContext } from '@/lib/huatuo/types'
import { loadMemoryForClient } from '../service'
import { groupEngineLessons } from '../lesson-groups'
import { writeTuneCandidateLesson } from '../tune-candidate'
import type { MemoryContext } from '../types'

vi.mock('@/lib/auth/require-admin', () => ({
  guardGlobalAdmin: vi.fn(async () => null),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { PATCH } from '@/app/api/ad-engine/lessons/[key]/route'

let upserted: Record<string, unknown>[] = []

function fakeSupabase(): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === 'clients') {
        return { select: async () => ({ data: [], error: null }) }
      }
      if (table === 'contacts') {
        return {
          select: () => ({
            not: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
          }),
        }
      }
      return {
        upsert: async (row: Record<string, unknown>) => {
          upserted.push(row)
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient
}

const LESSON = '重定向组必须显式关掉自动放宽，否则名单形同虚设'

beforeEach(() => {
  upserted = []
  vi.mocked(guardGlobalAdmin).mockReset()
  vi.mocked(guardGlobalAdmin).mockResolvedValue(null)
  vi.mocked(supabaseAdmin.from).mockClear()
})

describe('writeTuneCandidateLesson', () => {
  it('writes the lesson inactive and marks evidence as a candidate', async () => {
    const result = await writeTuneCandidateLesson(fakeSupabase(), {
      lessonKey: 'tune-retarget-lock',
      scope: 'global',
      lesson: LESSON,
      rationale: '平台会自作主张扩量',
      confidence: 0.8,
      evidence: { source: 'weekly_review' },
    })
    expect(result).toEqual({ ok: true, lessonKey: 'tune-retarget-lock' })
    expect(upserted).toHaveLength(1)
    expect(upserted[0].is_active).toBe(false)
    expect(upserted[0].evidence).toEqual({ source: 'weekly_review', status: 'candidate' })
  })
})

describe('adopt flips is_active', () => {
  it('records adoption, then puts a stopped lesson in retired rather than pending', async () => {
    const store = mockLessonStore({ is_active: false, evidence: { status: 'candidate', source: 'review' } })
    const adopted = await changeLesson(true)
    expect(adopted.status).toBe(200)
    expect(store.updates[0]?.evidence).toEqual({ status: 'adopted', source: 'review' })
    expect(store.updates[0]?.lesson).toBeUndefined()

    const stopped = await changeLesson(false)
    expect(stopped.status).toBe(200)
    const groups = groupEngineLessons([store.row()], () => false)
    expect(groups.pending).toHaveLength(0)
    expect(groups.retired).toHaveLength(1)
  })

  it('retires an already active legacy candidate on the first stop', async () => {
    const store = mockLessonStore({ is_active: true, evidence: { kind: 'expert_rss_candidate' } })
    expect((await changeLesson(false)).status).toBe(200)
    expect(store.updates[0]?.evidence).toEqual({ kind: 'expert_rss_candidate', status: 'adopted' })
    expect(groupEngineLessons([store.row()], () => false).retired).toHaveLength(1)
  })

  it('returns a conflict when the lesson changed between read and update', async () => {
    const store = mockLessonStore({ is_active: false, evidence: { status: 'candidate' } }, true)
    const res = await changeLesson(true)
    expect(res.status).toBe(409)
    expect(store.filters).toContainEqual(['updated_at', '2026-10-28T00:00:00Z'])
    expect(store.filters).toContainEqual(['is_active', false])
  })

  it('refuses the switch when the person is not a global admin', async () => {
    vi.mocked(guardGlobalAdmin).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )
    const req = new NextRequest('http://localhost/api/ad-engine/lessons/tune-retarget-lock', {
      method: 'PATCH',
      body: JSON.stringify({ is_active: true }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ key: 'tune-retarget-lock' }) })
    expect(res.status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

function mockLessonStore(
  initial: { is_active: boolean; evidence: Record<string, unknown> },
  conflict = false,
) {
  let row = { lesson_key: 'tune-retarget-lock', updated_at: '2026-10-28T00:00:00Z', ...initial }
  const updates: Record<string, unknown>[] = []
  const filters: Array<[string, unknown]> = []
  vi.mocked(supabaseAdmin.from).mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    update: (patch: Record<string, unknown>) => {
      updates.push(patch)
      const chain = {
        eq: (field: string, value: unknown) => { filters.push([field, value]); return chain },
        is: (field: string, value: unknown) => { filters.push([field, value]); return chain },
        select: () => chain,
        maybeSingle: async () => {
          if (conflict) return { data: null, error: null }
          row = { ...row, ...patch } as typeof row
          return { data: { lesson_key: row.lesson_key, is_active: row.is_active }, error: null }
        },
      }
      return chain
    },
  }) as never)
  return { updates, filters, row: () => row }
}

async function changeLesson(isActive: boolean) {
  const req = new NextRequest('http://localhost/api/ad-engine/lessons/tune-retarget-lock', {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
    headers: { 'Content-Type': 'application/json' },
  })
  return PATCH(req, { params: Promise.resolve({ key: 'tune-retarget-lock' }) })
}

describe('an adopted lesson is read when the next prescription is generated', () => {
  it('only the active lesson is loaded, and that text is in the prescription prompt', async () => {
    const rows = [
      {
        lesson: LESSON,
        rationale: '平台会自作主张扩量',
        scope: 'global',
        industry: null,
        flywheel: 'ads',
        confidence: 0.8,
        confirmed_count: 1,
        contradicted_count: 0,
        is_active: true,
      },
      {
        lesson: '这条还没采纳，不该进处方',
        rationale: null,
        scope: 'global',
        industry: null,
        flywheel: 'ads',
        confidence: 0.9,
        confirmed_count: 1,
        contradicted_count: 0,
        is_active: false,
      },
    ]
    const memory = await loadMemoryForClient(filteringSupabase(rows), 'client-1')
    expect(memory.global_lessons?.map((row) => row.lesson)).toEqual([LESSON])

    const prompt = buildHuatuoGenerationPrompt(
      { domain: 'example.com.au', business: { name: 'Acme', industry: ['retail'] }, diagnosis: null } as unknown as DiscoveryReport,
      { business_goal: '多些咨询', timeline_urgency: 'normal', monthly_budget_aud: 1000, priority_dimensions: ['ads'] } as unknown as PrescriptionIntake,
      { benchmarks: {}, industry_category: 'retail', trend_summary: null } as unknown as HuatuoLookupContext,
      undefined,
      memory as MemoryContext,
    )
    expect(prompt).toContain(LESSON)
    expect(prompt).not.toContain('这条还没采纳')
  })

  it('a lessons-only memory bundle still reaches the prescription prompt', () => {
    const prompt = buildHuatuoGenerationPrompt(
      { domain: 'example.com.au', business: { name: 'Acme', industry: ['retail'] }, diagnosis: null } as unknown as DiscoveryReport,
      { business_goal: '多些咨询', timeline_urgency: 'normal', monthly_budget_aud: 1000, priority_dimensions: ['ads'] } as unknown as PrescriptionIntake,
      { benchmarks: {}, industry_category: 'retail', trend_summary: null } as unknown as HuatuoLookupContext,
      undefined,
      undefined,
      {
        memoryContext: {
          preferences: [],
          proven_patterns: [],
          failed_experiments: [],
          recent_decisions: [],
          has_content: false,
          global_lessons: [{
            lesson: LESSON,
            rationale: '平台会自作主张扩量',
            scope: 'global',
            industry: null,
            flywheel: 'ads',
            confidence: 0.8,
          }],
        },
        recentFeedback: [],
        lastPrescriptionOutcomes: [],
        has_content: false,
      },
      'long',
    )
    expect(prompt).toContain(LESSON)
    expect(prompt).toContain('Cross-Client Lessons')
  })
})

describe('ad engine groups', () => {
  it('puts candidates in 待采纳 and leaves retired rows separate', () => {
    const groups = groupEngineLessons([
      { lesson_key: 'on', is_active: true, evidence: { status: 'candidate' } },
      { lesson_key: 'wait', is_active: false, evidence: { status: 'candidate' } },
      { lesson_key: 'expert', is_active: false, evidence: { kind: 'expert_rss_candidate' } },
      { lesson_key: 'funnel', is_active: false, evidence: { kind: 'candidate', candidate: true } },
      { lesson_key: 'funnel-adopted', is_active: false, evidence: { kind: 'candidate', candidate: true, status: 'adopted' } },
      { lesson_key: 'try', is_active: false, evidence: { kind: 'expert_rss_candidate' } },
      { lesson_key: 'try-adopted', is_active: false, evidence: { kind: 'expert_rss_candidate', status: 'adopted' } },
      { lesson_key: 'off', is_active: false, evidence: null },
    ], (lesson) => lesson.lesson_key === 'try' || lesson.lesson_key === 'try-adopted')
    expect(groups.active.map((row) => row.lesson_key)).toEqual(['on'])
    expect(groups.pending.map((row) => row.lesson_key)).toEqual(['wait', 'expert', 'funnel'])
    expect(groups.trial.map((row) => row.lesson_key)).toEqual(['try'])
    expect(groups.retired.map((row) => row.lesson_key)).toEqual(['funnel-adopted', 'try-adopted', 'off'])
  })
})

function filteringSupabase(rows: Array<Record<string, unknown>>): SupabaseClient {
  const from = (table: string) => {
    const ops: Array<[string, unknown[]]> = []
    const builder: Record<string, unknown> = {}
    const chain = (method: string) => (...args: unknown[]) => {
      ops.push([method, args])
      return builder
    }
    for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'or', 'not']) {
      builder[method] = chain(method)
    }
    builder.maybeSingle = () => Promise.resolve({ data: { industry: null }, error: null })
    builder.then = (
      onFulfilled: (value: { data: unknown[]; error: null }) => unknown,
      onRejected?: (error: unknown) => unknown,
    ) => {
      const activeOnly = ops.some(([method, args]) => method === 'eq' && args[0] === 'is_active' && args[1] === true)
      const data = table === 'global_learned_lessons' && activeOnly
        ? rows.filter((row) => row.is_active === true)
        : []
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatMemoryForPrompt } from '@/lib/memory/format'
import { loadMemoryForClient } from '@/lib/memory/service'
import {
  PILOT_CLIENT_IDS_KEY,
  applyLessonAudience,
  evidenceWithAudience,
  lessonAudienceLabel,
  lessonVisibleToClient,
  readPilotClientIds,
  selectLessonsForClient,
  type AudienceLesson,
  type AudienceStore,
} from '@/lib/agent-learning/lesson-audience'

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function row(partial: {
  lesson_key: string
  lesson: string
  confidence?: number
  evidence?: unknown
  confirmed_count?: number
  contradicted_count?: number
}): AudienceLesson & {
  rationale: null
  scope: 'global'
  industry: null
  flywheel: 'cross'
} {
  return {
    rationale: null,
    scope: 'global',
    industry: null,
    flywheel: 'cross',
    confidence: partial.confidence ?? 0.8,
    confirmed_count: partial.confirmed_count ?? 1,
    contradicted_count: partial.contradicted_count ?? 0,
    evidence: partial.evidence ?? { kind: 'expert_rss_candidate' },
    lesson_key: partial.lesson_key,
    lesson: partial.lesson,
  }
}

const OPEN = row({ lesson_key: 'open-1', lesson: 'open to every client', confidence: 0.95 })
const PILOT = row({
  lesson_key: 'pilot-1',
  lesson: 'only the named client',
  confidence: 0.7,
  evidence: {
    kind: 'expert_rss_candidate',
    ai_verdict: { suggestion: 'adopt' },
    [PILOT_CLIENT_IDS_KEY]: [CLIENT_A.toUpperCase()],
  },
})
const BROKEN = row({
  lesson_key: 'broken-1',
  lesson: 'broken list matches nobody',
  evidence: { [PILOT_CLIENT_IDS_KEY]: 'everyone' },
})

function makeSupabase(lessons: unknown[], ops: string[]): SupabaseClient {
  const from = (table: string) => {
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'or', 'not']) {
      builder[method] = (...args: unknown[]) => {
        if (table === 'global_learned_lessons') ops.push(`${method}:${JSON.stringify(args)}`)
        return builder
      }
    }
    builder.maybeSingle = () => Promise.resolve({ data: { industry: null }, error: null })
    builder.then = (
      onFulfilled: (value: { data: unknown; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve({
      data: table === 'global_learned_lessons' ? lessons : [],
      error: null,
    }).then(onFulfilled, onRejected)
    return builder
  }
  return { from } as unknown as SupabaseClient
}

describe('lesson audience runtime filter', () => {
  it('shows a per-client lesson only to that client and leaves unrestricted lessons alone', async () => {
    const lessons = [OPEN, PILOT, BROKEN]
    const opsA: string[] = []
    const opsB: string[] = []
    const ctxA = await loadMemoryForClient(makeSupabase(lessons, opsA), CLIENT_A)
    const ctxB = await loadMemoryForClient(makeSupabase(lessons, opsB), CLIENT_B)

    expect(ctxA.global_lessons?.map((l) => l.lesson)).toEqual([
      'open to every client',
      'only the named client',
    ])
    expect(ctxB.global_lessons?.map((l) => l.lesson)).toEqual(['open to every client'])

    const promptA = formatMemoryForPrompt(ctxA)
    const promptB = formatMemoryForPrompt(ctxB)
    expect(promptA).toContain('only the named client')
    expect(promptA).not.toContain(CLIENT_A)
    expect(promptB).not.toContain('only the named client')
    expect(opsA.join('\n')).not.toContain(CLIENT_A)
    expect(opsB.join('\n')).not.toContain(CLIENT_B)
  })

  it('keeps a named lesson even when 25 other lessons outrank it', () => {
    const crowd = Array.from({ length: 26 }, (_, i) => row({
      lesson_key: `open-${i}`,
      lesson: `open ${i}`,
      confidence: 0.99,
    }))
    const named = row({
      lesson_key: 'pilot-low',
      lesson: 'still included',
      confidence: 0.6,
      evidence: { [PILOT_CLIENT_IDS_KEY]: [CLIENT_A] },
    })
    const forA = selectLessonsForClient([...crowd, named], CLIENT_A).map((l) => l.lesson)
    const forB = selectLessonsForClient([...crowd, named], CLIENT_B).map((l) => l.lesson)
    expect(forA).toContain('still included')
    expect(forA.filter((lesson) => lesson.startsWith('open'))).toHaveLength(25)
    expect(forB).not.toContain('still included')
    expect(forB).toHaveLength(25)
  })
})

describe('lesson audience write', () => {
  it('restricts to one client without dropping the existing evidence', () => {
    const next = evidenceWithAudience(
      { kind: 'expert_rss_candidate', ai_verdict: { suggestion: 'adopt' }, quote: 'keep' },
      'one',
      CLIENT_A,
    )
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.isActive).toBe(true)
    expect(next.evidence.kind).toBe('expert_rss_candidate')
    expect(next.evidence.ai_verdict).toEqual({ suggestion: 'adopt' })
    expect(next.evidence.quote).toBe('keep')
    expect(next.evidence[PILOT_CLIENT_IDS_KEY]).toEqual([CLIENT_A])
  })

  it('opening for everyone clears the list', () => {
    const next = evidenceWithAudience({ quote: 'keep', [PILOT_CLIENT_IDS_KEY]: [CLIENT_A] }, 'all')
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(next.isActive).toBe(true)
    expect(next.evidence.quote).toBe('keep')
    expect(PILOT_CLIENT_IDS_KEY in next.evidence).toBe(false)
    expect(lessonVisibleToClient(next.evidence, CLIENT_B)).toBe(true)
  })

  it('treats a missing list as unrestricted and a broken list as nobody', () => {
    expect(readPilotClientIds({ quote: 'x' })).toBeNull()
    expect(lessonVisibleToClient({ quote: 'x' }, CLIENT_B)).toBe(true)
    expect(lessonVisibleToClient(null, CLIENT_A)).toBe(true)
    expect(readPilotClientIds({ [PILOT_CLIENT_IDS_KEY]: [] })).toEqual([])
    expect(readPilotClientIds({ [PILOT_CLIENT_IDS_KEY]: [CLIENT_A, 'not-an-id'] })).toEqual([])
    expect(lessonVisibleToClient({ [PILOT_CLIENT_IDS_KEY]: [CLIENT_A, 'not-an-id'] }, CLIENT_A)).toBe(false)
  })

  it('does not write when the client or the lesson is missing', async () => {
    const writes: unknown[] = []
    const store: AudienceStore = {
      async readLesson(lessonKey) {
        return lessonKey === 'missing'
          ? { found: false, evidence: null }
          : { found: true, evidence: { quote: 'keep' } }
      },
      async clientExists(id) {
        return { exists: id === CLIENT_A }
      },
      async writeLesson(_key, isActive, evidence) {
        writes.push({ isActive, evidence })
        return {}
      },
    }

    const missingClient = await applyLessonAudience(store, { lessonKey: 'pilot-1', mode: 'one', clientId: CLIENT_B })
    const missingLesson = await applyLessonAudience(store, { lessonKey: 'missing', mode: 'one', clientId: CLIENT_A })
    const badId = await applyLessonAudience(store, { lessonKey: 'pilot-1', mode: 'one', clientId: 'cts' })
    expect(missingClient).toMatchObject({ ok: false, status: 404 })
    expect(missingLesson).toMatchObject({ ok: false, status: 404 })
    expect(badId).toMatchObject({ ok: false, status: 400 })
    expect(writes).toEqual([])

    const saved = await applyLessonAudience(store, { lessonKey: 'pilot-1', mode: 'one', clientId: CLIENT_A })
    expect(saved).toMatchObject({ ok: true, isActive: true, audience: 'one' })
    expect(writes).toEqual([{
      isActive: true,
      evidence: { quote: 'keep', [PILOT_CLIENT_IDS_KEY]: [CLIENT_A] },
    }])
  })

  it('labels a named lesson with the client name instead of every client', () => {
    expect(lessonAudienceLabel({ [PILOT_CLIENT_IDS_KEY]: [CLIENT_A] }, () => 'Sample Tours')).toBe('只给Sample Tours开着')
    expect(lessonAudienceLabel({ quote: 'x' }, () => 'Sample Tours')).toBeNull()
    expect(lessonAudienceLabel({ [PILOT_CLIENT_IDS_KEY]: ['nope'] }, () => 'Sample Tours')).toBe('这份名单读不出来，谁的助手都不会用')
  })
})

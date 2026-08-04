/**
 * Team Working Memory — 从录下来的东西里提炼教训和套路
 *
 * 花钱守则（每个窗口每次结束都会走一遍，一天几十次，不能乱花）：
 *   - 事件太少（一看就是没干什么的会话）直接跳过，不调 AI
 *   - 只调一次 Claude，同时要交接摘要 + 教训 + 套路
 *
 * 把关守则（PM 选了全自动入库，闸门全在机器这边）：
 *   - 没有硬证据的会话：**不许新建**教训，只允许给已有教训 +1 次确认
 *   - 套路更严：必须有「改动合进去了」或「测试跑通了」才允许新建
 *     （PM 纠正过我，只能证明我错过，不能证明这套步骤是对的）
 */

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { supabaseAdmin } from '@/lib/supabase'
import { assessEvidence, canCreateLesson, requiresApproval, type EvidenceVerdict } from './evidence'
import { DISTILL_SYSTEM_PROMPT, buildDistillUserPrompt } from './distill-prompt'
import type { SkillStep } from './types'

/** 少于这么多条事件的会话不值得调 AI */
const MIN_EVENTS_TO_DISTILL = 5

interface SessionRow {
  session_key: string
  project_key: string
  git_branch: string | null
  goal: string | null
  files_changed: string[]
  commit_shas: string[]
  tests_passed: boolean | null
  tests_failed: boolean | null
  user_corrections: number
  event_count: number
}

interface EventRow {
  seq: number
  kind: string
  tool_name: string | null
  summary: string
  target: string | null
  ok: boolean | null
}

interface DistillOutput {
  summary: string
  goal: string
  lessons: {
    lesson_key: string
    scope: 'project' | 'global'
    title: string
    lesson: string
    rationale?: string
  }[]
  skills: {
    skill_key: string
    scope: 'project' | 'global'
    name: string
    description: string
    preconditions?: string[]
    procedure: SkillStep[]
    success_criteria?: string[]
    stop_conditions?: string[]
  }[]
}

export interface DistillResult {
  session_key: string
  skipped?: string
  lessons_created: number
  lessons_confirmed: number
  skills_created: number
  cost_usd: number
}

export async function distillSession(sessionKey: string): Promise<DistillResult> {
  const empty = { session_key: sessionKey, lessons_created: 0, lessons_confirmed: 0, skills_created: 0, cost_usd: 0 }

  const session = await loadSession(sessionKey)
  if (!session) return { ...empty, skipped: '会话不存在' }
  if (session.event_count < MIN_EVENTS_TO_DISTILL) {
    await markDistilled(sessionKey)
    return { ...empty, skipped: `事件只有 ${session.event_count} 条，不值得调 AI` }
  }

  const events = await loadEvents(sessionKey)
  const verdict = await assessSessionEvidence(session, events)

  const call = await callClaudeChat({
    systemPrompt: DISTILL_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildDistillUserPrompt(session, events, verdict) }],
    maxOutputTokens: 3000,
  })
  const out = parseJsonResponse<DistillOutput>(call.text)

  await saveSummary(sessionKey, out)

  const lessonStats = await persistLessons(session, out, verdict)
  const skillsCreated = await persistSkills(session, out, verdict)
  await markDistilled(sessionKey)

  return {
    session_key: sessionKey,
    ...lessonStats,
    skills_created: skillsCreated,
    cost_usd: call.cost_usd,
  }
}

// ─── 证据 ──────────────────────────────────────────────────────────────────

async function assessSessionEvidence(
  session: SessionRow,
  events: EventRow[],
): Promise<EvidenceVerdict> {
  // 服务器没有 git，「合进 main 了」是本机 hook 下次开窗口时验证后回填的
  const mergedShas = events
    .filter((e) => e.kind === 'git' && e.target && e.summary.includes('已确认进入 main'))
    .map((e) => e.target as string)

  const { count } = await supabaseAdmin
    .from('work_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('project_key', session.project_key)
    .overlaps('files_changed', session.files_changed.length > 0 ? session.files_changed : ['__none__'])

  return assessEvidence({
    userCorrections: session.user_corrections,
    testsPassed: session.tests_passed === true && session.tests_failed !== true,
    mergedShas,
    observedInSessions: count ?? 1,
  })
}

// ─── 落库 ──────────────────────────────────────────────────────────────────

async function persistLessons(
  session: SessionRow,
  out: DistillOutput,
  verdict: EvidenceVerdict,
): Promise<{ lessons_created: number; lessons_confirmed: number }> {
  let created = 0
  let confirmed = 0

  for (const l of out.lessons ?? []) {
    const existing = await findLesson(l.lesson_key)

    if (existing) {
      // 已有教训：任何会话都可以给它 +1 次确认，不需要硬证据
      await confirmLesson(l.lesson_key)
      confirmed += 1
      continue
    }

    // 新教训：没有够硬的证据就不许进库。宁可漏，不可脏。
    // 注意用 canCreateLesson 而不是 verdict.primary —— multi_session 门槛太低，
    // 只配给已有教训 +1 次确认，不配开新条目。
    if (!canCreateLesson(verdict) || !verdict.primary) continue

    const { error } = await supabaseAdmin.from('team_lessons').insert({
      lesson_key: l.lesson_key,
      scope: l.scope,
      project_key: l.scope === 'project' ? session.project_key : null,
      title: l.title,
      lesson: l.lesson,
      rationale: l.rationale ?? null,
      evidence_kind: verdict.primary,
      evidence: {
        session_key: session.session_key,
        git_branch: session.git_branch,
        kinds: verdict.kinds,
        commit_shas: session.commit_shas,
      },
      confidence: verdict.confidence,
      source: 'auto_distill',
    })
    if (!error) created += 1
  }

  return { lessons_created: created, lessons_confirmed: confirmed }
}

/**
 * 套路比教训严一档：必须证明**这套步骤真的跑通了**。
 * 「PM 纠正过我」只能证明我错过，不能证明这套步骤对 —— 所以不算数。
 */
async function persistSkills(
  session: SessionRow,
  out: DistillOutput,
  verdict: EvidenceVerdict,
): Promise<number> {
  const proved = verdict.kinds.includes('merged') || verdict.kinds.includes('tests_passed')
  if (!proved) return 0

  let created = 0
  for (const s of out.skills ?? []) {
    const steps = s.procedure ?? []
    if (steps.length === 0) continue

    const { error } = await supabaseAdmin.from('team_skills').upsert(
      {
        skill_key: s.skill_key,
        scope: s.scope,
        project_key: s.scope === 'project' ? session.project_key : null,
        name: s.name,
        description: s.description,
        preconditions: s.preconditions ?? [],
        procedure: steps,
        success_criteria: s.success_criteria ?? [],
        stop_conditions: s.stop_conditions ?? [],
        // 自动上线的是说明书，不是执行权：花钱/对外/难撤回的步骤仍要 PM 显式 go
        requires_approval: requiresApproval(steps),
        source_session_keys: [session.session_key],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'skill_key' },
    )
    if (!error) created += 1
  }
  return created
}

// ─── 小工具 ────────────────────────────────────────────────────────────────

async function loadSession(sessionKey: string): Promise<SessionRow | null> {
  const { data } = await supabaseAdmin
    .from('work_sessions')
    .select(
      'session_key, project_key, git_branch, goal, files_changed, commit_shas, tests_passed, tests_failed, user_corrections, event_count',
    )
    .eq('session_key', sessionKey)
    .maybeSingle()
  return (data as SessionRow | null) ?? null
}

async function loadEvents(sessionKey: string): Promise<EventRow[]> {
  const { data } = await supabaseAdmin
    .from('work_events')
    .select('seq, kind, tool_name, summary, target, ok')
    .eq('session_key', sessionKey)
    .order('seq', { ascending: true })
    .limit(400)
  return (data as EventRow[] | null) ?? []
}

async function findLesson(lessonKey: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from('team_lessons')
    .select('id')
    .eq('lesson_key', lessonKey)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

async function confirmLesson(lessonKey: string): Promise<void> {
  await supabaseAdmin.rpc('increment_lesson_confirmation', { p_lesson_key: lessonKey })
}

async function saveSummary(sessionKey: string, out: DistillOutput): Promise<void> {
  await supabaseAdmin
    .from('work_sessions')
    .update({
      summary: out.summary ?? null,
      goal: out.goal ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('session_key', sessionKey)
}

async function markDistilled(sessionKey: string): Promise<void> {
  await supabaseAdmin
    .from('work_sessions')
    .update({ distilled_at: new Date().toISOString() })
    .eq('session_key', sessionKey)
}

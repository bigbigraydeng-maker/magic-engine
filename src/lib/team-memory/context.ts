/**
 * Team Working Memory — 新窗口开启时注入什么
 *
 * 这是整套系统会不会变成「第二张 9 条没人读的表」的胜负手。
 * 库里已经有过前车之鉴：global_learned_lessons 建了一个月只有 9 条、没人读。
 * 差别不在存，在**读** —— 所以这里做三件事：
 *   1. 只挑跟当前项目 + 当前这件活相关的，不全塞（塞多了 = 噪音 = 被忽略）
 *   2. 带上「什么时候确认过」，让读的人能判断新旧
 *   3. 顺带给上一个同项目会话的交接摘要，换窗口不用 PM 人工传「咒语」
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { ProjectKey, SessionContextPayload, TeamLesson, TeamSkill } from './types'

/** 一次最多注入几条教训。少而准 > 多而吵。 */
const MAX_LESSONS = 12
/** 其中至少保留几条「哪儿都提醒」的全局教训，避免被项目教训挤光 */
const MIN_GLOBAL_LESSONS = 3
const MAX_SKILLS = 8
/**
 * 每条教训注入时的字数上限。
 *
 * 实测（2026-08-02 首次跑通）：导进来的老记忆有几条正文上千字，
 * 12 条全文注入 = 每开一个窗口塞进去一大坨，又慢又吵 —— 正是
 * 「建了没人读」的另一种死法。注入的是**提醒**，不是全文；
 * 要看全文去 /dashboard/team-memory，或直接问库。
 */
const MAX_LESSON_CHARS = 180

type LessonRow = Pick<
  TeamLesson,
  'title' | 'lesson' | 'scope' | 'evidence_kind' | 'last_confirmed_at' | 'confidence' | 'source'
>

export async function buildSessionContext(
  projectKey: ProjectKey,
  goal: string | null,
): Promise<SessionContextPayload> {
  const [lessons, skills, handoff] = await Promise.all([
    selectLessons(projectKey, goal),
    selectSkills(projectKey),
    latestHandoff(projectKey),
  ])
  return { project_key: projectKey, lessons, skills, handoff }
}

async function selectLessons(
  projectKey: ProjectKey,
  goal: string | null,
): Promise<SessionContextPayload['lessons']> {
  const { data, error } = await supabaseAdmin
    .from('team_lessons')
    .select('title, lesson, scope, evidence_kind, last_confirmed_at, confidence, source, project_key')
    .eq('is_active', true)
    .or(`scope.eq.global,project_key.eq.${projectKey}`)
    .order('confidence', { ascending: false })
    .order('last_confirmed_at', { ascending: false })
    // 多取一些再按相关性重排，避免高置信但完全不相干的把名额占满
    .limit(MAX_LESSONS * 5)

  if (error || !data) return []

  const rows = data as (LessonRow & { project_key: string | null })[]
  const scored = rows
    .map((row) => ({ row, score: relevanceScore(row, goal) }))
    .sort((a, b) => b.score - a.score)

  const picked = takeWithGlobalFloor(scored.map((s) => s.row))
  return picked.map(({ title, lesson, scope, evidence_kind, last_confirmed_at, source }) => ({
    title,
    lesson: truncate(lesson),
    scope,
    evidence_kind,
    last_confirmed_at,
    source,
  }))
}

/** 按字数截断。中文按字符算就够准，不必按 token 精算。 */
function truncate(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= MAX_LESSON_CHARS ? t : `${t.slice(0, MAX_LESSON_CHARS)}…（全文见后台）`
}

/**
 * 相关性 = 置信度打底 + 跟当前这件活的词面重合加成。
 * 故意做得很轻：宁可略粗，也不要为了排序去跑一次 AI（每开窗口都跑就太贵了）。
 */
function relevanceScore(row: LessonRow, goal: string | null): number {
  const base = row.confidence
  if (!goal) return base

  const goalTokens = tokenize(goal)
  if (goalTokens.size === 0) return base

  const text = `${row.title} ${row.lesson}`.toLowerCase()
  let overlap = 0
  goalTokens.forEach((t) => {
    if (text.includes(t)) overlap += 1
  })
  return base + Math.min(overlap * 0.15, 0.6)
}

function tokenize(text: string): Set<string> {
  const ascii = text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 3)
  // 中文没有空格，按 2 字滑窗切，够用来做词面重合
  const cjk = text.match(/[一-龥]{2,}/g) ?? []
  const grams = cjk.flatMap((run) =>
    Array.from({ length: Math.max(run.length - 1, 0) }, (_, i) => run.slice(i, i + 2)),
  )
  return new Set([...ascii, ...grams])
}

/** 取前 N 条，但保证「哪儿都提醒」的全局教训不被项目教训挤光 */
function takeWithGlobalFloor(rows: LessonRow[]): LessonRow[] {
  const globals = rows.filter((r) => r.scope === 'global')
  const picked = rows.slice(0, MAX_LESSONS)
  const globalsIn = picked.filter((r) => r.scope === 'global').length
  if (globalsIn >= MIN_GLOBAL_LESSONS) return picked

  const need = Math.min(MIN_GLOBAL_LESSONS - globalsIn, globals.length)
  const missing = globals.filter((g) => !picked.includes(g)).slice(0, need)
  if (missing.length === 0) return picked
  // 从尾部让出名额给全局教训
  return [...picked.slice(0, MAX_LESSONS - missing.length), ...missing]
}

async function selectSkills(projectKey: ProjectKey): Promise<SessionContextPayload['skills']> {
  const { data, error } = await supabaseAdmin
    .from('team_skills')
    .select('skill_key, name, description, requires_approval')
    .eq('status', 'active')
    .or(`scope.eq.global,project_key.eq.${projectKey}`)
    .order('success_count', { ascending: false })
    .limit(MAX_SKILLS)

  if (error || !data) return []
  return data as Pick<TeamSkill, 'skill_key' | 'name' | 'description' | 'requires_approval'>[]
}

/** 上一个同项目、已结束的会话 —— 就是「咒语」的自动版 */
async function latestHandoff(projectKey: ProjectKey): Promise<SessionContextPayload['handoff']> {
  const { data, error } = await supabaseAdmin
    .from('work_sessions')
    .select('session_key, goal, git_branch, summary, ended_at')
    .eq('project_key', projectKey)
    .eq('status', 'ended')
    .not('summary', 'is', null)
    .order('ended_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as SessionContextPayload['handoff']
}

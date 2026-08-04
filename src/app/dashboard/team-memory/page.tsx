/**
 * 团队工作记忆 —— 后台总览页
 *
 * 三块：现在几个窗口在跑 / 已经攒下的教训 / 已经跑通的套路。
 * PM 平时不需要来这儿点任何东西（教训和套路都是全自动入库的），
 * 这页存在的意义是**出问题时能查**：某条离谱的教训是哪次会话来的、
 * 某个套路为什么被下架了。
 */

import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface SessionRow {
  session_key: string
  project_key: string
  git_branch: string | null
  goal: string | null
  summary: string | null
  status: string
  started_at: string
  ended_at: string | null
}

interface LessonRow {
  lesson_key: string
  scope: string
  project_key: string | null
  title: string
  lesson: string
  evidence_kind: string
  confidence: number
  confirmed_count: number
  contradicted_count: number
  source: string
  last_confirmed_at: string
}

interface SkillRow {
  skill_key: string
  name: string
  description: string
  scope: string
  project_key: string | null
  requires_approval: boolean
  status: string
  use_count: number
  success_count: number
  fail_count: number
  retired_reason: string | null
}

const EVIDENCE_LABEL: Record<string, string> = {
  user_correction: 'PM 当场纠正过',
  merged: '改动已合入 main',
  tests_passed: '测试跑通',
  multi_session: '多个会话重现',
}

async function loadData() {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const [sessions, lessons, skills] = await Promise.all([
    supabaseAdmin
      .from('work_sessions')
      .select('session_key, project_key, git_branch, goal, summary, status, started_at, ended_at')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(40),
    supabaseAdmin
      .from('team_lessons')
      .select(
        'lesson_key, scope, project_key, title, lesson, evidence_kind, confidence, confirmed_count, contradicted_count, source, last_confirmed_at',
      )
      .eq('is_active', true)
      .order('last_confirmed_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('team_skills')
      .select(
        'skill_key, name, description, scope, project_key, requires_approval, status, use_count, success_count, fail_count, retired_reason',
      )
      .order('status', { ascending: true })
      .order('success_count', { ascending: false })
      .limit(50),
  ])

  return {
    sessions: (sessions.data ?? []) as SessionRow[],
    lessons: (lessons.data ?? []) as LessonRow[],
    skills: (skills.data ?? []) as SkillRow[],
  }
}

export default async function TeamMemoryPage() {
  const { sessions, lessons, skills } = await loadData()
  const active = sessions.filter((s) => s.status === 'active')

  return (
    <div className="p-6 space-y-8 max-w-6xl">
      <header>
        <h1 className="text-2xl font-semibold">团队工作记忆</h1>
        <p className="text-sm text-gray-500 mt-1">
          每个 Claude Code 窗口干了什么自动记在这儿；踩过的坑和跑通的套路自动提炼出来，
          下一个窗口开工时自动带上。你不需要在这页点任何东西 —— 它是查问题用的。
        </p>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <Stat label="此刻在跑的窗口" value={active.length} />
        <Stat label="已攒下的教训" value={lessons.length} />
        <Stat label="可用套路" value={skills.filter((s) => s.status === 'active').length} />
      </section>

      <Section title="最近 48 小时的窗口" empty="还没有窗口上报过 —— 如果刚装上，开一个新窗口干点活就会出现。">
        {sessions.map((s) => (
          <div key={s.session_key} className="border-b border-gray-100 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={`px-2 py-0.5 rounded text-xs ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {s.status === 'active' ? '进行中' : '已结束'}
              </span>
              <span className="font-medium">{s.project_key}</span>
              {s.git_branch && <span className="text-gray-400 font-mono text-xs">{s.git_branch}</span>}
              <span className="text-gray-400 text-xs ml-auto">{s.started_at.slice(0, 16).replace('T', ' ')}</span>
            </div>
            {s.goal && <p className="text-sm text-gray-700 mt-1">{s.goal}</p>}
            {s.summary && <p className="text-xs text-gray-500 mt-1 whitespace-pre-wrap">{s.summary}</p>}
          </div>
        ))}
      </Section>

      <Section title="教训" empty="还没有教训入库。这是正常的 —— 只有拿到硬证据的会话才允许新建教训。">
        {lessons.map((l) => (
          <div key={l.lesson_key} className="border-b border-gray-100 py-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`px-2 py-0.5 rounded ${l.scope === 'global' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                {l.scope === 'global' ? '哪儿都提醒' : `只在 ${l.project_key}`}
              </span>
              <span className="text-gray-500">{EVIDENCE_LABEL[l.evidence_kind] ?? l.evidence_kind}</span>
              <span className="text-gray-400">确认 {l.confirmed_count} 次</span>
              {l.contradicted_count > 0 && (
                <span className="text-amber-600">被推翻 {l.contradicted_count} 次</span>
              )}
              {l.source === 'imported_memory' && <span className="text-gray-400">（老记忆导入）</span>}
            </div>
            <p className="text-sm font-medium mt-1">{l.title}</p>
            <p className="text-xs text-gray-600 mt-1 line-clamp-3 whitespace-pre-wrap">{l.lesson}</p>
          </div>
        ))}
      </Section>

      <Section title="套路" empty="还没有套路。套路要求比教训严：必须证明这套步骤真的跑通过（改动合入或测试通过）。">
        {skills.map((s) => (
          <div key={s.skill_key} className="border-b border-gray-100 py-3">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <code className="text-gray-700">{s.skill_key}</code>
              {s.status === 'retired' && (
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">已下架</span>
              )}
              {s.requires_approval && (
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">含需放行的步骤</span>
              )}
              <span className="text-gray-400 ml-auto">
                用过 {s.use_count} 次 · 成 {s.success_count} / 败 {s.fail_count}
              </span>
            </div>
            <p className="text-sm font-medium mt-1">{s.name}</p>
            <p className="text-xs text-gray-600 mt-1">{s.description}</p>
            {s.retired_reason && <p className="text-xs text-red-600 mt-1">{s.retired_reason}</p>}
          </div>
        ))}
      </Section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function Section({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <section>
      <h2 className="text-lg font-medium mb-2">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-gray-400">{empty}</p> : children}
    </section>
  )
}

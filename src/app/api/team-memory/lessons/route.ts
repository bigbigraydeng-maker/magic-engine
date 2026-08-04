/**
 * /api/team-memory/lessons
 *
 * GET  —— 看库里现在有哪些教训（后台页面用）
 * POST —— 批量写入。给两种用途：
 *          1. 把现有 130 条本地记忆一次性搬进来（scripts/team-memory/import-existing-memory.mjs）
 *          2. 以后要手工补一条时不用开 SQL
 *
 * 手工/导入进来的一律标 source，跟机器自动提炼的分得清 —— 出问题时能一眼看出来源。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkHookAuth } from '@/lib/team-memory/auth'
import type { EvidenceKind, LessonScope } from '@/lib/team-memory/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface LessonInput {
  lesson_key: string
  scope: LessonScope
  project_key?: string | null
  title: string
  lesson: string
  rationale?: string | null
  evidence_kind?: EvidenceKind
  evidence?: Record<string, unknown>
  confidence?: number
  source?: 'imported_memory' | 'manual'
}

const MAX_BATCH = 500

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = checkHookAuth(req.headers.get('authorization'))
  if (fail) return fail.response

  let body: { lessons?: LessonInput[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const lessons = (body.lessons ?? []).slice(0, MAX_BATCH)
  if (lessons.length === 0) {
    return NextResponse.json({ error: 'lessons 不能为空' }, { status: 400 })
  }

  const invalid = lessons.find(
    (l) => !l.lesson_key || !l.title || !l.lesson || (l.scope === 'project' && !l.project_key),
  )
  if (invalid) {
    return NextResponse.json(
      { error: `字段不全: ${invalid.lesson_key || '(无 key)'}`, hint: 'project 范围必须带 project_key' },
      { status: 400 },
    )
  }

  const rows = lessons.map((l) => ({
    lesson_key: l.lesson_key,
    scope: l.scope,
    project_key: l.scope === 'project' ? l.project_key : null,
    title: l.title,
    lesson: l.lesson,
    rationale: l.rationale ?? null,
    evidence_kind: l.evidence_kind ?? 'user_correction',
    evidence: l.evidence ?? {},
    confidence: l.confidence ?? 0.9,
    source: l.source ?? 'manual',
    updated_at: new Date().toISOString(),
  }))

  const { error, data } = await supabaseAdmin
    .from('team_lessons')
    .upsert(rows, { onConflict: 'lesson_key' })
    .select('lesson_key')

  if (error) {
    console.error('[team-memory/lessons] 写入失败:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ written: (data ?? []).length })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const fail = checkHookAuth(req.headers.get('authorization'))
  if (fail) return fail.response

  const project = req.nextUrl.searchParams.get('project')
  let query = supabaseAdmin
    .from('team_lessons')
    .select('lesson_key, scope, project_key, title, lesson, evidence_kind, confidence, confirmed_count, contradicted_count, is_active, source, last_confirmed_at')
    .order('last_confirmed_at', { ascending: false })
    .limit(300)

  if (project) query = query.or(`scope.eq.global,project_key.eq.${project}`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ lessons: data ?? [] })
}

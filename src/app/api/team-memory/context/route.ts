/**
 * POST /api/team-memory/context
 *
 * 新窗口开起来时，hook 调这个拿「开工前该知道的东西」：
 *   - 跟当前项目 + 当前这件活相关的教训（少而准，不全塞）
 *   - 可用的套路清单
 *   - 上一个同项目会话的交接摘要（「咒语」的自动版）
 *   - 需要本机帮忙验证的 commit（服务器没有 git）
 *
 * 这个接口也必须快 —— 它挂在 PM 开窗口的路径上。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { checkHookAuth } from '@/lib/team-memory/auth'
import { buildSessionContext } from '@/lib/team-memory/context'
import { isManagedProject } from '@/lib/team-memory/project-key'
import type { ProjectKey } from '@/lib/team-memory/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** 一次最多让本机验证几个 commit，别拖慢开窗口 */
const MAX_COMMITS_TO_VERIFY = 20

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = checkHookAuth(req.headers.get('authorization'))
  if (fail) return fail.response

  let body: { project_key?: ProjectKey; goal?: string | null }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const projectKey = body.project_key
  if (!projectKey || !isManagedProject(projectKey)) {
    return NextResponse.json({ lessons: [], skills: [], handoff: null, verify_commits: [] })
  }

  try {
    const [context, verifyCommits] = await Promise.all([
      buildSessionContext(projectKey, body.goal ?? null),
      pendingCommitsToVerify(projectKey),
    ])
    return NextResponse.json({ ...context, verify_commits: verifyCommits })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[team-memory/context] 取上下文失败:', msg)
    // 取不到就返回空，绝不阻塞 PM 开窗口干活
    return NextResponse.json({ lessons: [], skills: [], handoff: null, verify_commits: [], error: msg })
  }
}

/**
 * 找出还没确认「是否进了 main」的 commit，交给本机 hook 去查。
 * 这是「改动真的合进去了」这条硬证据的唯一来源 —— 服务器没有 git。
 */
async function pendingCommitsToVerify(
  projectKey: ProjectKey,
): Promise<{ session_key: string; sha: string }[]> {
  const { data } = await supabaseAdmin
    .from('work_sessions')
    .select('session_key, commit_shas')
    .eq('project_key', projectKey)
    .eq('status', 'ended')
    .order('ended_at', { ascending: false })
    .limit(30)

  if (!data) return []

  // 空数组的过滤放在这边做：PostgREST 对 array != '{}' 的写法各版本不一致，
  // 与其赌一个可能静默失效的查询条件，不如多取几行在这里筛。
  const rows = (data as { session_key: string; commit_shas: string[] }[]).filter(
    (r) => (r.commit_shas ?? []).length > 0,
  )
  const confirmed = await confirmedShas(rows.map((r) => r.session_key))

  const out: { session_key: string; sha: string }[] = []
  for (const row of rows) {
    for (const sha of row.commit_shas) {
      if (confirmed.has(sha)) continue
      out.push({ session_key: row.session_key, sha })
      if (out.length >= MAX_COMMITS_TO_VERIFY) return out
    }
  }
  return out
}

async function confirmedShas(sessionKeys: string[]): Promise<Set<string>> {
  if (sessionKeys.length === 0) return new Set()
  const { data } = await supabaseAdmin
    .from('work_events')
    .select('target')
    .in('session_key', sessionKeys)
    .eq('kind', 'git')
    .like('summary', '%已确认进入 main%')

  return new Set(((data as { target: string | null }[] | null) ?? []).map((r) => r.target ?? ''))
}

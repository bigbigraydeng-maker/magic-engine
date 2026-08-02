/**
 * POST /api/team-memory/ingest
 *
 * 本机 hook 在会话结束（或中途冲刷）时把攒下的事件推上来。
 *
 * 设计要点：这个接口必须**快**。它挂在 PM 关窗口的路径上，
 * 慢一秒 PM 就会觉得 Claude Code 卡了。所以这里只落库，不调 AI；
 * 提炼由 hook 另外发一个不等结果的请求触发，cron 兜底。
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkHookAuth } from '@/lib/team-memory/auth'
import { ingestSession, applyCommitVerdicts } from '@/lib/team-memory/ingest'
import { isManagedProject } from '@/lib/team-memory/project-key'
import type { SessionIngestInput } from '@/lib/team-memory/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface IngestBody extends SessionIngestInput {
  /** 本机 git 验证过的 commit 是否已进 main（服务器没有 git，只能靠本机报） */
  commit_verdicts?: { session_key: string; sha: string; in_main: boolean }[]
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = checkHookAuth(req.headers.get('authorization'))
  if (fail) return fail.response

  let body: IngestBody
  try {
    body = (await req.json()) as IngestBody
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  if (!body.session_key || !body.project_key) {
    return NextResponse.json(
      { error: 'session_key 和 project_key 必填' },
      { status: 400 },
    )
  }

  // 受管范围外的窗口（私人项目、临时目录）一律不收 —— PM 拍板只管 4 个项目
  if (!isManagedProject(body.project_key)) {
    return NextResponse.json({ skipped: '不在受管项目范围内' }, { status: 200 })
  }

  try {
    const result = await ingestSession(body)
    const verdictsApplied = body.commit_verdicts?.length
      ? await applyCommitVerdicts(body.commit_verdicts)
      : 0

    return NextResponse.json({ ...result, commit_verdicts_applied: verdictsApplied })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[team-memory/ingest] 落库失败:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

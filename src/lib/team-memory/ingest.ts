/**
 * Team Working Memory — 上报落库
 *
 * hook 在本机把事件攒在一个本地文件里，会话结束时一次性推上来（见
 * scripts/team-memory/record-event.mjs 的注释：每个工具调用都发一次 HTTP
 * 会拖慢干活，所以攒着走）。
 *
 * 幂等：session 按 session_key upsert，事件按 (session_key, seq) upsert，
 * 所以 hook 重试、或同一会话分多次推，都不会写重。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { redact } from './redact'
import type { SessionIngestInput, WorkEventInput } from './types'

/** 单次请求最多收多少条事件，防止一个跑疯的会话刷爆库 */
const MAX_EVENTS_PER_REQUEST = 800

export interface IngestResult {
  session_key: string
  events_written: number
  events_dropped: number
  /** 服务端二次脱敏命中的规则名，留痕用 */
  redaction_hits: string[]
}

export async function ingestSession(input: SessionIngestInput): Promise<IngestResult> {
  const redactionHits = new Set<string>()

  await upsertSession(input, redactionHits)

  const events = (input.events ?? []).slice(0, MAX_EVENTS_PER_REQUEST)
  const dropped = Math.max((input.events?.length ?? 0) - events.length, 0)
  const written = await upsertEvents(input.session_key, events, redactionHits)

  if (written > 0) await bumpEventCount(input.session_key)

  return {
    session_key: input.session_key,
    events_written: written,
    events_dropped: dropped,
    // Array.from 而不是展开：本仓 tsconfig 的 target 低于 es2015，展开 Set 编译不过
    redaction_hits: Array.from(redactionHits),
  }
}

async function upsertSession(
  input: SessionIngestInput,
  hits: Set<string>,
): Promise<void> {
  const goal = redact(input.goal)
  goal.hits.forEach((h) => hits.add(h))

  const row = {
    session_key: input.session_key,
    project_key: input.project_key,
    cwd: input.cwd ?? null,
    git_branch: input.git_branch ?? null,
    git_head: input.git_head ?? null,
    goal: goal.text || null,
    status: input.status ?? 'active',
    files_changed: input.files_changed ?? [],
    commit_shas: input.commit_shas ?? [],
    pr_number: input.pr_number ?? null,
    commands_run: input.commands_run ?? 0,
    tests_passed: input.tests_passed ?? null,
    tests_failed: input.tests_failed ?? null,
    user_corrections: input.user_corrections ?? 0,
    started_at: input.started_at ?? new Date().toISOString(),
    ended_at: input.ended_at ?? null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabaseAdmin
    .from('work_sessions')
    .upsert(row, { onConflict: 'session_key' })

  if (error) throw new Error(`work_sessions upsert 失败: ${error.message}`)
}

async function upsertEvents(
  sessionKey: string,
  events: WorkEventInput[],
  hits: Set<string>,
): Promise<number> {
  if (events.length === 0) return 0

  const rows = events.map((e) => {
    const summary = redact(e.summary)
    const target = redact(e.target)
    summary.hits.forEach((h) => hits.add(h))
    target.hits.forEach((h) => hits.add(h))
    return {
      session_key: sessionKey,
      seq: e.seq,
      kind: e.kind,
      tool_name: e.tool_name ?? null,
      summary: summary.text || '(空)',
      target: target.text || null,
      ok: e.ok ?? null,
      occurred_at: e.occurred_at ?? new Date().toISOString(),
    }
  })

  const { error } = await supabaseAdmin
    .from('work_events')
    .upsert(rows, { onConflict: 'session_key,seq' })

  if (error) throw new Error(`work_events upsert 失败: ${error.message}`)
  return rows.length
}

async function bumpEventCount(sessionKey: string): Promise<void> {
  const { count } = await supabaseAdmin
    .from('work_events')
    .select('id', { count: 'exact', head: true })
    .eq('session_key', sessionKey)

  if (count === null) return
  await supabaseAdmin
    .from('work_sessions')
    .update({ event_count: count, updated_at: new Date().toISOString() })
    .eq('session_key', sessionKey)
}

/**
 * 把 hook 在下一次开窗口时验证过的 commit 结论回填。
 * 服务器没有 git，判断「改动真的合进 main 了」只能靠本机 hook 去查再报回来。
 */
export async function applyCommitVerdicts(
  verdicts: { session_key: string; sha: string; in_main: boolean }[],
): Promise<number> {
  const merged = verdicts.filter((v) => v.in_main)
  if (merged.length === 0) return 0

  const bySession = new Map<string, string[]>()
  for (const v of merged) {
    bySession.set(v.session_key, [...(bySession.get(v.session_key) ?? []), v.sha])
  }

  let updated = 0
  for (const [sessionKey, shas] of Array.from(bySession.entries())) {
    const { error } = await supabaseAdmin
      .from('work_events')
      .upsert(
        shas.map((sha: string, i: number) => ({
          session_key: sessionKey,
          // 负 seq 段专给回填事件用，绝不会跟正常事件流撞号
          seq: -1000 - i,
          kind: 'git' as const,
          tool_name: null,
          summary: `commit ${sha} 已确认进入 main`,
          target: sha,
          ok: true,
        })),
        { onConflict: 'session_key,seq' },
      )
    if (!error) updated += shas.length
  }
  return updated
}

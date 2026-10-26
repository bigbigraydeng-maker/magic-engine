/**
 * 真实依赖：把 run-audit 需要的读取接到生产数据源。
 * 全部只读——日历（GET）、cron_run_logs（select）、clients（select）、台账目录（读文件）。
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { readCalendarEvents } from './calendar-client'
import { buildLedgerView } from './ledger-view'
import type { CommentRunSnapshot, CronRunRow } from './probes'
import type { AuditDeps } from './run-audit'
import type { CommentRunResult } from '@/lib/pm-todo/comment-scope-items'
import { fetchCommentReplyScopeTodos } from '@/lib/pm-todo/comment-reply-scope-items'

const COMMENT_JOB = 'social-comment-autoreply'

function isCommentResult(x: unknown): x is CommentRunResult {
  return typeof x === 'object' && x !== null && typeof (x as { client_id?: unknown }).client_id === 'string'
}

export function createLiveAuditDeps(supabase: SupabaseClient, now: () => Date = () => new Date()): AuditDeps {
  return {
    now,
    readEvents: (todayNz) => readCalendarEvents({ todayNz }),
    buildLedgerView: (todayNz) => buildLedgerView(todayNz),
    newRequestId: () => randomUUID(),
    probeDeps: {
      now,
      allowedJobs: new Set(CRON_REGISTRY.map((e) => e.jobName)),
      loadCronRuns: async (job, sinceIso): Promise<CronRunRow[]> => {
        const { data, error } = await supabase
          .from('cron_run_logs')
          .select('status, started_at')
          .eq('job_name', job)
          .gte('started_at', sinceIso)
        if (error) throw new Error(error.message)
        return (data ?? []) as CronRunRow[]
      },
      loadCommentRun: async (): Promise<CommentRunSnapshot | null> => {
        const { data, error } = await supabase
          .from('cron_run_logs')
          .select('finished_at, summary')
          .eq('job_name', COMMENT_JOB)
          .order('started_at', { ascending: false })
          .limit(1)
        if (error) throw new Error(error.message)
        const row = (data ?? [])[0] as { finished_at: string | null; summary: { results?: unknown } | null } | undefined
        if (!row) return null
        const raw = row.summary?.results
        return { finished_at: row.finished_at, results: Array.isArray(raw) ? raw.filter(isCommentResult) : [] }
      },
      loadReplyScopeTodos: async () => fetchCommentReplyScopeTodos(supabase, now()),
      clientExists: async (clientId): Promise<boolean> => {
        const { data, error } = await supabase.from('clients').select('id').eq('id', clientId).limit(1)
        if (error) throw new Error(error.message)
        return (data ?? []).length > 0
      },
    },
  }
}

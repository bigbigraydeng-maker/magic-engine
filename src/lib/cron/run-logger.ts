import { supabaseAdmin } from '@/lib/supabase'

export interface CronRunHandle {
  finish(opts: {
    processed?: number
    completed?: number
    failed?: number
    summary?: Record<string, unknown>
    error?: string
  }): Promise<void>
}

export async function startCronRun(jobName: string): Promise<CronRunHandle> {
  const startedAt = Date.now()

  const { data } = await supabaseAdmin
    .from('cron_run_logs')
    .insert({ job_name: jobName, status: 'running' })
    .select('id')
    .single()

  const runId: string | null = data?.id ?? null

  return {
    async finish({ processed = 0, completed = 0, failed = 0, summary, error }) {
      if (!runId) return
      const durationMs = Date.now() - startedAt
      await supabaseAdmin
        .from('cron_run_logs')
        .update({
          status: error ? 'failed' : 'completed',
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          processed,
          completed_count: completed,
          failed_count: failed,
          summary: summary ?? null,
          error_message: error ?? null,
        })
        .eq('id', runId)
    },
  }
}

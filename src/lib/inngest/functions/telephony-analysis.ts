/**
 * 通话录音 → 转写 → 分析（待复核）的云端任务。
 *
 * 触发：①通话处理时发现有录音（事件 telephony.call.recording.ready，由补处理任务发出）；
 *       ②每 10 分钟扫一遍「有录音但还没分析完」的通话并重发（失败有次数上限，超限停手并保持可见的 failed 状态）。
 * 受连接上的 analysis_enabled 开关控制，默认关。不发布、不外发、不改联系人。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { runCallAnalysis, MAX_STEP_ATTEMPTS } from '@/lib/telephony/transcribe/pipeline'
import { supabaseAnalysisStore } from '@/lib/telephony/transcribe/store'
import { openaiAnalyzer, openaiTranscriber } from '@/lib/telephony/transcribe/vendors'

export const TELEPHONY_RECORDING_READY = 'telephony.call.recording.ready' as const

export const telephonyCallAnalysis = inngest.createFunction(
  {
    id: `${CLOUD_FN_PREFIX}telephony-call-analysis`,
    name: 'Telephony — recording → transcript → analysis (pending review)',
    retries: 2,
    concurrency: { key: 'event.data.call_id', limit: 1 },
  },
  { event: TELEPHONY_RECORDING_READY },
  async ({ event, step }) => {
    const d = event.data as Record<string, unknown>
    const ref = { clientId: String(d.client_id ?? ''), provider: String(d.provider ?? ''), providerCallId: String(d.call_id ?? '') }
    if (!ref.clientId || !ref.provider || !ref.providerCallId) return { status: 'invalid_payload' as const }
    return step.run('analyse-call', () =>
      runCallAnalysis({ store: supabaseAnalysisStore, transcribe: openaiTranscriber, analyze: openaiAnalyzer, env: (n) => process.env[n] }, ref),
    )
  },
)

/** 每 10 分钟：把「有录音、分析没做完、次数没超限」的通话重新发出去。 */
export const telephonyCallAnalysisSweep = inngest.createFunction(
  { id: `${CLOUD_FN_PREFIX}telephony-call-analysis-sweep`, name: 'Telephony — analysis sweep', retries: 1, concurrency: { limit: 1 } },
  { cron: '*/10 * * * *' },
  async ({ step }) =>
    step.run('sweep', async () => {
      // 只扫「允许分析」的连接（默认全关，关着的不重发、不空转）。
      const { data: enabled } = await supabaseAdmin.from('telephony_connections').select('id').eq('analysis_enabled', true).eq('active', true)
      const ids = (enabled ?? []).map((c) => c.id as string)
      if (ids.length === 0) return { dispatched: 0 }
      const { data, error } = await supabaseAdmin
        .from('telephony_calls')
        .select('client_id, provider, provider_call_id, recording_attempts, analysis_attempts, connection_id')
        .in('recording_status', ['pending_download', 'downloaded', 'failed'])
        .in('connection_id', ids)
        .neq('summary_status', 'done')
        .lt('started_at', new Date(Date.now() - 3 * 60_000).toISOString())
        .limit(30)
      if (error) throw new Error(`读待分析通话失败: ${error.message}`)
      const rows = (data ?? []).filter((r) => (r.recording_attempts ?? 0) < MAX_STEP_ATTEMPTS && (r.analysis_attempts ?? 0) < MAX_STEP_ATTEMPTS)
      for (const r of rows) {
        await inngest.send({
          name: TELEPHONY_RECORDING_READY,
          data: { client_id: r.client_id, provider: r.provider, call_id: r.provider_call_id },
        })
      }
      return { dispatched: rows.length }
    }),
)

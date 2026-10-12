/**
 * 通话录音 → 转写 → 分析（待复核）的云端任务。
 *
 * 触发：只有每 10 分钟的补扫发事件 telephony.call.recording.ready（扫「有录音、没分析完、次数没超限」的通话）。
 *       所以录音完成后最长约 13 分钟才会处理——这是已知取舍，不是遗漏。
 * 受连接上的 analysis_enabled 开关控制，默认关。不发布、不外发、不改联系人。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { runCallAnalysis, MAX_STEP_ATTEMPTS } from '@/lib/telephony/transcribe/pipeline'
import { supabaseAnalysisStore } from '@/lib/telephony/transcribe/store'
import { deepseekAnalyzer, twilioTranscriber } from '@/lib/telephony/transcribe/vendors'

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
      runCallAnalysis({ store: supabaseAnalysisStore, transcribe: twilioTranscriber, analyze: deepseekAnalyzer, env: (n) => process.env[n] }, ref),
    )
  },
)

export interface SweepCandidate { client_id: string; provider: string; provider_call_id: string }
export interface SweepDeps {
  listEnabledConnections(): Promise<Array<{ id: string; analysis_enabled_at: string | null }>>
  /** 某连接在 since 之后、次数没超限、还没分析完的通话（按开始时间升序，最多 limit 条）。 */
  listCalls(connectionId: string, since: string, limit: number): Promise<SweepCandidate[]>
}
export const SWEEP_PER_CONNECTION = 10

/** 逐个连接各查各的（各用各自的开启时刻）：别的连接的老通话不会挤占名额，开启之前的通话永远不会被选中。 */
export async function planAnalysisSweep(deps: SweepDeps): Promise<SweepCandidate[]> {
  const out: SweepCandidate[] = []
  for (const c of await deps.listEnabledConnections()) {
    if (!c.analysis_enabled_at) continue
    out.push(...(await deps.listCalls(c.id, c.analysis_enabled_at, SWEEP_PER_CONNECTION)))
  }
  return out
}

const supabaseSweepDeps: SweepDeps = {
  async listEnabledConnections() {
    const { data } = await supabaseAdmin.from('telephony_connections').select('id, analysis_enabled_at').eq('analysis_enabled', true).eq('active', true).eq('provider', 'twilio')
    return (data ?? []) as Array<{ id: string; analysis_enabled_at: string | null }>
  },
  async listCalls(connectionId, since, limit) {
    const { data, error } = await supabaseAdmin
      .from('telephony_calls')
      .select('client_id, provider, provider_call_id')
      .eq('connection_id', connectionId)
      .eq('provider', 'twilio')
      .gte('started_at', since)
      .lt('started_at', new Date(Date.now() - 3 * 60_000).toISOString())
      .in('recording_status', ['pending_download', 'downloaded', 'failed'])
      .lt('recording_attempts', MAX_STEP_ATTEMPTS)
      .lt('transcript_attempts', MAX_STEP_ATTEMPTS)
      .lt('analysis_attempts', MAX_STEP_ATTEMPTS)
      .neq('summary_status', 'done')
      .order('started_at', { ascending: true })
      .limit(limit)
    if (error) throw new Error(`读待分析通话失败: ${error.message}`)
    return (data ?? []) as SweepCandidate[]
  },
}

/** 每 10 分钟：把「有录音、分析没做完、次数没超限」的通话重新发出去。 */
export const telephonyCallAnalysisSweep = inngest.createFunction(
  { id: `${CLOUD_FN_PREFIX}telephony-call-analysis-sweep`, name: 'Telephony — analysis sweep', retries: 1, concurrency: { limit: 1 } },
  { cron: '*/10 * * * *' },
  async ({ step }) =>
    step.run('sweep', async () => {
      const rows = await planAnalysisSweep(supabaseSweepDeps)
      const bucket = Math.floor(Date.now() / 600_000)
      for (const r of rows) {
        await inngest.send({ id: `analysis:${r.provider_call_id}:${bucket}`, name: TELEPHONY_RECORDING_READY, data: { client_id: r.client_id, provider: r.provider, call_id: r.provider_call_id } })
      }
      return { dispatched: rows.length }
    }),
)

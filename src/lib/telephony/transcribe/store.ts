/** 分析流水线的 Supabase 存储实现。所有读写都带 client_id；录音放私有桶 telephony-recordings。 */

import { supabaseAdmin } from '@/lib/supabase'
import { ANALYSIS_SCHEMA_VERSION } from './analysis-schema'
import type { AnalysisCall, AnalysisConnection, AnalysisStore } from './pipeline'

const BUCKET = 'telephony-recordings'

export const supabaseAnalysisStore: AnalysisStore = {
  async getCall(clientId, provider, providerCallId) {
    const { data, error } = await supabaseAdmin
      .from('telephony_calls')
      .select('id, client_id, connection_id, provider, provider_call_id, started_at, recording_status, transcript_status, summary_status, recording_raw_event_id, recording_storage_path, recording_attempts, analysis_attempts, touchpoint_id')
      .eq('client_id', clientId)
      .eq('provider', provider)
      .eq('provider_call_id', providerCallId)
      .maybeSingle()
    if (error) throw new Error(`读通话失败: ${error.message}`)
    if (!data) return null
    return {
      id: data.id, clientId: data.client_id, connectionId: data.connection_id, provider: data.provider,
      providerCallId: data.provider_call_id, startedAt: data.started_at,
      recordingStatus: data.recording_status, transcriptStatus: data.transcript_status, summaryStatus: data.summary_status,
      recordingRawEventId: data.recording_raw_event_id, recordingStoragePath: data.recording_storage_path,
      recordingAttempts: data.recording_attempts ?? 0, analysisAttempts: data.analysis_attempts ?? 0,
      touchpointId: data.touchpoint_id,
    } as AnalysisCall
  },

  async getConnection(id) {
    const { data, error } = await supabaseAdmin
      .from('telephony_connections')
      .select('id, client_id, provider_account_id, secret_ref, analysis_enabled')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`读连接失败: ${error.message}`)
    if (!data) return null
    return { id: data.id, clientId: data.client_id, accountSid: data.provider_account_id, secretRef: data.secret_ref, analysisEnabled: data.analysis_enabled === true } as AnalysisConnection
  },

  async getRecordingUrl(rawEventId) {
    const { data, error } = await supabaseAdmin.from('telephony_raw_events').select('payload').eq('id', rawEventId).maybeSingle()
    if (error) throw new Error(`读录音事件失败: ${error.message}`)
    const p = (data?.payload ?? {}) as Record<string, unknown>
    // Twilio 录音回调字段 RecordingUrl；VoIPLine 是 call_recording_link
    const url = p.RecordingUrl ?? p.call_recording_link
    return typeof url === 'string' ? url : null
  },

  async uploadRecording(path, bytes, contentType) {
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true })
    if (error) throw new Error(`录音入私有桶失败: ${error.message}`)
  },

  async downloadRecording(path) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (error || !data) throw new Error(`读私有桶录音失败: ${error?.message ?? 'empty'}`)
    return new Uint8Array(await data.arrayBuffer())
  },

  async patchCall(id, patch, receipt) {
    const { data: cur } = await supabaseAdmin.from('telephony_calls').select('receipts').eq('id', id).maybeSingle()
    const receipts = [...(((cur?.receipts as unknown[]) ?? []) as Array<Record<string, unknown>>), { ...receipt, at: new Date().toISOString() }].slice(-50)
    const row: Record<string, unknown> = { receipts, updated_at: new Date().toISOString() }
    if (patch.recordingStatus !== undefined) row.recording_status = patch.recordingStatus
    if (patch.recordingStoragePath !== undefined) row.recording_storage_path = patch.recordingStoragePath
    if (patch.recordingAttempts !== undefined) row.recording_attempts = patch.recordingAttempts
    if (patch.transcriptStatus !== undefined) row.transcript_status = patch.transcriptStatus
    if (patch.summaryStatus !== undefined) row.summary_status = patch.summaryStatus
    if (patch.analysisAttempts !== undefined) row.analysis_attempts = patch.analysisAttempts
    if (patch.analysisError !== undefined) row.analysis_error = patch.analysisError
    const { error } = await supabaseAdmin.from('telephony_calls').update(row).eq('id', id)
    if (error) throw new Error(`更新通话进度失败: ${error.message}`)
  },

  async getTranscriptText(callId) {
    const { data, error } = await supabaseAdmin.from('telephony_transcripts').select('body').eq('call_id', callId).maybeSingle()
    if (error) throw new Error(`读转写失败: ${error.message}`)
    return (data?.body as string | undefined) ?? null
  },

  async saveTranscript(row) {
    const { error } = await supabaseAdmin
      .from('telephony_transcripts')
      .upsert({ call_id: row.callId, client_id: row.clientId, body: row.text, model: row.model }, { onConflict: 'call_id' })
    if (error) throw new Error(`存转写失败: ${error.message}`)
  },

  async saveAnalysis(row) {
    const { data, error } = await supabaseAdmin
      .from('telephony_call_analyses')
      .upsert(
        {
          call_id: row.callId, client_id: row.clientId, schema_version: ANALYSIS_SCHEMA_VERSION, model: row.model,
          summary: row.analysis.summary, language: row.analysis.language, facts: row.analysis.facts,
          dropped_facts: row.analysis.droppedFacts, review_status: 'pending_review',
        },
        { onConflict: 'call_id,schema_version' },
      )
      .select('id')
      .single()
    if (error || !data) throw new Error(`存分析失败: ${error?.message ?? 'empty'}`)
    return data.id as string
  },

  async markTouchpoint(touchpointId, clientId, analysisId) {
    const { data: cur } = await supabaseAdmin.from('contact_touchpoints').select('metadata').eq('id', touchpointId).eq('client_id', clientId).maybeSingle()
    if (!cur) return
    const { error } = await supabaseAdmin
      .from('contact_touchpoints')
      .update({ metadata: { ...((cur.metadata as Record<string, unknown>) ?? {}), call_analysis_id: analysisId, call_analysis_review: 'pending_review' } })
      .eq('id', touchpointId)
      .eq('client_id', clientId)
    if (error) throw new Error(`标记触点失败: ${error.message}`)
  },
}

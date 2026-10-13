/** 分析流水线的 Supabase 存储实现。所有读写都带 client_id；录音放私有桶 telephony-recordings。 */

import { supabaseAdmin } from '@/lib/supabase'
import { ANALYSIS_SCHEMA_VERSION } from './analysis-schema'
import type { AnalysisCall, AnalysisConnection, AnalysisStore } from './pipeline'

const BUCKET = 'telephony-recordings'

export const supabaseAnalysisStore: AnalysisStore = {
  async getCall(clientId, provider, providerCallId) {
    const { data, error } = await supabaseAdmin
      .from('telephony_calls')
      .select('id, client_id, connection_id, provider, provider_call_id, started_at, recording_status, transcript_status, summary_status, recording_raw_event_id, recording_storage_path, recording_attempts, transcript_attempts, analysis_attempts, touchpoint_id')
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
      recordingAttempts: data.recording_attempts ?? 0, transcriptAttempts: data.transcript_attempts ?? 0, analysisAttempts: data.analysis_attempts ?? 0,
      touchpointId: data.touchpoint_id,
    } as AnalysisCall
  },

  async getConnection(id) {
    const { data, error } = await supabaseAdmin
      .from('telephony_connections')
      .select('id, client_id, provider_account_id, secret_ref, active, analysis_enabled, analysis_enabled_at')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`读连接失败: ${error.message}`)
    if (!data) return null
    return { id: data.id, clientId: data.client_id, accountSid: data.provider_account_id, secretRef: data.secret_ref, active: data.active === true, analysisEnabled: data.analysis_enabled === true, analysisEnabledAt: data.analysis_enabled_at ?? null } as AnalysisConnection
  },

  async getRecordingUrl(rawEventId) {
    const { data, error } = await supabaseAdmin.from('telephony_raw_events').select('payload').eq('id', rawEventId).maybeSingle()
    if (error) throw new Error(`读录音事件失败: ${error.message}`)
    const p = (data?.payload ?? {}) as Record<string, unknown>
    // 本期只支持 Twilio 的录音回调字段 RecordingUrl
    const url = p.RecordingUrl
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
    if (patch.transcriptAttempts !== undefined) row.transcript_attempts = patch.transcriptAttempts
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

  async getAnalysisId(callId) {
    const { data, error } = await supabaseAdmin.from('telephony_call_analyses').select('id').eq('call_id', callId).eq('schema_version', ANALYSIS_SCHEMA_VERSION).maybeSingle()
    if (error) throw new Error(`读分析失败: ${error.message}`)
    return (data?.id as string | undefined) ?? null
  },

  async saveAnalysis(row) {
    // 只新增、不覆盖：已有的分析（可能已被人工复核）不能被重跑冲掉。
    const { data, error } = await supabaseAdmin
      .from('telephony_call_analyses')
      .insert({
        call_id: row.callId, client_id: row.clientId, schema_version: ANALYSIS_SCHEMA_VERSION, model: row.model,
        summary: row.analysis.summary, language: row.analysis.language, facts: row.analysis.facts,
        dropped_facts: row.analysis.droppedFacts, review_status: 'pending_review',
      })
      .select('id')
      .single()
    if (error) {
      const { data: existing } = await supabaseAdmin.from('telephony_call_analyses').select('id').eq('call_id', row.callId).eq('schema_version', ANALYSIS_SCHEMA_VERSION).maybeSingle()
      if (existing) return existing.id as string
      throw new Error('存分析失败')
    }
    return data.id as string
  },

  async markTouchpoint(touchpointId, clientId, analysisId) {
    const { error } = await supabaseAdmin.rpc('telephony_mark_touchpoint', { p_touchpoint_id: touchpointId, p_client_id: clientId, p_analysis_id: analysisId })
    if (error) throw new Error('标记触点失败')
  },

  async countTranscribedSince(connectionId, sinceIso) {
    const { count, error } = await supabaseAdmin
      .from('telephony_transcripts')
      .select('call_id, telephony_calls!inner(connection_id)', { count: 'exact', head: true })
      .eq('telephony_calls.connection_id', connectionId)
      .gte('created_at', sinceIso)
    if (error) throw new Error(`数转写失败: ${error.message}`)
    return count ?? 0
  },
}

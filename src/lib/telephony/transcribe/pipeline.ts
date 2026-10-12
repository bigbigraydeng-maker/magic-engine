/**
 * 一通电话的「录音 → 转写 → 分析 → 待复核」流水线。
 *
 * 每一步有自己的状态和重试次数；失败状态可见（recording_status / transcript_status / summary_status = failed），
 * 绝不降级成假摘要。分析结果只写「待复核」，不改联系人、不进学习样本（learning_eligible 永远 false）。
 * 整条流水线受连接上的 analysis_enabled 开关控制，默认关（客人对话要 CTS 书面同意后才开）。
 */

import { downloadTwilioRecording, RecordingFetchError } from './recording'
import { verifyFacts, ANALYSIS_SCHEMA_VERSION, type VerifiedAnalysis } from './analysis-schema'
import type { Analyzer, Transcriber } from './vendors'

export const MAX_STEP_ATTEMPTS = 3

export interface AnalysisCall {
  id: string
  clientId: string
  connectionId: string
  provider: string
  providerCallId: string
  startedAt: string
  recordingStatus: 'none' | 'pending_download' | 'downloaded' | 'failed'
  transcriptStatus: 'not_started' | 'pending' | 'done' | 'failed'
  summaryStatus: 'not_started' | 'pending' | 'done' | 'failed'
  recordingRawEventId: string | null
  recordingStoragePath: string | null
  recordingAttempts: number
  analysisAttempts: number
  touchpointId: string | null
}

export interface AnalysisConnection {
  id: string
  clientId: string
  accountSid: string
  secretRef: string | null
  analysisEnabled: boolean
}

export interface AnalysisStore {
  getCall(clientId: string, provider: string, providerCallId: string): Promise<AnalysisCall | null>
  getConnection(id: string): Promise<AnalysisConnection | null>
  getRecordingUrl(rawEventId: string): Promise<string | null>
  uploadRecording(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  downloadRecording(path: string): Promise<Uint8Array>
  patchCall(id: string, patch: Partial<{
    recordingStatus: AnalysisCall['recordingStatus']; recordingStoragePath: string | null; recordingAttempts: number
    transcriptStatus: AnalysisCall['transcriptStatus']; summaryStatus: AnalysisCall['summaryStatus']
    analysisAttempts: number; analysisError: string | null
  }>, receipt: { stage: string; status: string; detail?: string }): Promise<void>
  getTranscriptText(callId: string): Promise<string | null>
  saveTranscript(row: { callId: string; clientId: string; text: string; model: string }): Promise<void>
  saveAnalysis(row: { callId: string; clientId: string; model: string; analysis: VerifiedAnalysis }): Promise<string>
  /** 把「有一份待复核的分析」标到对应触点的元数据上（不写正文，不改 outcome 等既有字段）。 */
  markTouchpoint(touchpointId: string, clientId: string, analysisId: string): Promise<void>
}

export interface PipelineDeps {
  store: AnalysisStore
  transcribe: Transcriber
  analyze: Analyzer
  env: (name: string) => string | undefined
  fetcher?: typeof fetch
}

export interface PipelineResult {
  status: 'skipped' | 'done' | 'recording_failed' | 'transcript_failed' | 'analysis_failed' | 'waiting'
  detail?: string
}

const safeMsg = (e: unknown) => (e instanceof Error ? e.message : 'unknown').replace(/\+?\d[\d\s-]{6,}\d/g, '[num]').slice(0, 200)

export async function runCallAnalysis(
  deps: PipelineDeps,
  ref: { clientId: string; provider: string; providerCallId: string },
): Promise<PipelineResult> {
  const { store } = deps
  const call = await store.getCall(ref.clientId, ref.provider, ref.providerCallId)
  if (!call) return { status: 'skipped', detail: 'call_not_found' }
  const conn = await store.getConnection(call.connectionId)
  if (!conn || conn.clientId !== call.clientId) return { status: 'skipped', detail: 'connection_mismatch' }
  // 隐私闸：默认关。没有 CTS 书面同意之前，客人的通话不进转写。
  if (!conn.analysisEnabled) return { status: 'skipped', detail: 'analysis_not_enabled' }
  if (call.summaryStatus === 'done') return { status: 'done' }
  if (call.recordingStatus === 'none') return { status: 'waiting', detail: 'no_recording_yet' }

  // ① 录音下载
  let audio: Uint8Array | null = null
  if (call.recordingStatus !== 'downloaded') {
    if (call.recordingAttempts >= MAX_STEP_ATTEMPTS) return { status: 'recording_failed', detail: 'attempts_exhausted' }
    try {
      const url = call.recordingRawEventId ? await store.getRecordingUrl(call.recordingRawEventId) : null
      if (!url) throw new RecordingFetchError('bad_url', '没有录音链接')
      const token = conn.secretRef ? deps.env(conn.secretRef) : undefined
      if (!token) throw new RecordingFetchError('http_error', '服务器没配 Twilio 令牌')
      const rec = await downloadTwilioRecording({ url, accountSid: conn.accountSid, authToken: token, fetcher: deps.fetcher })
      const path = `${call.clientId}/${call.startedAt.slice(0, 4)}/${call.providerCallId}.mp3`
      await store.uploadRecording(path, rec.bytes, rec.contentType)
      await store.patchCall(call.id, { recordingStatus: 'downloaded', recordingStoragePath: path }, { stage: 'recording', status: 'downloaded' })
      audio = rec.bytes
      call.recordingStoragePath = path
    } catch (e) {
      await store.patchCall(call.id, { recordingStatus: 'failed', recordingAttempts: call.recordingAttempts + 1, analysisError: safeMsg(e) }, { stage: 'recording', status: 'failed', detail: safeMsg(e) })
      return { status: 'recording_failed', detail: safeMsg(e) }
    }
  }

  // ② 转写
  let transcript = await store.getTranscriptText(call.id)
  if (!transcript) {
    if (call.analysisAttempts >= MAX_STEP_ATTEMPTS) return { status: 'transcript_failed', detail: 'attempts_exhausted' }
    try {
      audio ??= await store.downloadRecording(call.recordingStoragePath as string)
      const out = await deps.transcribe({ bytes: audio, filename: `${call.providerCallId}.mp3` })
      await store.saveTranscript({ callId: call.id, clientId: call.clientId, text: out.text, model: out.model })
      await store.patchCall(call.id, { transcriptStatus: 'done' }, { stage: 'transcript', status: 'done' })
      transcript = out.text
    } catch (e) {
      await store.patchCall(call.id, { transcriptStatus: 'failed', analysisAttempts: call.analysisAttempts + 1, analysisError: safeMsg(e) }, { stage: 'transcript', status: 'failed', detail: safeMsg(e) })
      return { status: 'transcript_failed', detail: safeMsg(e) }
    }
  }

  // ③ 分析（原话核验）
  if (call.analysisAttempts >= MAX_STEP_ATTEMPTS) return { status: 'analysis_failed', detail: 'attempts_exhausted' }
  try {
    const out = await deps.analyze(transcript)
    const verified = verifyFacts(out.raw, transcript)
    const analysisId = await store.saveAnalysis({ callId: call.id, clientId: call.clientId, model: out.model, analysis: verified })
    await store.patchCall(call.id, { summaryStatus: 'done' }, { stage: 'analysis', status: 'pending_review', detail: `facts=${verified.facts.length} dropped=${verified.droppedFacts} v${ANALYSIS_SCHEMA_VERSION}` })
    if (call.touchpointId) await store.markTouchpoint(call.touchpointId, call.clientId, analysisId)
    return { status: 'done' }
  } catch (e) {
    // 摘要失败就是失败：不写假摘要、不标 done。
    await store.patchCall(call.id, { summaryStatus: 'failed', analysisAttempts: call.analysisAttempts + 1, analysisError: safeMsg(e) }, { stage: 'analysis', status: 'failed', detail: safeMsg(e) })
    return { status: 'analysis_failed', detail: safeMsg(e) }
  }
}

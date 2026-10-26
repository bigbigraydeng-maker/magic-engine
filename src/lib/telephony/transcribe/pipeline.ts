/**
 * 一通电话的「录音 → 转写 → 分析 → 待复核」流水线。
 *
 * 每一步有自己的状态和重试次数；失败状态可见（recording_status / transcript_status / summary_status = failed），
 * 绝不降级成假摘要。分析结果只写「待复核」，不改联系人、不进学习样本（learning_eligible 永远 false）。
 * 整条流水线受连接上的 analysis_enabled 开关控制，默认关（客人对话要 CTS 书面同意后才开）。
 */

import { downloadTwilioRecording, recordingSidFromUrl, RecordingFetchError } from './recording'
import { verifyFacts, ANALYSIS_SCHEMA_VERSION, type VerifiedAnalysis } from './analysis-schema'
import { verifySummary, fallbackSummaryFromFacts } from './summary-gate'
import { SECRET_REF_PATTERN } from '@/lib/telephony/twilio/ingest'
import { TranscriptPendingError, type Analyzer, type Transcriber } from './vendors'

export const MAX_STEP_ATTEMPTS = 3
/** 每个连接每天最多转写这么多通（花钱的闸；打开开关前的最低限度保护）。 */
export const DAILY_TRANSCRIBE_CAP = 60
/** 本期只支持 Twilio 的录音取回；别的供应商先不处理（不白烧重试次数）。 */
export const SUPPORTED_PROVIDERS = ['twilio'] as const

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
  /** 这通电话挂在哪个客人身上；摘要核对闸要拿他的名字比对。没认到人时为 null。 */
  contactId?: string | null
  recordingRawEventId: string | null
  recordingStoragePath: string | null
  recordingAttempts: number
  transcriptAttempts: number
  analysisAttempts: number
  touchpointId: string | null
}

export interface AnalysisConnection {
  id: string
  clientId: string
  accountSid: string
  secretRef: string | null
  active: boolean
  analysisEnabled: boolean
  /** 开关打开的时刻；更早开始的通话永远不处理。 */
  analysisEnabledAt: string | null
}

export interface AnalysisStore {
  /** 读这个客人已知的名字，供摘要核对闸比对；没接的实现当成「不知道名字」。 */
  getKnownNames?: (contactId: string | null) => Promise<readonly string[]>
  getCall(clientId: string, provider: string, providerCallId: string): Promise<AnalysisCall | null>
  getConnection(id: string): Promise<AnalysisConnection | null>
  getRecordingUrl(rawEventId: string): Promise<string | null>
  uploadRecording(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  downloadRecording(path: string): Promise<Uint8Array>
  patchCall(id: string, patch: Partial<{
    recordingStatus: AnalysisCall['recordingStatus']; recordingStoragePath: string | null; recordingAttempts: number
    transcriptStatus: AnalysisCall['transcriptStatus']; transcriptAttempts: number
    summaryStatus: AnalysisCall['summaryStatus']; analysisAttempts: number; analysisError: string | null
  }>, receipt: { stage: string; status: string; detail?: string }): Promise<void>
  getTranscriptText(callId: string): Promise<string | null>
  saveTranscript(row: { callId: string; clientId: string; text: string; model: string }): Promise<void>
  /** 已有分析就返回它的 id，不覆盖（人工复核结果不能被重跑冲掉）。 */
  getAnalysisId(callId: string): Promise<string | null>
  saveAnalysis(row: { callId: string; clientId: string; model: string; analysis: VerifiedAnalysis }): Promise<string>
  /** 数据库里原子合并，把「有一份待复核分析」标到触点元数据上（不写正文）。 */
  markTouchpoint(touchpointId: string, clientId: string, analysisId: string): Promise<void>
  /** 这个连接从某时刻起已经转写了多少通（日上限用）。 */
  countTranscribedSince(connectionId: string, sinceIso: string): Promise<number>
}

export interface PipelineDeps {
  store: AnalysisStore
  transcribe: Transcriber
  analyze: Analyzer
  env: (name: string) => string | undefined
  fetcher?: typeof fetch
  now?: () => Date
}

export interface PipelineResult {
  status: 'skipped' | 'done' | 'recording_failed' | 'transcript_failed' | 'analysis_failed' | 'waiting'
  detail?: string
}

/** 失败只记「类别」，不记原始报错文字（报错里可能带着转写片段 / 客人原话）。 */
function errClass(stage: 'recording' | 'transcript' | 'analysis', e: unknown): string {
  if (e instanceof RecordingFetchError) return `recording_${e.code}`
  if (stage === 'analysis') return e instanceof SyntaxError || (e instanceof Error && e.name === 'ZodError') ? 'analysis_json_invalid' : 'analysis_vendor_error'
  return `${stage}_error`
}

export async function runCallAnalysis(
  deps: PipelineDeps,
  ref: { clientId: string; provider: string; providerCallId: string },
): Promise<PipelineResult> {
  const { store } = deps
  const call = await store.getCall(ref.clientId, ref.provider, ref.providerCallId)
  if (!call) return { status: 'skipped', detail: 'call_not_found' }
  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(call.provider)) return { status: 'skipped', detail: 'unsupported_provider' }
  const conn = await store.getConnection(call.connectionId)
  if (!conn || conn.clientId !== call.clientId) return { status: 'skipped', detail: 'connection_mismatch' }
  // 隐私闸：默认关；停用的连接不处理；开关打开之前开始的通话永远不处理（不回捞历史录音）。
  if (!conn.active || !conn.analysisEnabled || !conn.analysisEnabledAt) return { status: 'skipped', detail: 'analysis_not_enabled' }
  if (Date.parse(call.startedAt) < Date.parse(conn.analysisEnabledAt)) return { status: 'skipped', detail: 'before_enabled_at' }
  if (call.summaryStatus === 'done') return { status: 'done' }
  if (call.recordingStatus === 'none') return { status: 'waiting', detail: 'no_recording_yet' }

  // ① 录音下载
  if (call.recordingStatus !== 'downloaded') {
    if (call.recordingAttempts >= MAX_STEP_ATTEMPTS) return { status: 'recording_failed', detail: 'attempts_exhausted' }
    try {
      const url = call.recordingRawEventId ? await store.getRecordingUrl(call.recordingRawEventId) : null
      if (!url) throw new RecordingFetchError('bad_url', '没有录音链接')
      // 令牌变量名只许 TWILIO_AUTH_TOKEN_ 前缀（和接收口同一条规则）：库里写错一行不能让服务把别的密钥当 Twilio 令牌发出去。
      const token = conn.secretRef && SECRET_REF_PATTERN.test(conn.secretRef) ? deps.env(conn.secretRef) : undefined
      if (!token) throw new RecordingFetchError('http_error', '服务器没配 Twilio 令牌')
      const rec = await downloadTwilioRecording({ url, accountSid: conn.accountSid, authToken: token, fetcher: deps.fetcher })
      // 路径只用数据库 uuid：供应商给的通话编号不进文件名（防路径穿越与同名覆盖）。
      const path = `${call.clientId}/${call.startedAt.slice(0, 4)}/${call.id}.mp3`
      await store.uploadRecording(path, rec.bytes, rec.contentType)
      await store.patchCall(call.id, { recordingStatus: 'downloaded', recordingStoragePath: path }, { stage: 'recording', status: 'downloaded' })
      call.recordingStoragePath = path
    } catch (e) {
      const c = errClass('recording', e)
      await store.patchCall(call.id, { recordingStatus: 'failed', recordingAttempts: call.recordingAttempts + 1, analysisError: c }, { stage: 'recording', status: 'failed', detail: c })
      return { status: 'recording_failed', detail: c }
    }
  }

  // 服务商密钥没配：直接等待，不耗次数、不记失败（补上密钥后下一轮自动继续）。
  const serviceSid = deps.env('TWILIO_INTELLIGENCE_SERVICE_SID')
  if (!serviceSid || !deps.env('DEEPSEEK_API_KEY')) return { status: 'waiting', detail: 'config_missing' }

  // ② 转写
  let transcript = await store.getTranscriptText(call.id)
  if (!transcript) {
    if (call.transcriptAttempts >= MAX_STEP_ATTEMPTS) return { status: 'transcript_failed', detail: 'attempts_exhausted' }
    const now = (deps.now ?? (() => new Date()))()
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString()
    if ((await store.countTranscribedSince(conn.id, since)) >= DAILY_TRANSCRIBE_CAP) return { status: 'waiting', detail: 'daily_cap' }
    try {
      const url = call.recordingRawEventId ? await store.getRecordingUrl(call.recordingRawEventId) : null
      const recordingSid = url ? recordingSidFromUrl(url) : null
      const authToken = conn.secretRef && SECRET_REF_PATTERN.test(conn.secretRef) ? deps.env(conn.secretRef) : undefined
      if (!recordingSid || !authToken) throw new RecordingFetchError('bad_url', '缺少录音编号或令牌')
      const out = await deps.transcribe({ recordingSid, accountSid: conn.accountSid, authToken, serviceSid })
      await store.saveTranscript({ callId: call.id, clientId: call.clientId, text: out.text, model: out.model })
      await store.patchCall(call.id, { transcriptStatus: 'done' }, { stage: 'transcript', status: 'done' })
      transcript = out.text
    } catch (e) {
      // 还在转：等下一轮，不计失败次数、不改状态（Twilio 那边转完后下一轮直接取）。
      if (e instanceof TranscriptPendingError) return { status: 'waiting', detail: 'transcript_pending' }
      const c = errClass('transcript', e)
      await store.patchCall(call.id, { transcriptStatus: 'failed', transcriptAttempts: call.transcriptAttempts + 1, analysisError: c }, { stage: 'transcript', status: 'failed', detail: c })
      return { status: 'transcript_failed', detail: c }
    }
  } else if (call.transcriptStatus !== 'done') {
    // 转写其实已经存下了，但状态没跟上（上次中途出错）：纠正状态，不重做。
    await store.patchCall(call.id, { transcriptStatus: 'done' }, { stage: 'transcript', status: 'done', detail: 'status_repaired' })
  }

  // ③ 分析（原话核验）
  if (call.analysisAttempts >= MAX_STEP_ATTEMPTS) return { status: 'analysis_failed', detail: 'attempts_exhausted' }
  let analysisId = await store.getAnalysisId(call.id)
  if (!analysisId) {
    try {
      const out = await deps.analyze(transcript)
      const verified = verifyFacts(out.raw, transcript)

      // 摘要也要过闸 —— 以前只有 facts 有原话核验，summary 是模型写完原样存，
      // 结果 2026-10-25 查出两处错：把客人 Sarju Dayal 写成 Sergio Dyer、
      // 以及「首次去中国」跟原话「I've been to South China」矛盾。
      // 不过关就换成「由已核实事实拼出来的摘要」：少了可读性，但不会写错事实。
      const knownNames = store.getKnownNames ? await store.getKnownNames(call.contactId ?? null) : []
      const sv = verifySummary({
        summary: verified.summary,
        transcript,
        knownNames,
        // 已核实事实的值和原话也算数字的依据：口语里的 "March 20 27th" 会被写成
        // 「2027年3月20日」，只跟转写比字面会把这种正确摘要误判成瞎编。
        supportingTexts: verified.facts.flatMap((f) => [f.value, f.quote]),
      })
      const gated: VerifiedAnalysis = sv.ok
        ? verified
        : { ...verified, summary: fallbackSummaryFromFacts(verified.facts) }

      analysisId = await store.saveAnalysis({ callId: call.id, clientId: call.clientId, model: out.model, analysis: gated })
      const truncated = transcript.length > 60_000 ? ' truncated=1' : ''
      // 被闸掉的事实和被换掉的摘要都留痕：否则只看到一个数字，分不清是闸太严还是模型在编。
      const droppedKeys = out.raw.facts
        .filter((f) => !verified.facts.some((k) => k.key === f.key && k.quote === f.quote))
        // 只写「哪一类事实、原话多长」，**不写原话本身** —— 原话里可能有客人的
        // 姓名电话，而这条回执的访问范围和保留期都不受控（同 smart-ack 设计稿 §9.8
        // 定的口径：回执只写原因码 + 长度，不写客人原文）。
        .map((f) => `${f.key}:${String(f.quote).length}字`)
        .join(' | ')
      const summaryNote = sv.ok ? '' : ` summary_replaced=${sv.rejected.join(',')}`
      const droppedNote = droppedKeys === '' ? '' : ` dropped_detail=[${droppedKeys.slice(0, 400)}]`
      await store.patchCall(call.id, { summaryStatus: 'done' }, {
        stage: 'analysis',
        status: 'pending_review',
        detail: `facts=${verified.facts.length} dropped=${verified.droppedFacts} inquiries=${verified.inquiries.length} dropped_inquiries=${verified.droppedInquiries} v${ANALYSIS_SCHEMA_VERSION}${truncated}${summaryNote}${droppedNote}`,
      })
    } catch (e) {
      // 摘要失败就是失败：不写假摘要、不标 done。
      const c = errClass('analysis', e)
      await store.patchCall(call.id, { summaryStatus: 'failed', analysisAttempts: call.analysisAttempts + 1, analysisError: c }, { stage: 'analysis', status: 'failed', detail: c })
      return { status: 'analysis_failed', detail: c }
    }
  } else {
    // 分析其实已存下（上次中途出错），状态没跟上：纠正状态，不重跑。
    await store.patchCall(call.id, { summaryStatus: 'done' }, { stage: 'analysis', status: 'pending_review', detail: 'status_repaired' })
  }

  // 触点标记失败不影响「分析已完成」：只记回执，不把已完成的分析改成失败、不重跑花钱。
  if (call.touchpointId) {
    try {
      await store.markTouchpoint(call.touchpointId, call.clientId, analysisId)
    } catch {
      await store.patchCall(call.id, {}, { stage: 'touchpoint_mark', status: 'failed', detail: 'mark_failed' })
    }
  }
  return { status: 'done' }
}

import { describe, expect, it } from 'vitest'
import { downloadTwilioRecording, MAX_RECORDING_BYTES, RecordingFetchError } from '../recording'
import { verifyFacts, type RawAnalysis } from '../analysis-schema'
import { runCallAnalysis, MAX_STEP_ATTEMPTS, type AnalysisCall, type AnalysisConnection, type AnalysisStore } from '../pipeline'

const ACCT = 'AC' + 'a'.repeat(32)
const REC = 'RE' + 'b'.repeat(32)
const URL_OK = `https://api.twilio.com/2010-04-01/Accounts/${ACCT}/Recordings/${REC}`

const audioFetch = (status = 200, bytes = 10, headers: Record<string, string> = {}) =>
  (async () => new Response(new Uint8Array(bytes), { status, headers: { 'content-type': 'audio/mpeg', ...headers } })) as unknown as typeof fetch

describe('录音下载', () => {
  it('只认 Twilio 官方录音路径，其余一律拒绝', async () => {
    for (const u of ['http://api.twilio.com/2010-04-01/Accounts/x/Recordings/y', 'https://evil.example/2010-04-01/Accounts/' + ACCT + '/Recordings/' + REC, `${URL_OK}/../x`, 'https://api.twilio.com.evil.test/x']) {
      await expect(downloadTwilioRecording({ url: u, accountSid: ACCT, authToken: 't', fetcher: audioFetch() })).rejects.toMatchObject({ code: 'bad_url' })
    }
  })
  it('录音属于别的账号 → 拒绝', async () => {
    await expect(downloadTwilioRecording({ url: URL_OK, accountSid: 'AC' + 'c'.repeat(32), authToken: 't', fetcher: audioFetch() })).rejects.toMatchObject({ code: 'account_mismatch' })
  })
  it('成功：返回字节与录音编号；带 Basic 认证、不把令牌放进地址', async () => {
    let seen: { url: string; auth: string | null } | null = null
    const f = (async (u: string, init?: RequestInit) => {
      seen = { url: u, auth: new Headers(init?.headers).get('authorization') }
      return new Response(new Uint8Array(5), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
    }) as unknown as typeof fetch
    const r = await downloadTwilioRecording({ url: URL_OK + '.mp3', accountSid: ACCT, authToken: 'secret-token', fetcher: f })
    expect(r.bytes.byteLength).toBe(5)
    expect(r.recordingSid).toBe(REC)
    expect(seen!.url).toBe(`${URL_OK}.mp3`)
    expect(seen!.url).not.toContain('secret')
    expect(seen!.auth).toMatch(/^Basic /)
  })
  it('HTTP 错误 / 空文件 / 超大 → 各自报错', async () => {
    await expect(downloadTwilioRecording({ url: URL_OK, accountSid: ACCT, authToken: 't', fetcher: audioFetch(404) })).rejects.toMatchObject({ code: 'http_error' })
    await expect(downloadTwilioRecording({ url: URL_OK, accountSid: ACCT, authToken: 't', fetcher: audioFetch(200, 0) })).rejects.toMatchObject({ code: 'empty' })
    await expect(downloadTwilioRecording({ url: URL_OK, accountSid: ACCT, authToken: 't', fetcher: audioFetch(200, 5, { 'content-length': String(MAX_RECORDING_BYTES + 1) }) })).rejects.toBeInstanceOf(RecordingFetchError)
  })
})

describe('分析：原话核验', () => {
  const transcript = 'Hi, we want the South Island tour in March, about four people. 我们预算大概两万纽币。'
  const raw: RawAnalysis = {
    summary: '客人想了解南岛团，三月出发。',
    language: 'zh',
    facts: [
      { key: 'travel_window', value: 'March', quote: 'South Island tour in March', confidence: 0.9 },
      { key: 'party_size', value: '4', quote: 'about four people', confidence: 0.8 },
      { key: 'budget', value: 'NZD 20000', quote: '预算大概两万纽币', confidence: 0.7 },
      { key: 'competitor', value: 'X Tours', quote: 'we also asked X Tours', confidence: 0.9 }, // 编的
    ],
  }
  it('原话在转写里找不到的事实被丢弃并计数；找得到的保留（忽略空白与标点）', () => {
    const v = verifyFacts(raw, transcript)
    expect(v.facts.map((f) => f.key)).toEqual(['travel_window', 'party_size', 'budget'])
    expect(v.droppedFacts).toBe(1)
  })
  it('原话太短（<2 字）不算数', () => {
    const v = verifyFacts({ ...raw, facts: [{ key: 'concern', value: 'x', quote: 'a', confidence: 1 }] }, transcript)
    expect(v.facts).toHaveLength(0)
  })
})

function makeStore(over: { call?: Partial<AnalysisCall>; conn?: Partial<AnalysisConnection> } = {}) {
  const call: AnalysisCall = {
    id: 'call-row-1', clientId: 'client-1', connectionId: 'conn-1', provider: 'twilio', providerCallId: 'CA1', startedAt: '2026-10-12T11:37:24.000Z',
    recordingStatus: 'pending_download', transcriptStatus: 'not_started', summaryStatus: 'not_started', recordingRawEventId: 'raw-rec', recordingStoragePath: null,
    recordingAttempts: 0, analysisAttempts: 0, touchpointId: 'tp-1', ...over.call,
  }
  const conn: AnalysisConnection = { id: 'conn-1', clientId: 'client-1', accountSid: ACCT, secretRef: 'TWILIO_AUTH_TOKEN_CTS', analysisEnabled: true, ...over.conn }
  const files = new Map<string, Uint8Array>()
  const transcripts = new Map<string, string>()
  const analyses: Array<{ callId: string; summary: string; facts: unknown[]; dropped: number }> = []
  const receipts: string[] = []
  const marks: string[] = []
  const store: AnalysisStore = {
    async getCall() { return call },
    async getConnection() { return conn },
    async getRecordingUrl() { return URL_OK },
    async uploadRecording(path, bytes) { files.set(path, bytes) },
    async downloadRecording(path) { return files.get(path)! },
    async patchCall(_id, patch, r) {
      if (patch.recordingStatus) call.recordingStatus = patch.recordingStatus
      if (patch.recordingStoragePath !== undefined) call.recordingStoragePath = patch.recordingStoragePath
      if (patch.recordingAttempts !== undefined) call.recordingAttempts = patch.recordingAttempts
      if (patch.transcriptStatus) call.transcriptStatus = patch.transcriptStatus
      if (patch.summaryStatus) call.summaryStatus = patch.summaryStatus
      if (patch.analysisAttempts !== undefined) call.analysisAttempts = patch.analysisAttempts
      receipts.push(`${r.stage}:${r.status}`)
    },
    async getTranscriptText(id) { return transcripts.get(id) ?? null },
    async saveTranscript(r) { transcripts.set(r.callId, r.text) },
    async saveAnalysis(r) { analyses.push({ callId: r.callId, summary: r.analysis.summary, facts: r.analysis.facts, dropped: r.analysis.droppedFacts }); return 'an-1' },
    async markTouchpoint(tp, _c, an) { marks.push(`${tp}:${an}`) },
  }
  return { store, call, files, transcripts, analyses, receipts, marks }
}

const ref = { clientId: 'client-1', provider: 'twilio', providerCallId: 'CA1' }
const goodDeps = (store: AnalysisStore, over: Partial<Parameters<typeof runCallAnalysis>[0]> = {}) => ({
  store,
  transcribe: async () => ({ text: 'South Island tour in March, about four people', model: 'm-t' }),
  analyze: async () => ({
    raw: { summary: '想了解南岛团', language: 'en', facts: [{ key: 'travel_window' as const, value: 'March', quote: 'South Island tour in March', confidence: 0.9 }, { key: 'concern' as const, value: 'price', quote: 'too expensive for us', confidence: 0.9 }] },
    model: 'm-a',
  }),
  env: (n: string) => (n === 'TWILIO_AUTH_TOKEN_CTS' ? 'tok' : undefined),
  fetcher: audioFetch(),
  ...over,
})

describe('分析流水线', () => {
  it('开关关着（默认）：什么都不做——不下载、不转写、不分析', async () => {
    const m = makeStore({ conn: { analysisEnabled: false } })
    let touched = false
    const r = await runCallAnalysis(goodDeps(m.store, { transcribe: async () => { touched = true; return { text: 'x', model: 'm' } } }), ref)
    expect(r).toMatchObject({ status: 'skipped', detail: 'analysis_not_enabled' })
    expect(touched).toBe(false)
    expect(m.files.size).toBe(0)
  })
  it('完整成功：录音入私有桶（按客户/年份/通话编号）→ 转写 → 分析（编造的事实被丢）→ 标记触点待复核', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store), ref)
    expect(r.status).toBe('done')
    expect([...m.files.keys()]).toEqual(['client-1/2026/CA1.mp3'])
    expect(m.call).toMatchObject({ recordingStatus: 'downloaded', transcriptStatus: 'done', summaryStatus: 'done' })
    expect(m.analyses[0].facts).toHaveLength(1)
    expect(m.analyses[0].dropped).toBe(1)
    expect(m.marks).toEqual(['tp-1:an-1'])
  })
  it('再跑一遍：已完成的不重做（幂等）', async () => {
    const m = makeStore()
    await runCallAnalysis(goodDeps(m.store), ref)
    let calls = 0
    await runCallAnalysis(goodDeps(m.store, { transcribe: async () => { calls++; return { text: 'x', model: 'm' } } }), ref)
    expect(calls).toBe(0)
    expect(m.analyses).toHaveLength(1)
  })
  it('下载失败：状态标 failed、次数加一、原因可见；没有令牌 / 没有链接同样不假装成功', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { fetcher: audioFetch(500) }), ref)
    expect(r.status).toBe('recording_failed')
    expect(m.call).toMatchObject({ recordingStatus: 'failed', recordingAttempts: 1, transcriptStatus: 'not_started', summaryStatus: 'not_started' })
    const m2 = makeStore()
    const r2 = await runCallAnalysis(goodDeps(m2.store, { env: () => undefined }), ref)
    expect(r2.status).toBe('recording_failed')
  })
  it('转写失败：不写假摘要，transcript_status=failed，summary 仍是 not_started', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { transcribe: async () => { throw new Error('vendor down') } }), ref)
    expect(r.status).toBe('transcript_failed')
    expect(m.call).toMatchObject({ transcriptStatus: 'failed', summaryStatus: 'not_started', analysisAttempts: 1 })
    expect(m.analyses).toHaveLength(0)
  })
  it('分析失败：summary_status=failed（不是 done），不标触点；转写已存下来，重试不用重转', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { analyze: async () => { throw new Error('bad json') } }), ref)
    expect(r.status).toBe('analysis_failed')
    expect(m.call).toMatchObject({ transcriptStatus: 'done', summaryStatus: 'failed' })
    expect(m.marks).toHaveLength(0)
    let transcribed = 0
    const r2 = await runCallAnalysis(goodDeps(m.store, { transcribe: async () => { transcribed++; return { text: 'x', model: 'm' } } }), ref)
    expect(r2.status).toBe('done')
    expect(transcribed).toBe(0)
  })
  it('失败次数达到上限：停手，不再无限重试', async () => {
    const m = makeStore({ call: { recordingAttempts: MAX_STEP_ATTEMPTS } })
    expect((await runCallAnalysis(goodDeps(m.store), ref)).detail).toBe('attempts_exhausted')
    const m2 = makeStore({ call: { recordingStatus: 'downloaded', recordingStoragePath: 'p', analysisAttempts: MAX_STEP_ATTEMPTS } })
    m2.files.set('p', new Uint8Array(1))
    expect((await runCallAnalysis(goodDeps(m2.store), ref)).status).toBe('transcript_failed')
  })
  it('没有录音：等，不当失败', async () => {
    const m = makeStore({ call: { recordingStatus: 'none' } })
    expect(await runCallAnalysis(goodDeps(m.store), ref)).toMatchObject({ status: 'waiting' })
  })
  it('连接和通话不是同一个客户：不处理', async () => {
    const m = makeStore({ conn: { clientId: 'other-client' } })
    expect((await runCallAnalysis(goodDeps(m.store), ref)).status).toBe('skipped')
  })
})

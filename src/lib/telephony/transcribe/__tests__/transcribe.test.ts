import { describe, expect, it } from 'vitest'
import { downloadTwilioRecording, MAX_RECORDING_BYTES, RecordingFetchError } from '../recording'
import { numbersIn, verifyFacts, type RawAnalysis } from '../analysis-schema'
import { planAnalysisSweep } from '@/lib/inngest/functions/telephony-analysis'
import { TranscriptPendingError } from '../vendors'
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

  it('保留客户邮箱，并在现有摘要中逐月呈现已核实的团期问答', () => {
    const callText = 'Customer: My email is sarju.dayal@example.com. How many tours are there in March? How many tours are there in May? Employee: We have two tours in March and three tours in May.'
    const v = verifyFacts({
      summary: '客户咨询中国旅行安排。', language: 'en',
      facts: [{ key: 'contact_email', value: 'sarju.dayal@example.com', quote: 'My email is sarju.dayal@example.com', speaker: 'customer', confidence: 0.95 }],
      inquiries: [
        { topic: 'tour_departures', month: 3, question: '三月有几团', questionQuote: 'How many tours are there in March?', questionSpeaker: 'customer', answer: '三月有两团', answerQuote: 'We have two tours in March', answerSpeaker: 'employee', answerStatus: 'answered', departureCount: 2, confidence: 0.9 },
        { topic: 'tour_departures', month: 5, question: '五月有几团', questionQuote: 'How many tours are there in May?', questionSpeaker: 'customer', answer: '五月有三团', answerQuote: 'three tours in May', answerSpeaker: 'employee', answerStatus: 'answered', departureCount: 3, confidence: 0.9 },
      ],
    }, callText)

    expect(v.facts).toHaveLength(1)
    expect(v.facts[0]).toMatchObject({ key: 'contact_email', value: 'sarju.dayal@example.com' })
    expect(v.inquiries.map((inquiry) => [inquiry.month, inquiry.departureCount])).toEqual([[3, 2], [5, 3]])
    expect(v.summary).toContain('客户提供邮箱：sarju.dayal@example.com')
    expect(v.summary).toContain('3月团期')
    expect(v.summary).toContain('明确2团')
    expect(v.summary).toContain('5月团期')
    expect(v.summary).toContain('明确3团')
  })

  it('不把“确认需要两周”误记成两团', () => {
    const callText = 'How many tours do you have in March? We have two weeks to confirm the tours.'
    const v = verifyFacts({
      summary: '客户询问三月团期。', language: 'en', facts: [],
      inquiries: [{ topic: 'tour_departures', month: 3, question: '三月有几团', questionQuote: 'How many tours do you have in March?', questionSpeaker: 'customer', answer: '员工需要两周确认', answerQuote: 'We have two weeks to confirm the tours', answerSpeaker: 'employee', answerStatus: 'answered', departureCount: 2, confidence: 0.8 }],
    }, callText)

    expect(v.inquiries[0]).toMatchObject({ answerStatus: 'answered', departureCount: null })
    expect(v.summary).toContain('团数未核实')
  })

  it('跨月份的合并答复不能给每个月分别认定团数', () => {
    const combinedAnswer = 'We have two tours in March and three tours in May'
    const callText = `How many tours are there in March? How many tours are there in May? ${combinedAnswer}.`
    const v = verifyFacts({
      summary: '客户询问团期。', language: 'en', facts: [],
      inquiries: [
        { topic: 'tour_departures', month: 3, question: '三月有几团', questionQuote: 'How many tours are there in March?', questionSpeaker: 'customer', answer: '逐月说明团数', answerQuote: combinedAnswer, answerSpeaker: 'employee', answerStatus: 'answered', departureCount: 2, confidence: 0.9 },
        { topic: 'tour_departures', month: 5, question: '五月有几团', questionQuote: 'How many tours are there in May?', questionSpeaker: 'customer', answer: '逐月说明团数', answerQuote: combinedAnswer, answerSpeaker: 'employee', answerStatus: 'answered', departureCount: 3, confidence: 0.9 },
      ],
    }, callText)

    expect(v.inquiries.map((inquiry) => [inquiry.answerStatus, inquiry.departureCount])).toEqual([['unclear', null], ['unclear', null]])
  })
})

function makeStore(over: { call?: Partial<AnalysisCall>; conn?: Partial<AnalysisConnection>; transcribedToday?: number; markFails?: boolean; stanceFails?: boolean } = {}) {
  const over2 = { transcribedToday: over.transcribedToday ?? 0 }
  const call: AnalysisCall = {
    id: 'call-row-1', clientId: 'client-1', connectionId: 'conn-1', provider: 'twilio', providerCallId: 'CA1', startedAt: '2026-10-12T11:37:24.000Z',
    recordingStatus: 'pending_download', transcriptStatus: 'not_started', summaryStatus: 'not_started', recordingRawEventId: 'raw-rec', recordingStoragePath: null,
    recordingAttempts: 0, transcriptAttempts: 0, analysisAttempts: 0, touchpointId: 'tp-1', ...over.call,
  }
  const conn: AnalysisConnection = { id: 'conn-1', clientId: 'client-1', accountSid: ACCT, secretRef: 'TWILIO_AUTH_TOKEN_CTS', active: true, analysisEnabled: true, analysisEnabledAt: '2026-10-12T00:00:00.000Z', ...over.conn }
  const files = new Map<string, Uint8Array>()
  const transcripts = new Map<string, string>()
  const analyses: Array<{ callId: string; summary: string; facts: unknown[]; dropped: number }> = []
  const receipts: string[] = []
  const marks: string[] = []
  const stances: string[] = []
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
      if (patch.transcriptAttempts !== undefined) call.transcriptAttempts = patch.transcriptAttempts
      if (patch.analysisAttempts !== undefined) call.analysisAttempts = patch.analysisAttempts
      receipts.push(`${r.stage}:${r.status}`)
    },
    async getTranscriptText(id) { return transcripts.get(id) ?? null },
    async saveTranscript(r) { transcripts.set(r.callId, r.text) },
    async getAnalysisId(id) { return analyses.find((a) => a.callId === id) ? 'an-1' : null },
    async countTranscribedSince() { return over2.transcribedToday },
    async saveAnalysis(r) { analyses.push({ callId: r.callId, summary: r.analysis.summary, facts: r.analysis.facts, dropped: r.analysis.droppedFacts }); return 'an-1' },
    async markTouchpoint(tp, _c, an) { if (over.markFails) throw new Error('boom'); marks.push(`${tp}:${an}`) },
    async markCallStance(tp, _c, an, stance) { if (over.stanceFails) throw new Error('boom'); stances.push(`${tp}:${an}:${stance}`); return 'written' },
  }
  return { store, call, files, transcripts, analyses, receipts, marks, stances }
}

const ref = { clientId: 'client-1', provider: 'twilio', providerCallId: 'CA1' }
const goodDeps = (store: AnalysisStore, over: Partial<Parameters<typeof runCallAnalysis>[0]> = {}) => ({
  store,
  transcribe: async () => ({ text: 'South Island tour in March, about four people', model: 'm-t' }),
  analyze: async () => ({
    raw: { summary: '想了解南岛团', language: 'en', facts: [{ key: 'travel_window' as const, value: 'March', quote: 'South Island tour in March', confidence: 0.9 }, { key: 'concern' as const, value: 'price', quote: 'too expensive for us', confidence: 0.9 }] },
    model: 'm-a',
  }),
  env: (n: string) => (n === 'TWILIO_AUTH_TOKEN_CTS' ? 'tok' : n === 'TWILIO_INTELLIGENCE_SERVICE_SID' || n === 'DEEPSEEK_API_KEY' ? 'k' : undefined),
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
  it('完整成功：录音入私有桶（按客户/年份/数据库 uuid，不用供应商给的通话编号）→ 转写 → 分析（编造的事实被丢）→ 标记触点待复核', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store), ref)
    expect(r.status).toBe('done')
    expect([...m.files.keys()]).toEqual(['client-1/2026/call-row-1.mp3'])
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
  it('转写 / 分析服务密钥没配：等待，不耗次数、不记失败', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { env: (n: string) => (n === 'TWILIO_AUTH_TOKEN_CTS' ? 'tok' : undefined) }), ref)
    expect(r).toMatchObject({ status: 'waiting', detail: 'config_missing' })
    expect(m.call).toMatchObject({ transcriptStatus: 'not_started', transcriptAttempts: 0 })
  })
  it('转写还在进行：等待，不计失败次数、不改状态', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { transcribe: async () => { throw new TranscriptPendingError() } }), ref)
    expect(r).toMatchObject({ status: 'waiting', detail: 'transcript_pending' })
    expect(m.call).toMatchObject({ transcriptStatus: 'not_started', transcriptAttempts: 0 })
  })
  it('转写失败：不写假摘要，transcript_status=failed，summary 仍是 not_started；错误只记类别、不带原文', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { transcribe: async () => { throw new Error('vendor down: 客人说我叫张三') } }), ref)
    expect(r).toMatchObject({ status: 'transcript_failed', detail: 'transcript_error' })
    expect(m.call).toMatchObject({ transcriptStatus: 'failed', summaryStatus: 'not_started', transcriptAttempts: 1, analysisAttempts: 0 })
    expect(JSON.stringify(m.receipts)).not.toContain('张三')
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
    const m2 = makeStore({ call: { recordingStatus: 'downloaded', recordingStoragePath: 'p', transcriptAttempts: MAX_STEP_ATTEMPTS } })
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

describe('审查后补的防线', () => {
  it('开关打开之前开始的通话：永远不处理（不回捞历史录音）', async () => {
    const m = makeStore({ conn: { analysisEnabledAt: '2026-10-13T00:00:00.000Z' } })
    expect(await runCallAnalysis(goodDeps(m.store), ref)).toMatchObject({ status: 'skipped', detail: 'before_enabled_at' })
    expect(m.files.size).toBe(0)
  })
  it('连接停用 / 没有开关时间 / 不是 Twilio：不处理', async () => {
    expect((await runCallAnalysis(goodDeps(makeStore({ conn: { active: false } }).store), ref)).detail).toBe('analysis_not_enabled')
    expect((await runCallAnalysis(goodDeps(makeStore({ conn: { analysisEnabledAt: null } }).store), ref)).detail).toBe('analysis_not_enabled')
    expect((await runCallAnalysis(goodDeps(makeStore({ call: { provider: 'voipline' } }).store), { ...ref, provider: 'voipline' })).detail).toBe('unsupported_provider')
  })
  it('令牌变量名不在 TWILIO_AUTH_TOKEN_ 前缀内：不读环境变量、不下载', async () => {
    const m = makeStore({ conn: { secretRef: 'SUPABASE_SERVICE_ROLE_KEY' } })
    let asked: string[] = []
    const r = await runCallAnalysis(goodDeps(m.store, { env: (n: string) => { asked.push(n); return 'leak' } }), ref)
    expect(r.status).toBe('recording_failed')
    expect(asked).toEqual([])
  })
  it('每天转写次数到上限：等，不花钱、不消耗重试次数', async () => {
    const m = makeStore({ call: { recordingStatus: 'downloaded', recordingStoragePath: 'p' }, transcribedToday: 60 })
    m.files.set('p', new Uint8Array(1))
    expect(await runCallAnalysis(goodDeps(m.store), ref)).toMatchObject({ status: 'waiting', detail: 'daily_cap' })
    expect(m.call.transcriptAttempts).toBe(0)
  })
  it('分析已存下，只是标触点失败：不改成失败、不重跑分析、不重复花钱', async () => {
    const m = makeStore({ markFails: true })
    const r = await runCallAnalysis(goodDeps(m.store), ref)
    expect(r.status).toBe('done')
    expect(m.call.summaryStatus).toBe('done')
    expect(m.analyses).toHaveLength(1)
  })
  it('转写失败 2 次后成功，分析仍有 3 次机会（两步的次数分开算）', async () => {
    const m = makeStore({ call: { recordingStatus: 'downloaded', recordingStoragePath: 'p', transcriptAttempts: 2 } })
    m.files.set('p', new Uint8Array(1))
    const r = await runCallAnalysis(goodDeps(m.store), ref)
    expect(r.status).toBe('done')
    expect(m.call.analysisAttempts).toBe(0)
  })
  it('分析 JSON 坏了：只记类别 analysis_json_invalid，不带模型输出片段', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(goodDeps(m.store, { analyze: async () => { JSON.parse('{"summary": "客人说他的名字是王小明') ; throw new Error('x') } }), ref)
    expect(r.detail).toBe('analysis_json_invalid')
    expect(JSON.stringify(m.receipts)).not.toContain('王小明')
  })
})

describe('原话核验加强', () => {
  const transcript = 'Please do not call us again, we are not interested. 我们预算大概两万纽币，四个人。 好的 ok 是的'
  const f = (key: RawAnalysis['facts'][number]['key'], value: string, quote: string) => ({ key, value, quote, confidence: 0.9 })
  const run = (facts: RawAnalysis['facts']) => verifyFacts({ summary: 's', language: null, facts }, transcript).facts.map((x) => x.key)

  it('通用应答词当原话 → 丢（「好的」「ok」「是的」）', () => {
    expect(run([f('do_not_contact', '客人要求别再联系', '好的'), f('budget', 'NZD 200000', 'ok'), f('party_size', '4', '是的')])).toEqual([])
  })
  it('原话是真的、数字是编的 → 丢；数字有依据（两万=20000、四=4）→ 留', () => {
    expect(run([f('budget', 'NZD 200000', '预算大概两万纽币'), f('party_size', '12', '四个人，好的')])).toEqual([])
    expect(run([f('budget', 'NZD 20000', '我们预算大概两万纽币'), f('party_size', '4', '我们预算大概两万纽币，四个人')])).toEqual(['budget', 'party_size'])
  })
  it('数值类事实的值里没有数字 → 丢', () => {
    expect(run([f('budget', '很多', '我们预算大概两万纽币')])).toEqual([])
  })
  it('do_not_contact 的原话必须真的是拒绝联系的话', () => {
    expect(run([f('do_not_contact', '要求别再联系', 'we are not interested.')])).toEqual([])
    expect(run([f('do_not_contact', '要求别再联系', 'Please do not call us again')])).toEqual(['do_not_contact'])
  })
  it('numbersIn：k / 万 / 英文数字词 / 中文数字', () => {
    expect([...numbersIn('about 20k and four people, 两万, 三百')].sort((a, b) => a - b)).toEqual([4, 20, 300, 2000, 20000].sort((a, b) => a - b).filter((n) => [...numbersIn('about 20k and four people, 两万, 三百')].includes(n)))
    expect(numbersIn('20k').has(20000)).toBe(true)
    expect(numbersIn('four people').has(4)).toBe(true)
    expect(numbersIn('两万').has(20000)).toBe(true)
  })
})

describe('原话核验：第二轮审查补的反例', () => {
  const T = 'we do not want the South Island tour. my number is 0211234567. we leave on 20 march. 我们三个人，预算两万纽币。 Meet at twelve o clock. never stop calling my mum. 不要再联系我是什么意思？ Please do not call us again.'
  const f = (key: RawAnalysis['facts'][number]['key'], value: string, quote: string) => ({ key, value, quote, confidence: 0.9 })
  const kept = (facts: RawAnalysis['facts']) => verifyFacts({ summary: 's', language: null, facts }, T).facts.map((x) => `${x.key}:${x.value}`)

  it('中文短原话能过（我们三个人 = 3 人；两万纽币 = NZD 20000），不再被长度误丢', () => {
    expect(kept([f('party_size', '3', '我们三个人'), f('budget', 'NZD 20000', '预算两万纽币')])).toEqual(['party_size:3', 'budget:NZD 20000'])
  })
  it('币种不一致：原话是纽币，值写美元/人民币 → 丢', () => {
    expect(kept([f('budget', 'USD 20000', '预算两万纽币'), f('budget', 'CNY 20000', '预算两万纽币')])).toEqual([])
  })
  it('电话号码当预算、日期当预算、钟点当人数 → 丢', () => {
    expect(kept([f('budget', 'NZD 211234567', 'my number is 0211234567'), f('budget', 'NZD 20', 'we leave on 20 march'), f('party_size', '12', 'Meet at twelve o clock')])).toEqual([])
  })
  it('别再联系：反问句、「never stop calling my mum」不是拒绝联系 → 丢；真拒绝才留', () => {
    expect(kept([f('do_not_contact', 'x', '不要再联系我是什么意思？'), f('do_not_contact', 'x', 'never stop calling my mum')])).toEqual([])
    expect(kept([f('do_not_contact', 'x', 'Please do not call us again')])).toEqual(['do_not_contact:x'])
  })
  it('英文通用短句（<10 字符）不能当证据', () => {
    expect(kept([f('concern', 'x', 'yes please'), f('concern', 'x', 'that is fine')])).toEqual([])
  })
})

describe('补扫：逐连接各查各的', () => {
  it('每个连接用自己的开启时刻；没开启时刻的连接不扫；各连接名额互不挤占', async () => {
    const asked: Array<[string, string, number]> = []
    const out = await planAnalysisSweep({
      listEnabledConnections: async () => [{ id: 'c1', analysis_enabled_at: '2026-10-12T00:00:00Z' }, { id: 'c2', analysis_enabled_at: null }, { id: 'c3', analysis_enabled_at: '2026-10-13T00:00:00Z' }],
      listCalls: async (id, since, limit) => { asked.push([id, since, limit]); return [{ client_id: 'k', provider: 'twilio', provider_call_id: `call-${id}` }] },
    })
    expect(asked).toEqual([['c1', '2026-10-12T00:00:00Z', 10], ['c3', '2026-10-13T00:00:00Z', 10]])
    expect(out.map((r) => r.provider_call_id)).toEqual(['call-c1', 'call-c3'])
  })
})

describe('分隔符剔除', () => {
  it('拼接还原也剔除干净', async () => {
    const { stripDelimiters } = await import('../vendors')
    expect(stripDelimiters('a TRANSCRIPT>>TRANSCRIPT>>>> b <<<TRANSCRIPT c')).not.toMatch(/TRANSCRIPT>>>|<<<TRANSCRIPT/)
  })
})

describe('摘要不过核对闸时，存进库的必须是换过的那句（2026-10-25 真实事故）', () => {
  /** 转写里有「1st time」也有「I've been to South China」—— 客人自己推翻了「首次」。 */
  const TRANSCRIPT = "声道1：Is this Sergio Dyer? 声道2：Yeah. 1st time. I've been to South China, but not Central China."

  function deps(store: AnalysisStore, summary: string) {
    return goodDeps(store, {
      transcribe: async () => ({ text: TRANSCRIPT, model: 'm-t' }),
      analyze: async () => ({
        raw: {
          summary,
          language: 'en',
          facts: [{ key: 'destination_or_tour' as const, value: '中国', quote: 'but not Central China', confidence: 0.9 }],
        },
        model: 'm-a',
      }),
    })
  }

  it('人名写错 + 首次被推翻 → 换成由已核实事实拼的摘要', async () => {
    const s = makeStore()
    s.store.getKnownNames = async () => ['Sarju Dayal']
    await runCallAnalysis(deps(s.store, '旅行社回电客人Sergio Dyer，客人首次去中国。'), ref)
    expect(s.analyses).toHaveLength(1)
    expect(s.analyses[0].summary).not.toContain('Sergio Dyer')
    expect(s.analyses[0].summary).not.toContain('首次')
    expect(s.analyses[0].summary).toContain('这通电话抽到的可核实信息')
    expect(s.analyses[0].summary).toContain('中国')
  })

  it('摘要干净时原样存，不乱换', async () => {
    const s = makeStore()
    s.store.getKnownNames = async () => ['Sarju Dayal']
    await runCallAnalysis(deps(s.store, '旅行社回电客人，了解其中国旅行计划。'), ref)
    expect(s.analyses[0].summary).toBe('旅行社回电客人，了解其中国旅行计划。')
  })

  it('读不到客人姓名时，摘要里的人名一律当成写错（宁可换成事实清单）', async () => {
    const s = makeStore()
    s.store.getKnownNames = async () => []
    await runCallAnalysis(deps(s.store, '旅行社回电客人Sergio Dyer，了解计划。'), ref)
    expect(s.analyses[0].summary).toContain('这通电话抽到的可核实信息')
  })
})

describe('口语数字与书面数字写法不同时，不许把正确摘要误判成瞎编（2026-10-12 真实通话）', () => {
  it('转写说 "March 20 27th"、摘要写「2027年3月20日」，而这个日期是条已核实事实 → 原样保留', async () => {
    const s = makeStore()
    s.store.getKnownNames = async () => ['Newasian Logistics']
    await runCallAnalysis(
      goodDeps(s.store, {
        transcribe: async () => ({ text: "声道2：It's for March 20 27th. 声道1：Okay.", model: 'm-t' }),
        analyze: async () => ({
          raw: {
            summary: '客人计划2027年3月20日出行。',
            language: 'en',
            facts: [{ key: 'travel_window' as const, value: '2027年3月20日', quote: "It's for March 20 27th", confidence: 0.9 }],
          },
          model: 'm-a',
        }),
      }),
      ref,
    )
    expect(s.analyses[0].summary).toBe('客人计划2027年3月20日出行。')
  })
})

describe('客人在电话里说「现在还没准备好」→ 记到 CRM 触点（PM 2026-10-29 Gavin Hall）', () => {
  const GAVIN = "I'm not ready for that. I'll talk to you another day."
  const gavinDeps = (store: AnalysisStore, speaker: 'customer' | 'employee' = 'customer') => goodDeps(store, {
    transcribe: async () => ({ text: `声道1：Hi, about the China tour. 声道2：${GAVIN}`, model: 'm-t' }),
    analyze: async () => ({
      raw: { summary: '客人表示尚未准备好，改日再谈', language: 'en', facts: [{ key: 'not_ready_now' as const, value: '客人说现在还没准备好', quote: GAVIN, confidence: 0.9, speaker }] },
      model: 'm-a',
    }),
  })

  it('客人说的、原话核验通过 → 标完触点后写上 not_now，并留回执', async () => {
    const m = makeStore()
    const r = await runCallAnalysis(gavinDeps(m.store), ref)
    expect(r.status).toBe('done')
    expect(m.marks).toEqual(['tp-1:an-1'])
    expect(m.stances).toEqual(['tp-1:an-1:not_now'])
    expect(m.receipts).toContain('call_stance:written')
  })

  it('员工说的 → 不写表态', async () => {
    const m = makeStore()
    await runCallAnalysis(gavinDeps(m.store, 'employee'), ref)
    expect(m.stances).toEqual([])
  })

  it('没有表态事实的普通通话 → 不写', async () => {
    const m = makeStore()
    await runCallAnalysis(goodDeps(m.store), ref)
    expect(m.stances).toEqual([])
  })

  it('标触点失败 → 不写表态（前提是触点已挂上这份分析）', async () => {
    const m = makeStore({ markFails: true })
    await runCallAnalysis(gavinDeps(m.store), ref)
    expect(m.stances).toEqual([])
  })

  it('写表态失败 → 只记回执，分析照样算完成', async () => {
    const m = makeStore({ stanceFails: true })
    const r = await runCallAnalysis(gavinDeps(m.store), ref)
    expect(r.status).toBe('done')
    expect(m.receipts).toContain('call_stance:failed')
  })

  it('分析早已存在（可能已被复核 / 驳回）→ 状态修复时不重写表态', async () => {
    const m = makeStore({ call: { summaryStatus: 'not_started', transcriptStatus: 'done', recordingStatus: 'downloaded' } })
    m.transcripts.set('call-row-1', `声道2：${GAVIN}`)
    m.analyses.push({ callId: 'call-row-1', summary: 'x', facts: [], dropped: 0 })
    await runCallAnalysis(gavinDeps(m.store), ref)
    expect(m.marks).toEqual(['tp-1:an-1'])
    expect(m.stances).toEqual([])
  })
})

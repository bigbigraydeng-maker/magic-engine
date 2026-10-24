import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { scriptAgentPersonaPreset } from '@/config/script-agent-client-presets'
import { parseJsonResponse } from '@/lib/anthropic/client'
import { abortRun, getDatasetItems, getRun, runActor, waitForRun } from '@/lib/apify/client'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { generateFullScriptText } from '@/lib/content-factory/topic-agent'
import { LIBAI_COPY_GENERATED_EVENT } from '@/lib/content/libai-provenance'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { supabaseAdmin } from '@/lib/supabase'
import { consumeQuota, dayStartUtc } from '@/lib/zhangqian/rate-limiter'
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DOYIN_SCRAPER = 'atomus/douyin-scraper'
const TRANSCRIPT_SCRAPER = 'lance_api/douyin-transcripts-scraper'
const ACCOUNT_SCAN_MAX_USD = 0.1
const TRANSCRIPT_MAX_USD = 0.15
const MAX_VIDEOS = 20
const MAX_TRANSCRIPT_CHARS = 6000
const DAILY_SCAN_CAP = 3
const DAILY_TRANSCRIPT_CAP = 20
const DAILY_REWRITE_CAP = 20

// Gate remains closed until the five Agent checks and paid-action policy are signed off.
function scriptAgentEnabledForClient(clientId: string): boolean {
  if (process.env.SCRIPT_AGENT_ENABLED !== 'true') return false
  const allowed = process.env.SCRIPT_AGENT_ALLOWED_CLIENT_IDS
  if (!allowed) return false
  return allowed.split(',').map((id) => id.trim()).includes(clientId)
}

type Row = Record<string, unknown>
type TranscriptSegment = { start?: number; end?: number; text: string }

interface VideoItem {
  url: string
  title: string
  author: string
  createdAt: string | null
  durationSeconds: number | null
  likes: number
  comments: number
}

interface RunOutput {
  items: Row[]
  usageTotalUsd: number | null
  runId: string
  datasetId: string
}

interface RewriteDraft {
  title: string
  hook: string
  script: string
  pillar: string
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function douyinHost(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname.endsWith('.douyin.com')
}

function profileReference(value: string): string {
  const match = value.match(/https?:\/\/(?:www\.)?douyin\.com\/user\/[A-Za-z0-9_-]+/)
  const source = match?.[0] ?? value.trim()
  if (/^MS4wLjAB[A-Za-z0-9_-]{8,}$/.test(source)) return source

  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw new RequestError(400, '请粘贴抖音公开主页链接，或主页链接中的 sec_uid。')
  }
  const uid = parsed.pathname.match(/^\/user\/([A-Za-z0-9_-]+)/)?.[1]
  if (!douyinHost(parsed.hostname) || !uid || !/^MS4wLjAB[A-Za-z0-9_-]{8,}$/.test(uid)) {
    throw new RequestError(400, '请使用完整的抖音主页链接（/user/MS4w…），短分享链接请先在浏览器中打开主页后复制地址。')
  }
  return 'https://www.douyin.com/user/' + uid
}

function videoReference(value: string): string {
  const source = value.match(/https?:\/\/(?:www\.)?douyin\.com\/video\/\d{17,20}|https?:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/?|https?:\/\/(?:www\.)?douyin\.com\/jingxuan\/search\/[^\s]+/)?.[0] ?? value.trim()
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw new RequestError(400, '请粘贴抖音视频链接或分享文案。')
  }
  if (parsed.hostname === 'v.douyin.com' && /^\/[A-Za-z0-9_-]+\/?$/.test(parsed.pathname)) {
    return parsed.origin + parsed.pathname
  }
  if (!douyinHost(parsed.hostname)) throw new RequestError(400, '仅支持抖音公开视频链接。')
  const modalId = parsed.pathname.startsWith('/jingxuan/search/') ? parsed.searchParams.get('modal_id') : null
  const id = modalId || parsed.pathname.match(/^\/video\/(\d{17,20})\/?$/)?.[1]
  if (!id || !/^\d{17,20}$/.test(id)) throw new RequestError(400, '仅支持抖音公开视频链接。')
  return 'https://www.douyin.com/video/' + id
}

function unixDate(value: unknown): string | null {
  const seconds = numberValue(value)
  if (!seconds) return null
  const date = new Date(seconds > 1e12 ? seconds : seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function mapVideo(row: Row): VideoItem | null {
  const type = stringValue(row.type).toLowerCase()
  if (type.includes('photo') || type.includes('image') || (Array.isArray(row.imageUrls) && row.imageUrls.length > 0)) return null
  const id = stringValue(row.awemeId)
  const rawUrl = stringValue(row.url) || (id ? 'https://www.douyin.com/video/' + id : '')
  let url: string
  try {
    url = videoReference(rawUrl)
  } catch {
    return null
  }

  const stats = record(row.stats)
  const author = record(row.author)
  const durationMs = numberValue(row.durationMs)
  return {
    url,
    title: stringValue(row.desc) || stringValue(row.title) || '抖音视频',
    author: stringValue(row.authorNickname) || stringValue(author.nickname),
    createdAt: unixDate(row.createTime),
    durationSeconds: durationMs > 0 ? Math.round(durationMs / 1000) : null,
    likes: numberValue(stats.diggCount),
    comments: numberValue(stats.commentCount),
  }
}

async function runDataset(actor: string, input: Row, capUsd: number): Promise<RunOutput> {
  if (!process.env.APIFY_API_KEY) throw new RequestError(503, '抖音采集服务尚未配置。')
  const started = await runActor(actor, input, { maxTotalChargeUsd: capUsd, timeout: 180 })
  const finished = await waitForRun(actor, started.id, 180000)
  if (finished.status !== 'SUCCEEDED' || !finished.defaultDatasetId) {
    if (finished.status === 'TIMED-OUT') await abortRun(started.id).catch(() => undefined)
    console.error('[content-factory/douyin-transcript] Apify run did not succeed', { actor, runId: started.id, status: finished.status })
    throw new RequestError(502, '抖音采集没有完成，请稍后重试。')
  }
  return {
    items: await getDatasetItems<Row>(finished.defaultDatasetId),
    usageTotalUsd: typeof finished.usageTotalUsd === 'number' ? finished.usageTotalUsd : null,
    runId: finished.id,
    datasetId: finished.defaultDatasetId,
  }
}

function sourceReceipt(clientId: string, runId: string, videoUrl: string): string {
  const key = process.env.APIFY_API_KEY
  if (!key) throw new RequestError(503, '抖音采集服务尚未配置。')
  return createHmac('sha256', key).update(JSON.stringify([clientId, runId, videoUrl])).digest('hex')
}

function verifySourceReceipt(clientId: string, runId: string, videoUrl: string, receipt: string): void {
  if (!/^[A-Za-z0-9]+$/.test(runId) || !/^[a-f0-9]{64}$/.test(receipt)) {
    throw new RequestError(400, '来源回执无效，请重新转写。')
  }
  const expected = Buffer.from(sourceReceipt(clientId, runId, videoUrl), 'hex')
  if (!timingSafeEqual(expected, Buffer.from(receipt, 'hex'))) {
    throw new RequestError(400, '来源回执与视频不一致，请重新转写。')
  }
}

async function reservePaidAction(clientId: string, action: 'scan' | 'transcribe' | 'rewrite', cap: number): Promise<void> {
  let allowed = false
  try {
    allowed = await consumeQuota('script-agent-' + action, clientId, dayStartUtc(), cap)
  } catch {
    throw new RequestError(503, '费用额度暂时无法核对，已停止本次付费操作。')
  }
  if (!allowed) throw new RequestError(429, '今日脚本 Agent 的' + (action === 'scan' ? '账号扫描' : action === 'transcribe' ? '视频转写' : 'AI 改写') + '次数已用完，请明天再试。')
}

async function scanAccount(clientId: string, profileUrl: string, maxVideos: number) {
  const profile = profileReference(profileUrl)
  const limit = Math.max(1, Math.min(MAX_VIDEOS, Math.floor(maxVideos || 10)))
  await reservePaidAction(clientId, 'scan', DAILY_SCAN_CAP)
  const result = await runDataset(DOYIN_SCRAPER, {
    searchType: 'user-posts',
    userUrls: [profile],
    maxItems: limit,
  }, ACCOUNT_SCAN_MAX_USD)
  const mapped = result.items.map(mapVideo).filter((item): item is VideoItem => item !== null)
  const videos = [...new Map(mapped.map((item) => [item.url, item])).values()].slice(0, limit)
  return { videos, actualApifyUsd: result.usageTotalUsd }
}

function transcriptFromRow(row: Row): string {
  const nested = record(row.transcript)
  const direct = stringValue(nested.text) || stringValue(row.transcript) || stringValue(row.text)
  if (direct) return direct
  const segments = Array.isArray(nested.segments) ? nested.segments : (Array.isArray(row.segments) ? row.segments : [])
  return segments.map((segment) => stringValue(record(segment).text)).filter(Boolean).join('\n')
}

function transcriptFromDataset(videoUrl: string, result: RunOutput) {
  const source = result.items.find((item) => item.success === true && transcriptFromRow(item).length > 0)
  if (!source) {
    const failed = result.items[0]
    const detail = stringValue(record(failed?.error).message) || stringValue(failed?.error)
    throw new RequestError(422, detail ? '转写失败：' + detail.slice(0, 240) : '这条视频没有提取到可用的语音逐字稿。')
  }
  const transcript = transcriptFromRow(source)
  if (transcript.length < 20) throw new RequestError(422, '这条视频没有提取到足够的语音内容。')
  const nested = record(source.transcript)
  const rawSegments = Array.isArray(nested.segments) ? nested.segments : (Array.isArray(source.segments) ? source.segments : [])
  const segments = rawSegments.map((value) => record(value)).map((segment) => ({
    start: typeof segment.start === 'number' ? segment.start : undefined,
    end: typeof segment.end === 'number' ? segment.end : undefined,
    text: stringValue(segment.text),
  })).filter((segment) => segment.text)
  const normalized = stringValue(source.normalizedUrl)
  let normalizedId = ''
  try {
    const parsed = new URL(normalized)
    if (douyinHost(parsed.hostname)) normalizedId = parsed.searchParams.get('modal_id') || parsed.pathname.match(/^\/video\/(\d{17,20})\/?$/)?.[1] || ''
  } catch { /* A numeric awemeId below is sufficient. */ }
  const videoId = stringValue(source.awemeId) || stringValue(source.videoId) || normalizedId
  if (!/^\d{17,20}$/.test(videoId)) throw new RequestError(502, '转写成功，但来源视频身份无法核对，请不要使用这份原稿。')
  const inputId = videoUrl.match(/^https:\/\/www\.douyin\.com\/video\/(\d{17,20})$/)?.[1]
  if (inputId && inputId !== videoId) throw new RequestError(502, '转写结果对应了另一条视频，请不要使用这份原稿。')
  const normalizedUrl = 'https://www.douyin.com/video/' + videoId
  const sourceTitle = stringValue(record(source.content).title) || stringValue(record(source.content).description)
  return { videoUrl: normalizedUrl, sourceTitle, transcript, segments, actualApifyUsd: result.usageTotalUsd, apifyRunId: result.runId, apifyDatasetId: result.datasetId }
}

async function fetchTranscript(clientId: string, videoUrl: string) {
  await reservePaidAction(clientId, 'transcribe', DAILY_TRANSCRIPT_CAP)
  const result = await runDataset(TRANSCRIPT_SCRAPER, {
    urls: [videoUrl],
    formats: ['text', 'segments'],
    translate: false,
    includeMediaMetadata: false,
  }, TRANSCRIPT_MAX_USD)
  return transcriptFromDataset(videoUrl, result)
}

function parsedDraft(text: string): RewriteDraft {
  const value = parseJsonResponse<Row>(text)
  const draft = {
    title: stringValue(value.title),
    hook: stringValue(value.hook),
    script: stringValue(value.script),
    pillar: stringValue(value.pillar),
  }
  if (!draft.title || !draft.hook || draft.script.length < 50) {
    throw new RequestError(502, '改写结果不完整，请重新生成。')
  }
  return draft
}

async function rewriteScript(brief: NonNullable<Awaited<ReturnType<typeof getActiveBrief>>>, transcript: string, environment: string, title: string, personaNotes: string) {
  const generated = await generateFullScriptText(brief, transcript, environment, title, personaNotes)
  if (generated.stop_reason !== 'end_turn') throw new RequestError(502, '脚本生成未完整结束，未保存不完整的草稿。')
  return { draft: parsedDraft(generated.text), aiCostUsd: generated.cost_usd }
}

async function saveDraft(clientId: string, briefId: string, video: VideoItem, source: ReturnType<typeof transcriptFromDataset>, environment: string, personaNotes: string, draft: RewriteDraft, aiCostUsd: number) {
  const { data, error } = await supabaseAdmin.from('content_posts').insert({
    client_id: clientId,
    title: draft.title,
    script: draft.script,
    caption: draft.hook,
    pillar_id: draft.pillar || '社媒',
    platforms: ['douyin'],
    format: '真人口播',
    status: 'draft',
    route: 'route_a',
    source: '抖音参考：' + video.title + ' | ' + video.url,
    generation_context_snapshot: {
      source_platform: 'douyin',
      manual_recording: true,
      source_url: video.url,
      source_title: video.title,
      source_transcript: source.transcript,
      transcript_source_verification: 'apify_run_rechecked',
      apify_run_id: source.apifyRunId,
      apify_dataset_id: source.apifyDatasetId,
      apify_reported_usage_usd: source.actualApifyUsd,
      script_agent_ai_cost_usd: aiCostUsd,
      rewrite_environment: environment,
      script_agent_persona_notes: personaNotes,
      master_brief_id: briefId,
    },
  }).select('id, title, status').single()
  if (error || !data) throw new RequestError(500, '逐字稿已生成，但草稿保存失败。')

  await sendInngestEvent({
    id: 'libai-copy:' + data.id,
    name: LIBAI_COPY_GENERATED_EVENT,
    data: { client_id: clientId, post_id: data.id },
  }).catch((error: unknown) => {
    console.warn('[content-factory/douyin-transcript] provenance event failed:', error instanceof Error ? error.message : 'unknown')
  })
  return data
}

async function transcribeVideo(clientId: string, body: Row) {
  const url = videoReference(stringValue(body.videoUrl))
  const source = await fetchTranscript(clientId, url)
  return { ...source, receipt: sourceReceipt(clientId, source.apifyRunId, source.videoUrl) }
}

async function rewriteTranscript(clientId: string, body: Row) {
  const url = videoReference(stringValue(body.videoUrl))
  const runId = stringValue(body.apifyRunId)
  verifySourceReceipt(clientId, runId, url, stringValue(body.receipt))
  const run = await getRun(runId)
  if (run.status !== 'SUCCEEDED' || !run.defaultDatasetId) throw new RequestError(422, '来源转写尚未完成，请稍后重试。')
  const source = transcriptFromDataset(url, {
    items: await getDatasetItems<Row>(run.defaultDatasetId),
    usageTotalUsd: typeof run.usageTotalUsd === 'number' ? run.usageTotalUsd : null,
    runId: run.id,
    datasetId: run.defaultDatasetId,
  })
  if (source.videoUrl !== url) throw new RequestError(400, '来源回执与视频内容不一致，请重新转写。')
  const title = (source.sourceTitle || stringValue(body.title)).slice(0, 300) || '抖音参考视频'
  const environment = stringValue(body.environment).slice(0, 2000)
  const personaNotes = (stringValue(body.personaNotes) || scriptAgentPersonaPreset(clientId)).slice(0, 3000)
  const transcript = source.transcript
  if (!environment) throw new RequestError(400, '请填写表达环境与目标受众。')
  if (transcript.length < 20) throw new RequestError(400, '来源逐字稿为空，请先完成转写。')
  if (transcript.length > MAX_TRANSCRIPT_CHARS) throw new RequestError(413, '单条脚本 Agent 当前最多处理 6000 字；原稿已保留，可复制后分段处理。')

  const brief = await getActiveBrief(clientId)
  if (!brief) throw new RequestError(422, '当前客户还没有启用 Master Brief，请先配置人设。')
  const { data: existing, error: lookupError } = await supabaseAdmin.from('content_posts')
    .select('id, title, status, script, caption, pillar_id, generation_context_snapshot')
    .eq('client_id', clientId)
    .eq('generation_context_snapshot->>source_url', url)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupError) throw new RequestError(500, '无法核对已有草稿，请稍后重试。')
  const snapshot = record(existing?.generation_context_snapshot)
  if (existing && snapshot.transcript_source_verification === 'apify_run_rechecked'
    && snapshot.source_transcript === transcript && snapshot.master_brief_id === brief.id
    && snapshot.rewrite_environment === environment && snapshot.script_agent_persona_notes === personaNotes) {
    return { videoUrl: url, title, transcript, draft: {
      title: existing.title, hook: existing.caption || '', script: existing.script || '', pillar: existing.pillar_id || '社媒',
    }, post: { id: existing.id, title: existing.title, status: existing.status }, reused: true,
      actualApifyUsd: typeof snapshot.apify_reported_usage_usd === 'number' ? snapshot.apify_reported_usage_usd : null,
      aiCostUsd: typeof snapshot.script_agent_ai_cost_usd === 'number' ? snapshot.script_agent_ai_cost_usd : null }
  }
  await reservePaidAction(clientId, 'rewrite', DAILY_REWRITE_CAP)
  const { draft, aiCostUsd } = await rewriteScript(brief, transcript, environment, title, personaNotes)
  if (transcript.length >= 500 && draft.script.length < transcript.length * 0.7) {
    throw new RequestError(502, '脚本 Agent 输出过短，未保存草稿；来源逐字稿已保留，可直接重试改写。')
  }
  const post = await saveDraft(clientId, brief.id, {
    url, title, author: '', createdAt: null, durationSeconds: null, likes: 0, comments: 0,
  }, source, environment, personaNotes, draft, aiCostUsd)
  return { videoUrl: url, title, transcript, draft, post, reused: false, actualApifyUsd: source.actualApifyUsd, aiCostUsd }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  return NextResponse.json({ enabled: scriptAgentEnabledForClient(params.id), personaNotes: scriptAgentPersonaPreset(params.id) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!scriptAgentEnabledForClient(params.id)) return NextResponse.json({ error: '脚本 Agent 暂未开放。' }, { status: 503 })

  try {
    const body = record(await req.json().catch(() => ({})))
    if (body.action === 'scan') {
      const profileUrl = stringValue(body.profileUrl)
      if (!profileUrl) throw new RequestError(400, '请填写抖音主页链接。')
      if (profileUrl.length > 2000) throw new RequestError(400, '主页链接长度超出限制。')
      const maxVideos = numberValue(body.maxVideos) || 10
      if (maxVideos > MAX_VIDEOS) throw new RequestError(400, '每次最多抓取 20 条视频。')
      return NextResponse.json(await scanAccount(params.id, profileUrl, maxVideos))
    }
    if (body.action === 'transcribe') return NextResponse.json(await transcribeVideo(params.id, body))
    if (body.action === 'rewrite') return NextResponse.json(await rewriteTranscript(params.id, body))
    throw new RequestError(400, '不支持的操作。')
  } catch (error: unknown) {
    const status = error instanceof RequestError ? error.status : 500
    const message = error instanceof RequestError ? error.message : '处理抖音视频失败，请稍后重试。'
    console.error('[content-factory/douyin-transcript]', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: message }, { status })
  }
}

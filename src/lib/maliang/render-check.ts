// 马良 · 出片分镜自检（agent 自治计划 B2）。CLAUDE.md 铁律 8 要求成片交付前出「分镜自检表」：
// 截 9 宫格逐镜看 ①图对不对 ②字对不对 ③logo 全不全——此前靠人记。这里把成片交给视频理解模型
// （Gemini，走 viral-analyzer 同款 Files API 路径），按 0%/12.5%/…/100% 九个时刻逐镜回答同样
// 三问，纯函数出裁决。只出裁决，不发布、不改片。读不到（下载失败 / 没钥匙 / 回答格式不对）=
// 不判，记 unverifiable，绝不给「过关」默认值。

import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { safeProbeRemoteFile } from '@/lib/factory/safe-remote-fetch'
import { reconcileTextOnlyMiss } from '@/lib/maliang/text-compare'

export const NINE_GRID_PCTS = [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100] as const
export const MALIANG_MODEL = 'gemini-2.5-flash'
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024
export const SNAPSHOT_KEY = 'maliang_check'

export interface NineGridFrame {
  t_pct: number
  image_ok: boolean
  image_note: string
  text_seen: string
  text_ok: boolean
  text_note: string
  logo_seen: boolean
  logo_ok: boolean
  logo_note: string
}

export interface NineGridResult {
  frames: NineGridFrame[]
  overall_note: string
}

export type MaliangStatus = 'pass' | 'fail' | 'unverifiable'

export interface MaliangCheck {
  status: MaliangStatus
  checked_at: string
  video_url: string
  reasons: string[]
  frames: NineGridFrame[]
  model: string | null
  /** Untruncated on-screen lines the text recheck compared against. */
  expected_text?: string[]
  /** Set when a text-only miss matched the picture after normalizing case and line breaks. */
  text_recheck?: 'false_positive' | null
}

export interface NineGridInput {
  title: string
  brandName: string
  expectedCaptions: string[]
  /** Lines used for the text recheck. Falls back to expectedCaptions when omitted. */
  compareLines?: string[]
  visualNotes: string[]
  logoExpected: boolean
}

export type VideoAnalyzer = (filePath: string, prompt: string, apiKey: string) => Promise<string>

// ─── Prompt ───────────────────────────────────────────────────────────────────

export function buildNineGridPrompt(input: NineGridInput): string {
  const { title, brandName, expectedCaptions, visualNotes, logoExpected } = input
  const pcts = NINE_GRID_PCTS.map((p) => `${p}%`).join(', ')
  const captions = expectedCaptions.length
    ? expectedCaptions.map((c, i) => `  ${i + 1}. ${c}`).join('\n')
    : '  (none specified)'
  const visuals = visualNotes.length
    ? visualNotes.map((v, i) => `  ${i + 1}. ${v}`).join('\n')
    : '  (none specified)'
  const logoLine = logoExpected
    ? 'A brand logo or watermark IS expected to appear in this video.'
    : 'No brand logo or watermark is expected in this video — but still report what you actually see.'

  return `This is a vertical marketing video for "${brandName}", titled "${title}".

Inspect the frame at each of these 9 moments (percentages of total duration): ${pcts}.

For EACH moment, answer three questions:

1. IMAGE — image_ok: does the picture show a plausible, real-looking scene consistent with the expected shot list below? Mark false for melted faces, garbled architecture, wrong landmark, or obvious AI artefacts.
   Expected shot list:
${visuals}

2. TEXT — text_seen: transcribe ALL on-screen text exactly as it appears (empty string if none).
   text_ok: is the text legible, correctly spelled, not cut off by the frame edge, and matching the expected captions below (when one shows)?
   Expected captions:
${captions}

3. LOGO — logo_seen: is a brand logo or watermark visible in this frame?
   logo_ok: is it complete (not cropped, not covered, not blurred)?
   ${logoLine}

Be strict: when unsure, mark ok=false and explain why in the note.

Output ONLY JSON — no markdown, no explanation:
{"frames":[{"t_pct":0,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":12.5,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":25,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":37.5,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":50,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":62.5,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":75,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":87.5,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""},{"t_pct":100,"image_ok":true,"image_note":"","text_seen":"","text_ok":true,"text_note":"","logo_seen":true,"logo_ok":true,"logo_note":""}],"overall_note":""}`
}

// ─── Response parser ──────────────────────────────────────────────────────────

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function parseFrame(raw: unknown, index: number): NineGridFrame {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`模型回答格式不对：第 ${index + 1} 镜不是对象`)
  }
  const f = raw as Record<string, unknown>
  if (typeof f.t_pct !== 'number') {
    throw new Error(`模型回答格式不对：第 ${index + 1} 镜 t_pct 不是数字`)
  }
  for (const key of ['image_ok', 'text_ok', 'logo_seen', 'logo_ok'] as const) {
    if (typeof f[key] !== 'boolean') {
      throw new Error(`模型回答格式不对：第 ${index + 1} 镜 ${key} 不是布尔值`)
    }
  }
  return {
    t_pct: f.t_pct,
    image_ok: f.image_ok as boolean,
    image_note: asString(f.image_note),
    text_seen: asString(f.text_seen),
    text_ok: f.text_ok as boolean,
    text_note: asString(f.text_note),
    logo_seen: f.logo_seen as boolean,
    logo_ok: f.logo_ok as boolean,
    logo_note: asString(f.logo_note),
  }
}

export function parseNineGridResponse(raw: string): NineGridResult {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error('模型回答格式不对：不是合法 JSON')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('模型回答格式不对：顶层不是对象')
  }
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.frames)) {
    throw new Error('模型回答格式不对：缺少 frames 数组')
  }
  if (obj.frames.length !== 9) {
    throw new Error(`模型回答格式不对：frames 应为 9 个，实际 ${obj.frames.length} 个`)
  }
  const frames = obj.frames.map((f, i) => parseFrame(f, i))
  return { frames, overall_note: asString(obj.overall_note) }
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

export function decideVerdict(
  result: NineGridResult,
  logoExpected: boolean,
): { status: 'pass' | 'fail'; reasons: string[] } {
  const reasons: string[] = []
  let anyLogoSeen = false

  result.frames.forEach((f, i) => {
    const n = i + 1
    if (!f.image_ok) reasons.push(`第 ${n} 镜画面：${f.image_note || '模型判不对'}`)
    if (!f.text_ok) reasons.push(`第 ${n} 镜文字：${f.text_note || '模型判不对'}`)
    if (f.logo_seen) anyLogoSeen = true
    if (logoExpected && f.logo_seen && !f.logo_ok) {
      reasons.push(`第 ${n} 镜 logo：${f.logo_note || '不完整'}`)
    }
  })

  if (logoExpected && !anyLogoSeen) {
    reasons.push('全片 9 镜都没看到 logo/水印')
  }

  return { status: reasons.length > 0 ? 'fail' : 'pass', reasons }
}

// ─── Snapshot merge / read ────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function mergeMaliangIntoSnapshot(
  current: unknown,
  check: MaliangCheck,
): Record<string, unknown> {
  const base = isPlainObject(current) ? { ...current } : {}
  base[SNAPSHOT_KEY] = check
  return base
}

export function readMaliangFromSnapshot(snapshot: unknown): MaliangCheck | null {
  if (!isPlainObject(snapshot)) return null
  const raw = snapshot[SNAPSHOT_KEY]
  if (!isPlainObject(raw)) return null

  const status = raw.status
  if (status !== 'pass' && status !== 'fail' && status !== 'unverifiable') return null
  if (typeof raw.checked_at !== 'string') return null
  if (!Array.isArray(raw.reasons)) return null
  const reasons = raw.reasons.filter((r): r is string => typeof r === 'string')
  if (reasons.length !== raw.reasons.length) return null
  if (!Array.isArray(raw.frames)) return null
  // 逐帧只验最小形状（时刻 + 画面判定），不深验——写入方是本模块自己，读方只需要能判状态
  const frames = raw.frames.filter(isFrameLike)
  if (frames.length !== raw.frames.length) return null

  return {
    status,
    checked_at: raw.checked_at,
    video_url: typeof raw.video_url === 'string' ? raw.video_url : '',
    reasons,
    frames,
    model: typeof raw.model === 'string' ? raw.model : null,
  }
}

function isFrameLike(v: unknown): v is NineGridFrame {
  return isPlainObject(v) && typeof v.t_pct === 'number' && typeof v.image_ok === 'boolean'
}

// ─── Allowed hosts ────────────────────────────────────────────────────────────

/** 只信任本项目 Supabase Storage 的主机（store-result.ts 把 Creatomate 产物转存到那）。
 *  env 参数放宽成普通字典，测试能传字面量对象。 */
export function allowedVideoHosts(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return []
  try {
    return [new URL(raw).hostname]
  } catch {
    return []
  }
}

// ─── Download ─────────────────────────────────────────────────────────────────

export async function downloadVideoToTmp(
  url: string,
  allowedHosts: readonly string[],
): Promise<string> {
  if (allowedHosts.length === 0) {
    throw new Error('没有配置允许下载的视频主机（NEXT_PUBLIC_SUPABASE_URL）')
  }

  const probe = await safeProbeRemoteFile(url, 20000, allowedHosts)
  if (!probe.ok || !probe.finalUrl) {
    throw new Error(probe.error ?? '视频链接校验失败')
  }

  const res = await fetch(probe.finalUrl, { signal: AbortSignal.timeout(120000) })
  if (!res.ok) {
    throw new Error(`视频下载失败：HTTP ${res.status}`)
  }

  const buf = await res.arrayBuffer()
  if (buf.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(`视频太大（${buf.byteLength} 字节 > ${MAX_VIDEO_BYTES}）`)
  }

  const filePath = path.join(tmpdir(), `maliang_${Date.now()}.mp4`)
  await writeFile(filePath, Buffer.from(buf))
  return filePath
}

// ─── Gemini Files API ─────────────────────────────────────────────────────────

const GEMINI_TIMEOUT_MS = 90_000

export async function analyzeVideoWithGemini(
  filePath: string,
  prompt: string,
  apiKey: string,
): Promise<string> {
  const fileManager = new GoogleAIFileManager(apiKey)
  const uploadResult = await fileManager.uploadFile(filePath, {
    mimeType: 'video/mp4',
    displayName: `maliang_${Date.now()}`,
  })

  let fileInfo = uploadResult.file
  let attempts = 0
  while (fileInfo.state === 'PROCESSING' && attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000))
    fileInfo = await fileManager.getFile(fileInfo.name)
    attempts++
  }
  if (fileInfo.state !== 'ACTIVE') {
    throw new Error(`Gemini 文件未就绪（state: ${fileInfo.state}）`)
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({ model: MALIANG_MODEL })

  const result = await Promise.race([
    model.generateContent([
      { fileData: { fileUri: fileInfo.uri, mimeType: 'video/mp4' } },
      { text: prompt },
    ]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Gemini 调用超时（${GEMINI_TIMEOUT_MS / 1000}s）`)), GEMINI_TIMEOUT_MS),
    ),
  ])

  fileManager.deleteFile(fileInfo.name).catch(() => {})

  return result.response.text()
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function runNineGridCheck(params: {
  videoUrl: string
  input: NineGridInput
  apiKey: string | undefined
  analyze?: VideoAnalyzer
  allowedHosts?: readonly string[]
  now?: Date
}): Promise<MaliangCheck> {
  const { videoUrl, input, apiKey, analyze, allowedHosts, now } = params
  const checkedAt = (now ?? new Date()).toISOString()

  const unverifiable = (reason: string): MaliangCheck => ({
    status: 'unverifiable',
    checked_at: checkedAt,
    video_url: videoUrl,
    reasons: [reason],
    frames: [],
    model: null,
  })

  if (!apiKey) {
    return unverifiable('GEMINI_API_KEY 未配置，马良看不了片')
  }

  const hosts = allowedHosts ?? allowedVideoHosts()
  const analyzer = analyze ?? analyzeVideoWithGemini
  const prompt = buildNineGridPrompt(input)

  let tmpPath: string | null = null
  try {
    try {
      tmpPath = await downloadVideoToTmp(videoUrl, hosts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return unverifiable(`视频下载失败：${msg}`)
    }

    let raw: string
    try {
      raw = await analyzer(tmpPath, prompt, apiKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return unverifiable(`模型调用失败：${msg}`)
    }

    let parsed: NineGridResult
    try {
      parsed = parseNineGridResponse(raw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return unverifiable(`模型回答格式不对：${msg}`)
    }

    const verdict = reconcileTextOnlyMiss(
      decideVerdict(parsed, input.logoExpected),
      parsed.frames,
      input.compareLines ?? input.expectedCaptions,
    )
    return {
      status: verdict.status,
      checked_at: checkedAt,
      video_url: videoUrl,
      reasons: verdict.reasons,
      frames: parsed.frames,
      model: MALIANG_MODEL,
      expected_text: input.compareLines ?? input.expectedCaptions,
      text_recheck: verdict.text_recheck,
    }
  } finally {
    if (tmpPath) unlink(tmpPath).catch(() => {})
  }
}

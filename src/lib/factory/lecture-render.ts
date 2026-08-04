// 讲课式做片 — 「上课件 slide + 下真人」上下分屏成片。只在 worker 容器里跑(需 ffmpeg + python-PIL)。
//
// 自己录(self_record)：下载 PM 录的整段视频 → 抽音轨给 Whisper 听写 → 按脚本对轴(lecture-align)
//   → PIL 画课件/字幕 PNG → 一次 ffmpeg 合成(底色 + 下半人像 + 上半课件按段换页 + 短句大字字幕)。
// 数字人(digital_human)：逐段 MiniMax 克隆声配音 → omnihuman 出口播人像段 → 同一套合成。
//   ⚠️ 线已接好但未实测(生成要花钱，PM 拍板先不烧)；模型名/入参以首跑实测为准。
//
// 布局(1080x1920)：上半 0-960 课件(内容下沉避开平台 UI 顶部遮挡)，下半 960-1920 人像，
// 字幕在 y≈1150 起的横带(Reel 安全区内、落在人像胸口高度)。配色走客户 master_brief.vi_colors。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase'
import { generateVoiceover } from '@/lib/audio/minimax-voice'
import { runMuapi } from '@/lib/muapi/client'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { loadLecturePost, saveTranscriptAndCaptions } from './lecture-post'
import { detectActiveRegion, planClipFit } from './screen-clip'
import type { LectureScript } from './lecture-script'
import {
  alignPartsToSegments,
  findHeadStart,
  splitSubtitleChunks,
  type SubtitleChunk,
  type TimedPart,
  type TranscriptSegment,
} from './lecture-align'

const exec = promisify(execFile)
const BUCKET = 'content-factory'

/** 分步日志:做片是长活，出问题必须一眼看出死在哪一步(Render 日志里直接可读)。 */
function step(jobId: string, msg: string): void {
  console.log(`[lecture ${jobId.slice(0, 8)}] ${new Date().toISOString()} ${msg}`)
}
const CJK_FONT = process.env.FACTORY_CJK_FONT || '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
// 数字人模型(Muapi)。⚠️ 未实测：首跑前确认 slug 与入参(见文件头)。
const OMNIHUMAN_MODEL = 'omnihuman-1-5'

const W = 1080
const H = 1920
const SLIDE_H = 960          // 上半课件高
// 字幕带 y(全帧坐标)。1020 太高会压在脸上(PM 首片反馈)，下移到人像胸口高度；
// 底部 ~1248 是 Reel 安全区下沿(再低会被平台 UI 盖住)，68px 字 + 描边刚好卡在里面。
const SUB_Y = 1150

interface SlideColors {
  bg: string
  text: string
  accent: string
}
const DEFAULT_COLORS: SlideColors = { bg: '#1A1A2E', text: '#FFFFFF', accent: '#E94560' }

/**
 * 更新任务(带防复活守卫)：任务若已被卡死回收(failed)，绝不改回活状态——
 * 否则被回收后 PM 重排的新任务和原 worker 会重复做片、双倍花钱(魏征 M3)。
 * 被回收时抛错，让当前 worker 停手。
 */
async function patchJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  // 写状态失败不该让整单白干:网络抖一下重试两次
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data, error } = await supabaseAdmin
        .from('content_factory_render_jobs')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .neq('status', 'failed')
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) throw new Error('任务已被回收(超时标失败)，本次做片作废')
      return
    } catch (e) {
      if (e instanceof Error && e.message.includes('已被回收')) throw e
      lastErr = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt))
    }
  }
  throw new Error(`更新任务状态失败(重试 3 次): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

/** 心跳：长阶段(逐段生成)期间定期 touch updated_at，防被卡死回收误杀。 */
async function heartbeat(jobId: string, status: string): Promise<void> {
  await patchJob(jobId, { status })
}

/**
 * 边下边写盘 —— 绝不把整个文件读进内存。
 * 真实事故(2026-08-01):160MB 手机录像走 arrayBuffer + Buffer.from = 内存里两份共 320MB，
 * 512MB 的做片容器被系统直接杀掉，任务静悄悄卡在 rendering 连报错都没留下。
 * 超时按大文件放宽到 20 分钟(整段录像可能几百 MB)。
 */
async function download(url: string, dest: string, timeoutMs = 20 * 60 * 1000): Promise<void> {
  // 几百 MB 的下载偶尔会被网络掐断，重试两次再判死(整单重来代价太大)
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok || !res.body) throw new Error(`下载失败 ${res.status}`)
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest))
      return
    } catch (e) {
      lastErr = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
  }
  throw new Error(`下载失败(重试 3 次): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
}

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const d = parseFloat(stdout.trim())
  if (!Number.isFinite(d) || d <= 0) throw new Error(`无法读取时长: ${file}`)
  return d
}

// ---------- Whisper 听写(自己录的整段视频) ----------

/** 抽单声道低码率音轨(Whisper API 限 25MB，视频直接传会爆)。 */
async function extractAudio(videoFile: string, dir: string): Promise<string> {
  const out = join(dir, 'audio.mp3')
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out])
  return out
}

/** OpenAI Whisper 听写，返回带时间戳的分段。 */
interface Transcript {
  segments: TranscriptSegment[]
  words: { start: number; end: number; word: string }[]
}

async function whisperTranscribe(audioFile: string): Promise<Transcript> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY 未配置，无法听写字幕')

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await readFile(audioFile))], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', 'whisper-1')
  form.append('language', 'zh')
  form.append('response_format', 'verbose_json')
  // 两种粒度都要点名:只要 word 的话接口不返回 segments，对轴就没数据了
  form.append('timestamp_granularities[]', 'segment')
  form.append('timestamp_granularities[]', 'word')   // 逐字时间戳:句首时间太粗，掐头会差 1-2 秒

  // 听写要上传几 MB 音频，网络抖一下就整单作废——重试 3 次(和下载同样的保护)
  let res: Response | null = null
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(300000),
      })
      break
    } catch (e) {
      lastErr = e
      if (attempt < 3) await new Promise((r) => setTimeout(r, 4000 * attempt))
    }
  }
  if (!res) throw new Error(`听写请求发不出去(重试 3 次): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
  if (!res.ok) throw new Error(`Whisper 听写失败 ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as {
    segments?: { start: number; end: number; text: string }[]
    words?: { start: number; end: number; word: string }[]
  }
  const segments = (json.segments ?? [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? '').trim() }))
    .filter((s) => s.text)
  if (segments.length === 0) throw new Error('听写结果为空(录像里没有可识别的语音?)')
  const words = (json.words ?? []).filter((w) => w.word?.trim())
  return { segments, words }
}

/**
 * 找真正开口的那一刻(秒) —— 用听写的逐字时间戳。
 *
 * 两次踩坑记在这:
 * ① 用「句子」的起点 —— 偏早近 2 秒(那只是它标句子的粗略位置)，PM 一耳朵听出来;
 * ② 用「声音起来的时刻」 —— 抓到的是吸气/唇音；改判「持续说话」又会把字间停顿当没开始。
 * 逐字时间戳直接给出第一个字的时刻，语义上就是「他开口了」，最准。
 */
export function firstWordStart(
  words: { start: number; word: string }[],
  notBefore: number,
  fallback: number,
): number {
  const w = words.find((x) => x.word?.trim() && x.start >= notBefore - 0.5)
  return w ? w.start : fallback
}

// ---------- PIL 画课件 / 字幕 ----------

// 课件 slide：深色底 + 强调色短横 + 大标题 + 要点列表。内容从 y=300 起(避开平台 UI 顶部遮挡)。
// 不打品牌名(PM:保持单纯分享)。文字按实测宽度折行 + 字号自适应，绝不裁字。
const SLIDE_PY = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
cfg = json.loads(sys.argv[1])
W, H = cfg["w"], cfg["h"]
img = Image.new("RGBA", (W, H), cfg["bg"])
d = ImageDraw.Draw(img)
PAD = 80
TOP = 300                 # 内容起点(避开平台 UI 顶部遮挡)
BOTTOM_PAD = 110          # 底部留白:要点绝不许贴到边
BULLET_X = PAD + 44
MAX_W = W - BULLET_X - PAD

def wrap(text, font, max_w):
    """按测量宽度折行(中文没有词边界，逐字累加)。"""
    lines, cur = [], ""
    for ch in text:
        if d.textlength(cur + ch, font=font) <= max_w:
            cur += ch
        else:
            if cur:
                lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines or [""]

def layout(title_size, point_size, gap):
    """按给定字号排一遍，返回(总高, 画的指令)。放不下就让调用方缩字号。"""
    tf = ImageFont.truetype(cfg["font"], title_size)
    pf = ImageFont.truetype(cfg["font"], point_size)
    ops, y = [], TOP
    ops.append(("rect", PAD, y, PAD + 120, y + 12))
    y += 48
    for line in wrap(cfg["title"], tf, W - 2 * PAD)[:2]:
        ops.append(("text", PAD, y, line, tf))
        y += int(title_size * 1.26)
    y += 36
    for p in cfg["points"]:
        if not p.strip():
            continue
        wrapped = wrap(p.strip(), pf, MAX_W)[:2]
        ops.append(("dot", PAD, y + int(point_size * 0.42), PAD + 18, y + int(point_size * 0.42) + 18))
        for i, line in enumerate(wrapped):
            ops.append(("text", BULLET_X, y, line, pf))
            y += int(point_size * 1.28)
        y += int(point_size * 0.3)
    return y, ops

# 字号自适应:先按标准字号排，超出可用高度就整体缩小(最小 34)，保证一个字都不被裁
avail = H - BOTTOM_PAD
title_size, point_size = 76, 52
while True:
    total, ops = layout(title_size, point_size, 0)
    if total <= avail or point_size <= 34:
        break
    title_size = max(48, title_size - 4)
    point_size -= 3

for op in ops:
    if op[0] == "rect":
        d.rectangle([op[1], op[2], op[3], op[4]], fill=cfg["accent"])
    elif op[0] == "dot":
        d.ellipse([op[1], op[2], op[3], op[4]], fill=cfg["accent"])
    else:
        d.text((op[1], op[2]), op[3], font=op[4], fill=cfg["text"])

img.save(cfg["out"])
`

// 字幕：全帧透明 PNG，短句大字白字黑描边，字幕带起点 y 由参数给。
const CAPTION_H = 160        // 字幕条高度(只画这一条，不画整帧)
const CAPTION_PY = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
cfg = json.loads(sys.argv[1])
W, H = cfg["w"], cfg["h"]
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
font = ImageFont.truetype(cfg["font"], 68)
text = cfg["text"]
box = d.textbbox((0, 0), text, font=font, stroke_width=5)
x = (W - (box[2] - box[0])) // 2
y = (H - (box[3] - box[1])) // 2
d.text((x, y), text, font=font, fill="white", stroke_width=5, stroke_fill="black")
img.save(cfg["out"])
`

interface SlideSpec {
  title: string
  points: string[]
}

/**
 * 每个时间段一张课件：钩子=本讲封面，要点=各自课件，CTA=收尾页。
 * 课件上不打品牌名(PM 拍板：保持单纯分享的感觉，不做成宣传物料)。
 */
export function slidesOfLecture(lecture: LectureScript): SlideSpec[] {
  return [
    { title: lecture.title, points: ['本讲重点', ...lecture.sections.map((s) => s.slideTitle)] },
    ...lecture.sections.map((s) => ({ title: s.slideTitle, points: s.slidePoints })),
    { title: '关注看全系列', points: ['主页合集里有全套', '下一讲更实操'] },
  ]
}

async function renderSlides(
  slides: SlideSpec[],
  colors: SlideColors,
  dir: string,
): Promise<string[]> {
  const files: string[] = []
  for (let i = 0; i < slides.length; i++) {
    const out = join(dir, `slide${i}.png`)
    const cfg = {
      w: W, h: SLIDE_H,
      bg: colors.bg, text: colors.text, accent: colors.accent,
      font: CJK_FONT,
      title: slides[i].title.trim(),
      points: slides[i].points.slice(0, 4),
      out,
    }
    await exec('python3', ['-c', SLIDE_PY, JSON.stringify(cfg)])
    files.push(out)
  }
  return files
}

async function renderCaptions(chunks: SubtitleChunk[], dir: string): Promise<string[]> {
  const files: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const out = join(dir, `cap${i}.png`)
    await exec('python3', ['-c', CAPTION_PY, JSON.stringify({ w: W, h: CAPTION_H, text: chunks[i].text, font: CJK_FONT, out })])
    files.push(out)
  }
  return files
}

// ---------- 合成 ----------

/**
 * 一次 ffmpeg 合成：底色画布 → 下半人像 → 上半课件按时间段换页 → 字幕按块进出 → 人像原声。
 * personFile 提供画面与声音(自己录的整段，或数字人拼好的整段)。
 */
/**
 * 录像预处理 —— 先一次性转成「已裁成下半屏尺寸的 H.264」，后面每段直接用。
 *
 * 为什么必须做:手机录的是 HEVC(H.265)，软件解码比 H.264 贵 3-5 倍；
 * 原来每段合成都要重新解一遍 HEVC 再缩放，单核机器上一段 7 秒的片头就要 4 分钟。
 * 转成小的 H.264 之后，后面 6 段的解码几乎不要钱。
 */
async function prepPersonTrack(params: {
  src: string
  seek: number
  duration: number
  dir: string
}): Promise<string> {
  const { src, seek, duration, dir } = params
  const out = join(dir, 'person.mp4')
  await exec('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', seek.toFixed(3), '-t', duration.toFixed(3), '-i', src,
    '-vf', `scale=${W}:${H - SLIDE_H}:force_original_aspect_ratio=increase,crop=${W}:${H - SLIDE_H},fps=30`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '1',
    out,
  ], { maxBuffer: 32 * 1024 * 1024 })
  return out
}

/**
 * 分段合成 —— 一段一次 ffmpeg，最后 concat。
 *
 * 为什么不一把梭:近 3 分钟的讲课有 ~80 条字幕，一次性丢给 ffmpeg 就是 86 个输入、
 * 86 层 overlay。在做片容器(半颗 CPU / 512MB)上会**又慢又危险**——
 * 真实事故:线上首跑卡在拼片 45 分钟，分不清是在慢慢干还是已经死了，最后被看门狗判死。
 * 拆成每段一次(≤15 个输入)后:内存有界、每段之间能报平安、失败也只丢一段的时间。
 */
async function composePart(params: {
  personFile: string
  personSeek: number          // 在原录像里的绝对起点
  duration: number            // 本段时长
  upperFile: string           // 本段上半屏:课件 PNG 或录屏 MP4
  upperIsClip: boolean
  captions: SubtitleChunk[]   // 时间已换算成「本段内相对秒」
  captionFiles: string[]
  bg: string
  outFile: string
}): Promise<void> {
  const { personFile, personSeek, duration, upperFile, upperIsClip, captions, captionFiles, bg, outFile } = params
  // personFile 已是「裁好的下半屏 H.264」(见 prepPersonTrack)，这里只做定位不再缩放
  const inputs: string[] = ['-ss', personSeek.toFixed(3), '-t', duration.toFixed(3), '-i', personFile]
  if (upperIsClip) inputs.push('-i', upperFile)
  else inputs.push('-loop', '1', '-t', duration.toFixed(3), '-i', upperFile)
  for (const f of captionFiles) inputs.push('-i', f)

  const bgHex = `0x${bg.replace('#', '')}`
  const filters: string[] = [
    `color=c=${bgHex}:s=${W}x${H}:d=${duration.toFixed(3)}[base]`,
    `[base][0:v]overlay=0:${SLIDE_H}:shortest=0[v0]`,
    `[1:v]scale=${W}:${SLIDE_H}[up]`,
    `[v0][up]overlay=0:0[v1]`,
  ]
  let cur = 'v1'
  captionFiles.forEach((_f, i) => {
    const inIdx = 2 + i
    const { start, end } = captions[i]
    const next = `vc${i}`
    filters.push(`[${cur}][${inIdx}:v]overlay=0:${SUB_Y}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${next}]`)
    cur = next
  })

  await exec('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', `[${cur}]`, '-map', '0:a',
    '-t', duration.toFixed(3),
    // veryfast/crf25:ultrafast 虽快但文件大 5 倍(4分半片子 227MB)，会撞存储 50MB 上限——
    // 真实事故:第2讲成片做完了却连传三次失败。真正的提速在录像预转码那一步，这里换回稳的。
    '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '1',
    outFile,
  ], { maxBuffer: 32 * 1024 * 1024 })
}

/** 逐段合成 + 拼接。每段做完 touch 一次任务，长活不会被看门狗误杀。 */
async function composeLecture(params: {
  jobId: string
  personFile: string
  personStart: number
  parts: TimedPart[]
  slideFiles: string[]
  screenClipFiles: (string | null)[]
  captionChunks: SubtitleChunk[]
  captionFiles: string[]
  bg: string
  dir: string
  outFile: string
}): Promise<void> {
  const { jobId, personFile, personStart, parts, slideFiles, screenClipFiles, captionChunks, captionFiles, bg, dir, outFile } = params
  if (parts.length !== slideFiles.length) throw new Error('课件数和时间段数不一致')

  // 先把录像转成「已裁好的下半屏 H.264」并掐掉片头，后面每段直接切片用
  const totalDur = parts[parts.length - 1].end
  const personTrack = await prepPersonTrack({ src: personFile, seek: personStart, duration: totalDur, dir })
  await heartbeat(jobId, 'assembling')

  const partFiles: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const { start, end } = parts[i]
    const dur = Math.max(0.3, end - start)

    // 本段内的字幕(时间换算成段内相对秒；跨界的裁到段边界)
    const caps: SubtitleChunk[] = []
    const capFiles: string[] = []
    captionChunks.forEach((c, ci) => {
      if (c.end <= start || c.start >= end) return
      caps.push({
        text: c.text,
        start: Math.max(0, c.start - start),
        end: Math.min(dur, c.end - start),
      })
      capFiles.push(captionFiles[ci])
    })

    const partOut = join(dir, `part_${String(i).padStart(2, '0')}.mp4`)
    await composePart({
      personFile: personTrack,
      personSeek: start,        // 预转码时已掐掉片头，这里用段内相对时间
      duration: dur,
      upperFile: screenClipFiles[i] ?? slideFiles[i],
      upperIsClip: Boolean(screenClipFiles[i]),
      captions: caps,
      captionFiles: capFiles,
      bg,
      outFile: partOut,
    })
    partFiles.push(partOut)
    await heartbeat(jobId, 'assembling')   // 每段报一次平安
  }

  const listFile = join(dir, 'parts.txt')
  await writeFile(listFile, partFiles.map((f) => `file '${f}'`).join('\n'))
  await exec('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', outFile,
  ], { maxBuffer: 32 * 1024 * 1024 })
}

// ---------- 录屏插入(智能剪辑) ----------

/** 读视频的宽高(裁切框要按源分辨率算)。 */
async function probeSize(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'quiet', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file,
  ])
  const [w, h] = stdout.trim().split('x').map((n) => parseInt(n, 10))
  if (!w || !h) throw new Error(`无法读取分辨率: ${file}`)
  return { w, h }
}

/**
 * 把一段录屏切成能直接铺在课件位的画面：自动裁到内容区 → 配速对齐该段时长 → 出 1080x960 无声片。
 * 失败(链接挂了/格式怪)不炸整单：返回 null，那一段照常用课件。
 */
async function prepareScreenClip(params: {
  url: string
  targetSec: number
  dir: string
  index: number
}): Promise<string | null> {
  const { url, targetSec, dir, index } = params
  try {
    const raw = join(dir, `screen_src_${index}.mp4`)
    await download(url, raw)
    const { w, h } = await probeSize(raw)
    const clipSec = await ffprobeDuration(raw)

    const probeDir = join(dir, `probe_${index}`)
    await mkdir(probeDir, { recursive: true })
    const box = await detectActiveRegion({
      videoFile: raw, frameW: w, frameH: h, durationSec: clipSec, aspect: W / SLIDE_H, dir: probeDir,
    })
    const cropFilter = box
      ? `crop=${box.w}:${box.h}:${box.x}:${box.y}`
      // 检测不出内容区(整段几乎静止)：退回按目标比例居中裁，至少不变形
      : `crop='min(iw,ih*${(W / SLIDE_H).toFixed(4)})':'min(ih,iw/${(W / SLIDE_H).toFixed(4)})'`

    const fit = planClipFit(clipSec, targetSec)
    const chain = [cropFilter, `scale=${W}:${SLIDE_H}`, 'fps=30']
    if (fit.speed > 1) chain.push(`setpts=PTS/${fit.speed.toFixed(4)}`)
    if (fit.padSeconds > 0) chain.push(`tpad=stop_mode=clone:stop_duration=${(fit.padSeconds + 0.5).toFixed(2)}`)

    const out = join(dir, `screen_${index}.mp4`)
    await exec('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', raw,
      '-vf', chain.join(','), '-an',
      '-t', targetSec.toFixed(3),
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      out,
    ], { maxBuffer: 32 * 1024 * 1024 })
    return out
  } catch {
    return null
  }
}

// ---------- 数字人路径(线已接好，未实测) ----------

/** 逐段配音 + omnihuman 口播人像，concat 成整段人像视频；返回文件与各段时长。 */
async function buildDigitalHumanTrack(params: {
  clientId: string
  jobId: string
  parts: string[]           // 各部分口播词
  voiceId: string
  avatarUrl: string
  dir: string
}): Promise<{ personFile: string; durations: number[] }> {
  const { clientId, jobId, parts, voiceId, avatarUrl, dir } = params
  const durations: number[] = []
  const files: string[] = []

  for (let i = 0; i < parts.length; i++) {
    // 逐段生成最坏要 30-45 分钟，每段 touch 一次防被 45 分钟卡死回收误杀(魏征 M3)
    await heartbeat(jobId, 'rendering')
    const vo = await generateVoiceover({ clientId, text: parts[i], voiceId, folder: 'lecture-vo' })
    // 口播人像生成很慢(实测 20 秒音频可超 5 分钟默认上限)，放宽到 15 分钟/段。
    // 心跳在段首已 touch，15 分钟仍远小于 45 分钟卡死回收线。
    const result = await runMuapi(OMNIHUMAN_MODEL, { image_url: avatarUrl, audio_url: vo.audioUrl }, 15 * 60 * 1000)
    const clipUrl = result.outputs[0]
    if (result.status !== 'completed' || !clipUrl) {
      throw new Error(`数字人生成失败(第${i + 1}段): ${result.error ?? result.status}`)
    }
    const f = join(dir, `dh${i}.mp4`)
    await download(clipUrl, f)
    durations.push(await ffprobeDuration(f))
    files.push(f)
  }

  const list = files.map((f) => `file '${f}'`).join('\n')
  await writeFile(join(dir, 'dhlist.txt'), list)
  const personFile = join(dir, 'dhall.mp4')
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'dhlist.txt'),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', personFile])
  return { personFile, durations }
}

/** 数字人路径没有听写：字幕直接用脚本文本，时间在各段内按字数比例分。 */
export function scriptedSubtitles(parts: string[], durations: number[]): SubtitleChunk[] {
  let t = 0
  const segments: TranscriptSegment[] = parts.map((text, i) => {
    const seg = { start: t, end: t + durations[i], text }
    t += durations[i]
    return seg
  })
  return splitSubtitleChunks(segments)
}

// ---------- 主入口(worker 调) ----------

/** 跑一条讲课式做片任务：从领取到成片落库全程。任何失败标 failed + 记原因。 */
export async function runLectureRender(jobId: string): Promise<{ outputUrl: string }> {
  const { data: job, error: jErr } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id')
    .eq('id', jobId)
    .single()
  if (jErr || !job) throw new Error(`render job not found: ${jobId}`)

  const dir = await mkdtemp(join(tmpdir(), 'lecture-'))
  try {
    await patchJob(jobId, { status: 'planning', error: null })

    const loaded = await loadLecturePost(job.client_id, job.content_post_id)
    if (!loaded) throw new Error('讲课式内容未找到')
    const { lecture, production } = loaded
    if (!production?.method) throw new Error('未选制作方式(自己录 / 数字人)')

    const brief = await getActiveBrief(job.client_id).catch(() => null)
    const vi = (brief?.vi_colors ?? null) as Partial<Record<'primary' | 'secondary' | 'accent', string>> | null
    // 只认 #rrggbb —— 存成 rgb(...)/色名会炸 PIL 和 ffmpeg，回落默认色(魏征 m5)
    const hexOk = (c: string | undefined): c is string => Boolean(c && /^#[0-9a-f]{6}$/i.test(c))
    const colors: SlideColors = {
      bg: hexOk(vi?.primary) ? vi.primary : DEFAULT_COLORS.bg,
      text: DEFAULT_COLORS.text,
      accent: hexOk(vi?.secondary) ? vi.secondary : DEFAULT_COLORS.accent,
    }
    // 口播与课件从同一份结构过滤——空口播段(如没写 CTA)连同它的课件一起剔掉，
    // 绝不让后面的课件错位一页(魏征 m4)
    const allSlides = slidesOfLecture(lecture)
    const sectionClips = production.section_clips ?? {}
    const entries = [
      { spoken: lecture.hookSpoken, slide: allSlides[0], clipUrl: null as string | null },
      ...lecture.sections.map((s, i) => ({
        spoken: s.spoken,
        slide: allSlides[1 + i],
        clipUrl: sectionClips[String(i)]?.url ?? null,   // 该要点配的录屏
      })),
      { spoken: lecture.ctaSpoken ?? '', slide: allSlides[allSlides.length - 1], clipUrl: null },
    ].filter((e) => e.spoken && e.spoken.trim())
    if (entries.length === 0) throw new Error('脚本没有任何口播内容')
    const spokenParts = entries.map((e) => e.spoken)

    await patchJob(jobId, { status: 'rendering' })

    let personFile: string
    let personStart = 0
    let duration: number
    let parts: TimedPart[]
    let captionChunks: SubtitleChunk[]

    if (production.method === 'self_record') {
      if (!production.recording_url) throw new Error('没有上传的录像')
      personFile = join(dir, 'rec.mp4')
      step(jobId, '开始下载录像')
      await download(production.recording_url, personFile)
      step(jobId, '录像下载完成')
      await heartbeat(jobId, 'rendering')   // 大文件下载可能几分钟，别让卡死回收误杀
      const rawDuration = await ffprobeDuration(personFile)

      // 听写结果有留档且录像没换过 → 直接复用(省一次听写费用，也保住客户校准过的字幕)
      const cached = loaded.transcript
      let segments: TranscriptSegment[]
      let words: { start: number; end: number; word: string }[]
      if (cached && cached.recordingUrl === production.recording_url && cached.segments.length > 0) {
        step(jobId, `复用已存的听写结果(${cached.segments.length} 段)`)
        segments = cached.segments
        words = cached.words ?? []
      } else {
        step(jobId, '抽音轨')
        const audioFile = await extractAudio(personFile, dir)
        step(jobId, '开始听写')
        const t = await whisperTranscribe(audioFile)
        segments = t.segments
        words = t.words
        step(jobId, `听写完成(${segments.length} 段)`)
      }
      await heartbeat(jobId, 'rendering')

      // 掐头去尾：录像开头的寒暄/清嗓/看提词器/重来一遍，结尾伸手关录制，都不该进成片。
      // 起点用脚本开场白去对(不在脚本里的开场废话自动跳过)；找不到就退回第一句话。
      // extra_head_trim_sec 是手动微调:自动判得不准时 PM 在工作台上拨，不用改代码。
      const HEAD_LEAD = 0.25
      const TAIL_TRAIL = 0.6
      // 两步定起点:①脚本开场白对到「哪一句」②逐字时间戳对到「第一个字」
      const sentenceStart = findHeadStart(lecture.hookSpoken, segments)
      const onset = firstWordStart(words, sentenceStart, sentenceStart)
      const manualExtra = Math.max(0, production.extra_head_trim_sec ?? 0)
      personStart = Math.max(0, onset - HEAD_LEAD + manualExtra)
      const speechEnd = Math.min(rawDuration, segments[segments.length - 1].end + TAIL_TRAIL)
      duration = Math.max(1, speechEnd - personStart)

      // 时间轴整体左移：对轴和字幕都按「掐头之后」的新时间算。
      // 注意别在「段」这一级把起点拉回 0 —— 那等于把已经被剪掉的字重新铺开，
      // 第 0 秒会显示一句没声音的字幕。要在「字幕块」这一级丢弃/裁剪。
      const shifted = segments
        .map((s) => ({ ...s, start: s.start - personStart, end: s.end - personStart }))
        .filter((s) => s.end > 0.15)
      if (shifted.length === 0) throw new Error('片头剪太多了，一句话都不剩')

      parts = alignPartsToSegments(spokenParts, shifted.map((s) => ({ ...s, start: Math.max(0, s.start) })))
      parts[0] = { ...parts[0], start: 0 }
      parts[parts.length - 1] = { ...parts[parts.length - 1], end: duration }

      // 字幕：用未夹紧的时间切块(这样每个字还在它原本该出现的时刻)，
      // 再把落在片头之外的块整块丢掉，跨界的块起点夹到 0。
      captionChunks = splitSubtitleChunks(shifted)
        .filter((c) => c.end > 0.15)
        .map((c) => ({ ...c, start: Math.max(0, c.start) }))

      // 客户校准过字幕就以他的为准(时间不动、只换字)。条数对不上说明脚本/录像变过，按新的来。
      const corrected = loaded.captions
      if (corrected && corrected.length === captionChunks.length) {
        step(jobId, `用客户校准过的字幕(${corrected.length} 条)`)
        captionChunks = captionChunks.map((c, i) => ({ ...c, text: corrected[i].text }))
      }

      // 留档:客户能在页面上校准，下次重做片也不用再听写
      await saveTranscriptAndCaptions({
        clientId: job.client_id,
        postId: job.content_post_id,
        transcript: {
          recordingUrl: production.recording_url,
          segments,
          words,
          savedAt: new Date().toISOString(),
        },
        captions: captionChunks,
      }).catch(() => { /* 留档失败不该让整单白干 */ })
    } else {
      const renderCfg = await clientRenderConfig(job.client_id)
      const track = await buildDigitalHumanTrack({
        clientId: job.client_id,
        jobId,
        parts: spokenParts,
        voiceId: renderCfg.voiceId,
        avatarUrl: renderCfg.avatarUrl,
        dir,
      })
      personFile = track.personFile
      duration = track.durations.reduce((a, b) => a + b, 0)
      let t = 0
      parts = track.durations.map((d) => {
        const p = { start: t, end: t + d }
        t += d
        return p
      })
      captionChunks = scriptedSubtitles(spokenParts, track.durations)
    }

    await patchJob(jobId, { status: 'assembling' })

    step(jobId, '画课件')
    const slideFiles = await renderSlides(entries.map((e) => e.slide), colors, dir)

    // 配了录屏的段:切成正好这段长度的画面，铺在课件位上(切不出来就照常用课件)
    const screenClipFiles: (string | null)[] = []
    for (let i = 0; i < entries.length; i++) {
      const url = entries[i].clipUrl
      if (!url) { screenClipFiles.push(null); continue }
      await heartbeat(jobId, 'assembling')
      screenClipFiles.push(await prepareScreenClip({
        url, targetSec: parts[i].end - parts[i].start, dir, index: i,
      }))
    }

    step(jobId, `画字幕(${captionChunks.length} 条)`)
    const captionFiles = await renderCaptions(captionChunks, dir)

    step(jobId, '开始合成')
    const outFile = join(dir, 'final.mp4')
    await composeLecture({
      jobId, personFile, personStart, parts,
      slideFiles, screenClipFiles,
      captionChunks, captionFiles,
      bg: colors.bg, dir, outFile,
    })

    step(jobId, '合成完成，上传成片')
    const path = `${job.client_id}/render/${jobId}/final.mp4`
    // 成片几十 MB，上传掉线会把前面几分钟的活全废掉——重试 3 次(真实事故:第2讲连挂三次都死在这)
    const bytes = await readFile(outFile)
    const MB = bytes.length / 1048576
    step(jobId, `成片 ${MB.toFixed(1)}MB`)
    if (MB > 49) {
      throw new Error(`成片 ${MB.toFixed(0)}MB 超过存储上限(50MB) — 这一讲录得太长了，分成两条会更好`)
    }
    let upErr: unknown
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const up = await supabaseAdmin.storage.from(BUCKET)
          .upload(path, bytes, { contentType: 'video/mp4', upsert: true })
        if (up.error) throw up.error
        upErr = null
        break
      } catch (e) {
        upErr = e
        step(jobId, `上传失败(第 ${attempt} 次)，重试`)
        if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt))
      }
    }
    if (upErr) throw new Error(`成片上传失败(重试 3 次): ${upErr instanceof Error ? upErr.message : String(upErr)}`)
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)

    await patchJob(jobId, { status: 'ready_for_review', output_url: pub.publicUrl })
    // 只在内容还在审片前的状态时回写成片——已排发/已发布的绝不悄悄换片(魏征 M4)
    await supabaseAdmin
      .from('content_posts')
      .update({ source_video_url: pub.publicUrl })
      .eq('client_id', job.client_id)
      .eq('id', job.content_post_id)
      .not('status', 'in', '(scheduled,published)')

    return { outputUrl: pub.publicUrl }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await patchJob(jobId, { status: 'failed', error: `讲课式做片失败：${message}` }).catch(() => {})
    throw e
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** 读客户做片配置(声音 + 数字人形象)。缺配置给人话报错。 */
async function clientRenderConfig(clientId: string): Promise<{ voiceId: string; avatarUrl: string }> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('factory_config')
    .eq('id', clientId)
    .single()
  const render = (data?.factory_config as { render?: { voice_id?: string; avatar_image_url?: string } } | null)?.render
  if (!render?.voice_id) throw new Error('该客户未配置配音声音（clients.factory_config.render.voice_id）')
  if (!render?.avatar_image_url) throw new Error('该客户未配置数字人形象照（clients.factory_config.render.avatar_image_url）')
  return { voiceId: render.voice_id, avatarUrl: render.avatar_image_url }
}

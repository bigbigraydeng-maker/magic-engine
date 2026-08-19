// 边走边录自动剪辑 —— 掐头去尾 + 听写字幕(数字关键词高亮) + 全屏合成。只在 worker 容器里跑。
//
// 跟讲课式(lecture-render.ts)的差别：没有课件、没有分段结构。脚本是一整段连续口播
// (content_posts.script)，录像是一镜到底，输出是全屏人像(不分屏，无课件层)。
// 复用讲课式验证过的技术：逐字时间戳掐头去尾(av-utils/lecture-align)、防复活守卫
// (render-job-state)。新做的：全屏合成 + 字幕关键词高亮(caption-highlight)。
//
// 触发方式：video/route.ts 的「传成片」入口收到粘贴的原始录像链接时，不直接当成成片，
// 而是存进 generation_context_snapshot.raw_recording_url 并排一条本管线的做片任务 ——
// 跟讲课式一样走 content_factory_render_jobs 队列，worker.ts 按有没有这个字段分流。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase'
import { ffprobeDuration, extractAudio, whisperTranscribe } from './av-utils'
import { safeDownloadRemoteFile } from './safe-remote-fetch'
import { patchJob, heartbeat, stepLog } from './render-job-state'
import {
  findHeadStart,
  firstWordStart,
  splitSubtitleChunks,
  type SubtitleChunk,
  type TranscriptSegment,
} from './lecture-align'
import { normalizeTerms } from './term-glossary'
import { highlightSpans, type HighlightSpan } from './caption-highlight'
import { loadReelCaptionState, saveReelTranscriptAndCaptions } from './reel-post'
import { applyClientGlossary, loadLecturePrefs } from './lecture-learning'

const exec = promisify(execFile)
const BUCKET = 'content-factory'
const CJK_FONT = process.env.FACTORY_CJK_FONT || '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

const W = 1080
const H = 1920
// 全屏内容(没有课件分走上半屏)，复用 render-assemble.ts 已验证的安全区 y=980——
// 跟讲课式的 1150 不是同一个数:那是下半屏(960px 高)内部坐标，这里是全帧坐标。
const SUB_Y = 980
const HEAD_LEAD = 0.25
const TAIL_TRAIL = 0.6
// 一批最多叠几条字幕的 ffmpeg overlay 输入——超过容易在半颗 CPU/512MB 的做片容器上
// 又慢又危险(真实事故见 lecture-render.ts composePart 同款注释)，按时间窗切更稳，
// 不按字幕条数切:字幕疏密不均时条数切会让某一批时长失控。
const WINDOW_SEC = 20

const HIGHLIGHT_COLOR = '#FFD600' // 亮黄，跟白色字幕区分明显

function step(jobId: string, msg: string): void {
  stepLog('reel', jobId, msg)
}

async function probeSize(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'quiet', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file,
  ])
  const [w, h] = stdout.trim().split('x').map(Number)
  if (!w || !h) throw new Error(`读不出录像尺寸: ${file}`)
  return { w, h }
}

/**
 * 录像预处理 —— 一次性掐头去尾 + 裁成全屏竖版 H.264，后面按时间窗直接切片用。
 * 跟讲课式 prepPersonTrack 同一个理由:手机录的 HEVC 解码贵，转一次省后面所有批次的钱。
 * 跟讲课式不同:这里裁的是全高(1080x1920)，不是下半屏(1080x960)。
 */
async function prepFullFrameTrack(params: {
  src: string
  seek: number
  duration: number
  dir: string
}): Promise<string> {
  const { src, seek, duration, dir } = params
  const out = join(dir, 'person.mp4')
  const size = await probeSize(src)
  // 按目标宽高比(9:16)裁：源更宽就裁两侧，源更高就裁上下(人像類录像通常已经是竖版，
  // 一般不会触发裁切，这里只是兜底不炸)。
  await exec('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', seek.toFixed(3), '-t', duration.toFixed(3), '-i', src,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '1',
    out,
  ], { maxBuffer: 32 * 1024 * 1024 })
  void size // 尺寸目前只用于未来的人脸取景扩展，先占位不用
  return out
}

// PIL 画一张全屏透明字幕 PNG，按 span 分色(高亮=黄，其余=白)，整行居中。
const CAPTION_PY = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
font_path, out_dir, caps_json, hi_hex = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
caps = json.loads(caps_json)  # list of list of {text, highlight}
hi_rgb = tuple(int(hi_hex[i:i+2], 16) for i in (1, 3, 5)) + (255,)
WHITE = (255, 255, 255, 255)
STROKE = (0, 0, 0, 240)
STROKE_W = 8
SAFE_W = 1080 - 80  # 左右各留 40px，别顶死画布边

def measure(d, spans, font):
    widths = []
    for sp in spans:
        txt = sp.get("text", "")
        if not txt:
            widths.append(0); continue
        bb = d.textbbox((0, 0), txt, font=font, stroke_width=STROKE_W)
        widths.append(bb[2] - bb[0])
    return widths, sum(widths)

for i, spans in enumerate(caps):
    img = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 字号自适应:88px 起，14 个全角字在这个字号下能超画布宽度(88px×14≈1232px，
    # 还没算两侧描边)，splitSubtitleChunks 允许到 14-16 字，直接固定字号会画出画布外
    # 被裁掉。跟讲课式课件同一个思路:量出真实宽度，超了就缩，缩到能放下为止。
    size = 88
    while size > 40:
        font = ImageFont.truetype(font_path, size)
        widths, total_w = measure(d, spans, font)
        if total_w <= SAFE_W:
            break
        size -= 4
    x = (1080 - total_w) // 2
    for sp, w in zip(spans, widths):
        txt = sp.get("text", "")
        if not txt:
            continue
        color = hi_rgb if sp.get("highlight") else WHITE
        d.text((x, 980), txt, font=font, fill=color, stroke_width=STROKE_W, stroke_fill=STROKE)
        x += w
    img.save(f"{out_dir}/cap{i}.png")
`

async function renderHighlightedCaptions(spanLists: HighlightSpan[][], dir: string): Promise<string[]> {
  await exec('python3', ['-c', CAPTION_PY, CJK_FONT, dir, JSON.stringify(spanLists), HIGHLIGHT_COLOR])
  return spanLists.map((_, i) => join(dir, `cap${i}.png`))
}

/** 一批(一个时间窗)：从人像轨切一段 + 叠这段内的字幕。跟讲课式 composePart 同款理由做批。 */
async function composeBatch(params: {
  personFile: string
  seek: number
  duration: number
  captions: SubtitleChunk[] // 已换算成本批内相对秒
  captionFiles: string[]
  outFile: string
}): Promise<void> {
  const { personFile, seek, duration, captions, captionFiles, outFile } = params
  const inputs: string[] = ['-ss', seek.toFixed(3), '-t', duration.toFixed(3), '-i', personFile]
  for (const f of captionFiles) inputs.push('-i', f)

  const filters: string[] = []
  let cur = '0:v'
  captionFiles.forEach((_f, i) => {
    const inIdx = 1 + i
    const { start, end } = captions[i]
    const next = `v${i}`
    filters.push(`[${cur}][${inIdx}:v]overlay=0:0:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'[${next}]`)
    cur = next
  })

  const mapArgs = filters.length > 0
    ? ['-filter_complex', filters.join(';'), '-map', `[${cur}]`]
    : ['-map', '0:v']

  await exec('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...inputs,
    ...mapArgs,
    '-map', '0:a',
    '-t', duration.toFixed(3),
    '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '44100', '-ac', '1',
    outFile,
  ], { maxBuffer: 32 * 1024 * 1024 })
}

/** 主流程：掐头去尾 → 听写 → 对轴 → 字幕(含高亮) → 分批合成 → concat → 上传。 */
export async function runReelEditRender(jobId: string): Promise<{ outputUrl: string }> {
  const { data: job, error: jErr } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id')
    .eq('id', jobId)
    .single()
  if (jErr || !job) throw new Error(`render job not found: ${jobId}`)

  const dir = await mkdtemp(join(tmpdir(), 'reel-'))
  try {
    await patchJob(jobId, { status: 'planning', error: null })

    const { data: post, error: pErr } = await supabaseAdmin
      .from('content_posts')
      .select('script, generation_context_snapshot')
      .eq('client_id', job.client_id)
      .eq('id', job.content_post_id)
      .single()
    if (pErr || !post) throw new Error('内容未找到')

    const snap = (post.generation_context_snapshot as Record<string, unknown> | null) ?? {}
    const rawUrl = snap.raw_recording_url as string | undefined
    if (!rawUrl) throw new Error('没有待处理的原始录像(raw_recording_url 缺失)')
    const script = (post.script ?? '').trim()
    if (!script) throw new Error('这条内容没有脚本，没法自动对轴掐头去尾')

    // 校对过字幕后重做片会再排一次任务——这次不用重新听写，也不能把客户改好的字冲掉。
    const captionState = await loadReelCaptionState(job.client_id, job.content_post_id)

    step(jobId, '下载原始录像')
    const videoFile = join(dir, 'raw.mp4')
    // 🔴 用逐跳校验的安全下载，不是普通 fetch —— rawUrl 是客户粘贴的外链，提交时
    // 探活通过不代表下载时还安全(TOCTOU，见 safe-remote-fetch.ts 函数头注释)。
    const dl = await safeDownloadRemoteFile(rawUrl, videoFile)
    if (!dl.ok) throw new Error(dl.error ?? '下载原始录像失败')
    await heartbeat(jobId, 'planning')
    const rawDuration = await ffprobeDuration(videoFile)

    // 听写结果有留档且录像没换过 → 直接复用(省一次听写费用，也保住客户校对过的时间轴基础)
    const cached = captionState?.transcript
    let segments: TranscriptSegment[]
    let words: { start: number; end: number; word: string }[]
    if (cached && cached.recordingUrl === rawUrl && cached.segments.length > 0) {
      step(jobId, `复用已存的听写结果(${cached.segments.length} 段)`)
      segments = cached.segments
      words = cached.words ?? []
    } else {
      step(jobId, '抽音轨')
      const audioFile = await extractAudio(videoFile, dir)
      step(jobId, '开始听写')
      const t = await whisperTranscribe(audioFile)
      segments = t.segments
      words = t.words
      step(jobId, `听写完成(${segments.length} 段)`)
    }
    await heartbeat(jobId, 'rendering')
    await patchJob(jobId, { status: 'rendering' })

    // 掐头：脚本第一段(空行前那一段)当"钩子"去跟听写结果对
    const hookText = script.split(/\n\n+/)[0] ?? script.slice(0, 40)
    const sentenceStart = findHeadStart(hookText, segments)
    const onset = firstWordStart(words, sentenceStart, sentenceStart)
    const personStart = Math.max(0, onset - HEAD_LEAD)
    const speechEnd = Math.min(rawDuration, segments[segments.length - 1].end + TAIL_TRAIL)
    const duration = Math.max(1, speechEnd - personStart)

    const shifted = segments
      .map((s) => ({ ...s, start: s.start - personStart, end: s.end - personStart }))
      .filter((s) => s.end > 0.15)
    if (shifted.length === 0) throw new Error('片头剪太多了，一句话都不剩')

    let captionChunks = splitSubtitleChunks(shifted.map((s) => ({ ...s, start: Math.max(0, s.start) })))
      .filter((c) => c.end > 0.15)
      .map((c) => ({ ...c, start: Math.max(0, c.start), text: normalizeTerms(c.text) }))

    // 这个客户自己攒出来的词表(讲课式/边走边录共用同一份 —— 同一个客户，同一套说话习惯)
    const learned = await loadLecturePrefs(job.client_id).catch(() => null)
    if (learned?.glossary && Object.keys(learned.glossary).length > 0) {
      captionChunks = captionChunks.map((c) => ({ ...c, text: applyClientGlossary(c.text, learned.glossary) }))
    }

    // 客户校对过字幕就以他的为准(时间不动、只换字)。条数对不上说明录像/脚本变过，按新的来。
    const corrected = captionState?.captions
    if (corrected && corrected.length === captionChunks.length) {
      step(jobId, `用客户校对过的字幕(${corrected.length} 条)`)
      captionChunks = captionChunks.map((c, i) => ({ ...c, text: corrected[i].text }))
    }

    // 留档:客户能在页面上校对，下次重做片也不用再听写
    await saveReelTranscriptAndCaptions({
      clientId: job.client_id,
      postId: job.content_post_id,
      transcript: { recordingUrl: rawUrl, segments, words, savedAt: new Date().toISOString() },
      captions: captionChunks.map((c) => ({ start: c.start, end: c.end, text: c.text })),
    }).catch(() => { /* 留档失败不该让整单白干 */ })

    await patchJob(jobId, { status: 'assembling' })

    step(jobId, `画字幕(${captionChunks.length} 条，含数字关键词高亮)`)
    const spanLists = captionChunks.map((c) => highlightSpans(c.text))
    const captionFiles = await renderHighlightedCaptions(spanLists, dir)

    step(jobId, '裁剪全屏人像轨')
    const personTrack = await prepFullFrameTrack({ src: videoFile, seek: personStart, duration, dir })
    await heartbeat(jobId, 'assembling')

    // 按固定时间窗分批合成，每批只叠这个窗口内的字幕(≤WINDOW_SEC 秒的密度，输入数天然有界)
    const partFiles: string[] = []
    let batchIdx = 0
    for (let winStart = 0; winStart < duration; winStart += WINDOW_SEC) {
      const winEnd = Math.min(winStart + WINDOW_SEC, duration)
      const winDur = winEnd - winStart
      const caps: SubtitleChunk[] = []
      const capFiles: string[] = []
      captionChunks.forEach((c, ci) => {
        if (c.end <= winStart || c.start >= winEnd) return
        caps.push({
          text: c.text,
          start: Math.max(0, c.start - winStart),
          end: Math.min(winDur, c.end - winStart),
        })
        capFiles.push(captionFiles[ci])
      })
      const partOut = join(dir, `part_${String(batchIdx).padStart(3, '0')}.mp4`)
      await composeBatch({
        personFile: personTrack,
        seek: winStart,
        duration: winDur,
        captions: caps,
        captionFiles: capFiles,
        outFile: partOut,
      })
      partFiles.push(partOut)
      batchIdx++
      await heartbeat(jobId, 'assembling') // 每批报一次平安，长视频不会被看门狗误杀
    }
    if (partFiles.length === 0) throw new Error('剪完之后没有可用画面')

    const listFile = join(dir, 'parts.txt')
    await writeFile(listFile, partFiles.map((f) => `file '${f}'`).join('\n'))
    const outFile = join(dir, 'final.mp4')
    await exec('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c', 'copy', outFile,
    ], { maxBuffer: 32 * 1024 * 1024 })

    const path = `${job.client_id}/reel-edit/${jobId}/final.mp4`
    const bytes = await readFile(outFile)
    const MB = bytes.length / 1048576
    step(jobId, `合成完成，上传成片(${MB.toFixed(1)}MB)`)
    // 🔴 跟讲课式(lecture-render.ts)同一条存储桶上限(Codex 复审：这里之前没查，
    // 长录像编码完超限才在上传这步失败——听写+对轴+合成的活已经全跑完了，白干)。
    // 提前查，长录像能早点报错，不用陪跑完整条管线才知道存不下。
    if (MB > 49) {
      throw new Error(`成片 ${MB.toFixed(0)}MB 超过存储上限(50MB) — 这条录得太长了，剪短一点或分成两条`)
    }
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true })
    if (up.error) throw up.error
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
    const outputUrl = pub.publicUrl

    // 标成片：只改 source_video_url。🔴 raw_recording_url 故意不删——
    // 校对字幕后要能重做片，得留着原始录像地址给下次用；reel_transcript/reel_captions
    // 已经在上面 saveReelTranscriptAndCaptions 里存过了，这里不再碰 snapshot，
    // 避免拿函数开头读到的旧 snap 覆盖回去、把刚存的听写结果冲掉。
    //
    // 🔴 status='approved' 是原子条件，不是先读后判——做片这几分钟里，内容可能
    // 已经被排期/发布(另一个标签页、或人工在后台动的)，这时候绝不能拿旧版本的
    // 剪辑结果覆盖掉已经审过、正在走发布流程的那条(同 video/route.ts attachVideo
    // 的三重限定同一条红线)。没命中就说明片子已经不该被这次结果覆盖，只记日志。
    const { data: finalized, error: finalizeErr } = await supabaseAdmin
      .from('content_posts')
      .update({ source_video_url: outputUrl })
      .eq('client_id', job.client_id)
      .eq('id', job.content_post_id)
      .eq('status', 'approved')
      .select('id')
    // 🔴 空结果有两种截然不同的原因，必须分清:真的没命中(状态变了，正常，不覆盖)
    // vs 这次 update 请求本身失败(网络/数据库抖动)。混为一谈会把真错误当成
    // 「状态变了」悄悄放过——worker 不会重试，卡片永远卡在这，没有任何报错。
    if (finalizeErr) throw finalizeErr
    if (!finalized?.length) {
      step(jobId, '⚠️ 内容状态已变(排期/发布)，成片做完了但不覆盖——留在 storage 里，不生效')
      await patchJob(jobId, { status: 'ready_for_review', output_url: outputUrl, error: '内容已排期/发布，成片未覆盖，需人工确认' })
      return { outputUrl }
    }
    await patchJob(jobId, { status: 'ready_for_review', output_url: outputUrl })

    step(jobId, `完成，成片时长 ${duration.toFixed(1)}s`)
    return { outputUrl }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await patchJob(jobId, { status: 'failed', error: `自动剪辑失败：${message}` }).catch(() => {})
    throw e
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

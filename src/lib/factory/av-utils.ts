// 做片共用的底层能力 —— 下载/听写/音轨提取，讲课式引擎(lecture-render.ts)和
// 边走边录自动剪辑(reel-render.ts)都要用同一套，别各写一份。只在 worker 容器里跑。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import type { TranscriptSegment } from './lecture-align'

const exec = promisify(execFile)

/**
 * 边下边写盘 —— 绝不把整个文件读进内存。
 * 真实事故(2026-08-01):160MB 手机录像走 arrayBuffer + Buffer.from = 内存里两份共 320MB，
 * 512MB 的做片容器被系统直接杀掉，任务静悄悄卡在 rendering 连报错都没留下。
 * 超时按大文件放宽到 20 分钟(整段录像可能几百 MB)。
 */
export async function download(url: string, dest: string, timeoutMs = 20 * 60 * 1000): Promise<void> {
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

export async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const d = parseFloat(stdout.trim())
  if (!Number.isFinite(d) || d <= 0) throw new Error(`无法读取时长: ${file}`)
  return d
}

/** 抽单声道低码率音轨(Whisper API 限 25MB，视频直接传会爆)。 */
export async function extractAudio(videoFile: string, dir: string): Promise<string> {
  const out = join(dir, 'audio.mp3')
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', videoFile, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out])
  return out
}

export interface Transcript {
  segments: TranscriptSegment[]
  words: { start: number; end: number; word: string }[]
}

/**
 * OpenAI Whisper 听写，返回带时间戳的分段(段级 + 字级都要，见函数内注释)。
 *
 * 🔴 language 不写死——这是讲课式(目前只服务中文客户)和边走边录(通用入口，
 * ME 目标市场 AU/NZ，客户不保证都讲中文)共用的底层函数。不传就不带这个参数，
 * 让 Whisper 自己识别语种；讲课式那边显式传 'zh' 保持它现在的行为不变。
 */
export async function whisperTranscribe(audioFile: string, language?: string): Promise<Transcript> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY 未配置，无法听写字幕')

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(await readFile(audioFile))], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', 'whisper-1')
  if (language) form.append('language', language)
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

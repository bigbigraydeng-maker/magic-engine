// 人像取景 —— 决定竖屏录像裁成「下半屏」时该保留哪一条。
//
// 原来固定取正中间，结果客户在车里录、脸偏上，成片里脸就掉到很低的位置(PM 反馈)。
// 现在用视觉识别问一句「脸中心在画面高度的百分之几」，让取景跟着脸走。
// 认不出来(侧脸/太暗/接口挂了)就退回经验值:说话人像通常在上三分之一。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const exec = promisify(execFile)

/** 认不出脸时的兜底:取画面偏上的位置(说话视频的脸基本都在上面)。 */
export const FALLBACK_FACE_Y = 0.34

/**
 * 把脸的中心换算成裁切窗口的起点 y(像素)，并夹在画面内。
 * 脸不放正中间——留头顶空间比留下巴空间重要，所以脸略偏窗口上方(0.42)。
 */
export function bandTopForFace(faceY: number, frameH: number, bandH: number): number {
  const safeFaceY = Math.min(Math.max(faceY, 0), 1)
  const top = safeFaceY * frameH - bandH * 0.42
  return Math.max(0, Math.min(Math.round(top), Math.max(0, frameH - bandH)))
}

const PROMPT =
  '这是一段竖屏说话视频的一帧。人脸中心大约在画面高度的百分之几？' +
  '只回一个 JSON：{"faceY":0.35}（0=最顶端，1=最底端）。看不到人脸就回 {"faceY":null}。'

/** 取一帧问视觉模型脸在哪，返回 0-1 的高度比例；失败返回 null。 */
async function faceYOfFrame(imagePath: string, apiKey: string): Promise<number | null> {
  const b64 = (await readFile(imagePath)).toString('base64')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}`, detail: 'low' } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!res.ok) return null
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = json.choices?.[0]?.message?.content ?? ''
  const m = /"faceY"\s*:\s*([0-9.]+)/.exec(raw)
  if (!m) return null
  const v = parseFloat(m[1])
  return Number.isFinite(v) && v > 0 && v < 1 ? v : null
}

/**
 * 采几帧定位人脸，返回脸中心的高度比例(0-1)。
 * 多帧取中位数——客户会动，单帧可能正好低头或转身。
 */
export async function detectFaceY(params: {
  videoFile: string
  durationSec: number
  dir: string
  /** 这个客户上次的取景位置:认不出脸时按他的习惯来，比通用经验值准。 */
  prior?: number | null
}): Promise<number> {
  const { videoFile, durationSec, dir, prior } = params
  const fallback = prior && prior > 0 && prior < 1 ? prior : FALLBACK_FACE_Y
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallback

  const shots = 3
  const values: number[] = []
  for (let i = 0; i < shots; i++) {
    const t = (durationSec * (i + 0.5)) / shots
    const img = join(dir, `face_${i}.jpg`)
    try {
      await exec('ffmpeg', [
        '-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', videoFile,
        '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '5', img,
      ])
      const y = await faceYOfFrame(img, apiKey)
      if (y !== null) values.push(y)
    } catch {
      // 单帧失败不影响整体，继续下一帧
    }
  }
  if (values.length === 0) return fallback
  values.sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}

/**
 * 分镜头结构测量的 IO 层 —— 下载 + ffprobe/ffmpeg 实测。
 *
 * 纯计算在 shot-structure.ts(可单测);这里只负责跑外部命令。
 *
 * 🔴 刻意做成**独立于 Gemini 分析**的一步:
 * - 库里已有 589 条分析完的 YouTube 视频,可以只补测量、不重跑模型(省钱省时)
 * - 测量失败不该把整条记录判成分析失败(两件事,两个失败面)
 * - 模型负责语义(画面是什么、文字写了什么),ffmpeg 负责数数 —— 各干各擅长的
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { unlink, access } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_SCENE_THRESHOLD, buildShotRecipe, parseSceneTimestamps, type ShotRecipe } from './shot-structure'

const execAsync = promisify(exec)

const DOWNLOAD_TIMEOUT_MS = 180_000
const PROBE_TIMEOUT_MS = 60_000
/** 场景检测要解码全片,长片很慢。超过这个时长的样本跳过 —— 我们要的是短视频配方。 */
const MAX_MEASURE_SECONDS = 180
/** stderr 可能很大(showinfo 每命中一帧一行),给足缓冲避免 maxBuffer 报错 */
const MAX_BUFFER = 32 * 1024 * 1024

/** yt-dlp:Render 上在项目根(build 时下载),本地开发退回 PATH */
async function ytDlpCmd(): Promise<string> {
  const local = path.join(process.cwd(), 'yt-dlp')
  try {
    await access(local)
    return `"${local}"`
  } catch {
    return 'yt-dlp'
  }
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${file}"`,
    { timeout: PROBE_TIMEOUT_MS },
  )
  const d = Number(String(stdout).trim())
  return Number.isFinite(d) ? d : 0
}

/**
 * 对本地文件做场景切换检测。
 *
 * 注意 ffmpeg 把 showinfo 写在 **stderr**,而且正常退出码也是 0 ——
 * 所以必须读 stderr,不能只看 stdout。
 */
async function detectCuts(file: string, threshold: number): Promise<number[]> {
  const { stderr } = await execAsync(
    `ffmpeg -hide_banner -i "${file}" -vf "select='gt(scene,${threshold})',showinfo" -f null - 2>&1`,
    { timeout: PROBE_TIMEOUT_MS * 4, maxBuffer: MAX_BUFFER },
  ).catch((e: { stdout?: string; stderr?: string }) => ({ stderr: e.stderr ?? e.stdout ?? '' }))
  return parseSceneTimestamps(String(stderr))
}

export interface MeasureOutcome {
  ok: boolean
  recipe?: ShotRecipe
  error?: string
}

/** 量一个已经在本地的文件 */
export async function measureLocalVideo(
  file: string,
  sceneThreshold = DEFAULT_SCENE_THRESHOLD,
): Promise<MeasureOutcome> {
  try {
    const duration = await probeDuration(file)
    if (duration <= 0) return { ok: false, error: 'ffprobe 取不到时长' }
    if (duration > MAX_MEASURE_SECONDS) {
      return { ok: false, error: `时长 ${Math.round(duration)}s 超过 ${MAX_MEASURE_SECONDS}s,跳过(我们要的是短视频配方)` }
    }
    const cutTimes = await detectCuts(file, sceneThreshold)
    return { ok: true, recipe: buildShotRecipe({ durationSeconds: duration, cutTimes, sceneThreshold }) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }
  }
}

/** 下载一条视频并量它。用完删文件。 */
export async function measureRemoteVideo(
  url: string,
  sceneThreshold = DEFAULT_SCENE_THRESHOLD,
): Promise<MeasureOutcome> {
  const tmpFile = path.join(tmpdir(), `viral_measure_${Date.now()}_${Math.abs(hash(url))}.mp4`)
  const cmd = await ytDlpCmd()
  try {
    await execAsync(
      `${cmd} -f "best[height<=720][ext=mp4]/best[height<=720]/best" -o "${tmpFile}" "${url}"`,
      { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    )
    return await measureLocalVideo(tmpFile, sceneThreshold)
  } catch (e) {
    return { ok: false, error: `下载失败: ${e instanceof Error ? e.message.slice(0, 160) : e}` }
  } finally {
    unlink(tmpFile).catch(() => {})
  }
}

/** 文件名去重用的稳定哈希(本仓禁用 Math.random) */
function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

/**
 * 量一条库里的记录并落库。
 *
 * 测量失败**不**把 analysis_status 改成 error —— 那个字段是给 Gemini 语义分析用的,
 * 一条视频完全可能「语义分析成功、结构量不到」(比如源站下架)。两件事分开记。
 */
export async function measureAndSave(referenceId: string, url: string): Promise<MeasureOutcome> {
  const out = await measureRemoteVideo(url)
  await supabaseAdmin
    .from('viral_reference_library')
    .update({
      shot_recipe: out.ok ? out.recipe : { error: out.error, measured_at: new Date().toISOString() },
    })
    .eq('id', referenceId)
  return out
}

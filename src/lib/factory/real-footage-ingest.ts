/**
 * 真实拍摄视频 → `video_clips`（track='a_real'）进料（2026-08-03）。
 *
 * 补的是全链最贵的那个缺口：出片时**至少 4 成镜头必须是新画面**，而新画面只有两条路 ——
 * 真拍（$0，且能给真实价格背书）或 AI 生成（$0.225/条，**不能**背书真价）。
 * 系统此前没有任何把真拍视频收进来的路径，于是真素材躺在硬盘上，出片只能花钱编，
 * 正是 Oztop 5 条被退回（AI 底料冒充真产品）的成因。
 *
 * 🔴 只收真实拍摄的原件。AI 生成物、图库下载、我们自己的成片一律不能走这条路 ——
 *    它们进了 a_real 就等于给假画面发了真价通行证。调用方必须显式确认来源，
 *    本模块不做「看文件名猜是不是真拍」这种事（[[feedback-real-vs-generated-clip-provenance]]：
 *    按来源判真假，不靠文件名）。
 *
 * 幂等：按 `source_meta.origin_path` 去重，同一个文件重复跑不会重复入库。
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { SupabaseClient } from '@supabase/supabase-js'

const exec = promisify(execFile)

/** 竖屏优先：出片是 9:16，横片进来只能裁，画质与构图都受损。 */
export const PREFERRED_ASPECT = '9:16'

/** 短于此长度的片段装配时撑不住一个镜头，收了也用不上。 */
export const MIN_USABLE_SECONDS = 1.5

export interface ProbedVideo {
  durationSeconds: number
  width: number
  height: number
  aspectRatio: string
}

/** 把宽高化成出片认识的画幅字符串。非标准比例归到最接近的一档，不硬造新值。 */
export function classifyAspect(width: number, height: number): string {
  if (!width || !height) return 'unknown'
  const r = width / height
  if (r < 0.85) return '9:16'
  if (r > 1.2) return '16:9'
  return '1:1'
}

/**
 * 这条片子能不能进池。
 *
 * 横屏**不拒收**：库里现有的 30-kiteroa 那批就是 1280x720 横屏裁成 9:16 收进来的，
 * 直接拒等于把已经证明可用的素材挡在门外。只标出「要裁」让调用方决定怎么裁 ——
 * 裁法（中心裁 / 跟主体）是装配层的事，不是进料层该定的。
 */
export function isUsableClip(p: ProbedVideo): { ok: boolean; reason?: string; needsCrop?: boolean } {
  if (!Number.isFinite(p.durationSeconds) || p.durationSeconds <= 0) {
    return { ok: false, reason: '时长探测失败' }
  }
  if (p.durationSeconds < MIN_USABLE_SECONDS) {
    return { ok: false, reason: `太短(${p.durationSeconds.toFixed(1)}s)，装配时撑不住一个镜头` }
  }
  return { ok: true, needsCrop: p.aspectRatio !== PREFERRED_ASPECT }
}

/** 用 ffprobe 读时长与画幅。ffprobe 不在时抛错，调用方给出安装提示。 */
export async function probeVideo(filePath: string): Promise<ProbedVideo> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json',
    filePath,
  ])
  const parsed = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[]
    format?: { duration?: string }
  }
  const s = parsed.streams?.[0] ?? {}
  const width = Number(s.width ?? 0)
  const height = Number(s.height ?? 0)
  return {
    durationSeconds: Number(parsed.format?.duration ?? 0),
    width,
    height,
    aspectRatio: classifyAspect(width, height),
  }
}

/**
 * 已入库的来源路径集合 —— 幂等的依据。
 *
 * 恒带 client_id：跨客户查会把别家的路径也算成「已入库」，导致本客户的素材被误跳过。
 */
export async function loadIngestedPaths(
  clientId: string,
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data } = await supabase
    .from('video_clips')
    .select('source_meta')
    .eq('client_id', clientId)
    .eq('track', 'a_real')

  const seen = new Set<string>()
  for (const row of data ?? []) {
    const meta = (row.source_meta ?? {}) as Record<string, unknown>
    const p = meta.origin_path
    if (typeof p === 'string' && p) seen.add(p)
  }
  return seen
}

/**
 * 文件名 → 场景标签兜底。
 *
 * 出片按 scene_tag 与角度做词重叠来挑片，所以标签必须有语义。`IMG_7630` 这种
 * 相机默认名没有任何语义 —— 兜底成 `real_footage_<序号>`，并**明确标记待补**，
 * 由调用方用看图模型补真标签。宁可标成「待补」也不要编一个像模像样的假标签。
 */
export function fallbackSceneTag(fileName: string, index: number): string {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase()
  const cleaned = base.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  // 纯相机默认名(img_7630 / dsc0001 / 2026-08-02 00.52.58)没有语义,不当标签用
  const meaningless = /^(img|dsc|mvi|vid|video|movie)?[_-]?\d+$/.test(cleaned) || /^\d[\d_]*$/.test(cleaned)
  return meaningless ? `real_footage_${String(index + 1).padStart(2, '0')}` : cleaned.slice(0, 60)
}

export interface IngestCandidate {
  filePath: string
  fileName: string
  probe: ProbedVideo
  sceneTag: string
  needsCrop: boolean
  skip?: string
}

/** 把一批本地文件评估成入库候选（纯函数部分，便于测试）。 */
export function buildCandidates(
  files: { filePath: string; fileName: string; probe: ProbedVideo }[],
  alreadyIngested: Set<string>,
): IngestCandidate[] {
  return files.map((f, i) => {
    const sceneTag = fallbackSceneTag(f.fileName, i)
    const usable = isUsableClip(f.probe)
    const needsCrop = usable.needsCrop ?? false
    if (alreadyIngested.has(f.filePath)) {
      return { ...f, sceneTag, needsCrop, skip: '已入库' }
    }
    return { ...f, sceneTag, needsCrop, skip: usable.ok ? undefined : usable.reason }
  })
}

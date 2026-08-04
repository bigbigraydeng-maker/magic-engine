/**
 * 同行业爆款「结构」提取 — 让出片有依据，不再瞎选节奏（PM 2026-08-02 拍板）。
 *
 * viral_reference_library 里 713 条 YouTube 抓取记录，其中 141 条已用视频
 * 场景检测量出真实切点（`shot_recipe.rhythm` / `cut_times` / `hook`）。
 * 出片流程此前一次都没读过它 —— 这正是 PM 退回 CTS 那条片的理由
 * 「节奏偏慢、全片仅 1 个切点、运镜单一」的根因：选配方时没有任何
 * 「什么样才好」的输入。
 *
 * 🔴 硬边界（这是本模块存在的前提，不是建议）
 *   抓来的是**别人的** YouTube 视频。跨过边界的**只有结构数字**：
 *   中位镜头长度 / 切点密度 / 首切时间 / 镜头数 / 钩子类型枚举。
 *   **绝不导出** video_title / opening_hook.script / style_description /
 *   source_url —— 那些是别人的画面与文案，学过来既撞车又和客户真实业务
 *   对不上（PM 已因「AI 底料冒充真产品打真价」退过 5 单）。
 *   返回类型里物理不存在这些字段，并有测试守着。
 *
 * 🔴 样本量闸门
 *   少于 MIN_SAMPLE 条不给建议（返回 null，调用方走原逻辑）。
 *   「数字必须带样本量、样本不够不许改决策」是 PM 拍过的规矩。
 *   sampleSize 一律随结果返回，落进工单便于事后复盘。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase'

/** 少于这个条数不足以代表一个行业的节奏，宁可不改也不瞎改。 */
export const MIN_SAMPLE = 8

/**
 * 镜头数少于这个值的行视为**检测失败**，不计入样本。
 *
 * 实测：flooring 39 条里 20 条 shot_count=1 —— 地板视频画面变化平缓，
 * 场景检测抓不到切点，于是记成「整片 = 1 镜」。照单全收会算出「中位镜长
 * 8.61 秒」，剔除后真值 2.37 秒，差 3.6 倍。
 * **样本量够 ≠ 数据可信**，这是两道独立的闸门。
 */
const MIN_SHOTS_FOR_RHYTHM = 2

/** 只有这些结构字段允许跨过边界 —— 没有任何画面/文案内容。 */
export interface ViralStructure {
  industry: string
  /** 参与统计的爆款条数（永远跟着数字走，便于人判断可信度）。 */
  sampleSize: number
  /** 中位单镜时长（秒）—— 决定配方节奏快慢。 */
  medianShotSeconds: number
  /** 中位首切时间（秒）—— 决定开场留多久才切。 */
  medianFirstCutSeconds: number
  /** 中位镜头数 —— 决定一条片切几段。 */
  medianShotCount: number
  /** 中位总时长（秒）。 */
  medianDurationSeconds: number
  /** 主导开场钩子类型（枚举式短标签，非文案）。 */
  dominantHookType: string | null
  /** 各钩子类型的条数分布，给人看的依据。 */
  hookTypeCounts: Array<{ type: string; n: number }>
}

/** 库里一行的结构部分（只取需要的，不取内容字段）。 */
export interface ViralStructureRow {
  shot_recipe: {
    rhythm?: { median_shot_seconds?: number | null }
    hook?: { first_cut_at?: number | null }
    shot_count?: number | null
    duration_seconds?: number | null
  } | null
  opening_hook: { type?: string | null } | null
  view_count: number | null
}

// ── 纯函数：统计 ────────────────────────────────────────────────────────────────

export function median(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (xs.length === 0) return 0
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid]
}

/**
 * 把库行压成结构摘要。用中位数而非平均：一条 4.4 亿播放的异常片
 * 不该把整个行业的节奏基线拽偏。
 */
export function summariseStructure(
  industry: string,
  rows: ViralStructureRow[],
): ViralStructure | null {
  const usable = rows.filter(
    (r) => r.shot_recipe != null && (r.shot_recipe.shot_count ?? 0) >= MIN_SHOTS_FOR_RHYTHM,
  )
  if (usable.length < MIN_SAMPLE) return null

  const hookCounts = new Map<string, number>()
  for (const row of rows) {
    const type = row.opening_hook?.type
    if (typeof type === 'string' && type.trim().length > 0) {
      hookCounts.set(type, (hookCounts.get(type) ?? 0) + 1)
    }
  }
  const hookTypeCounts = Array.from(hookCounts.entries())
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n)

  return {
    industry,
    sampleSize: usable.length,
    medianShotSeconds: median(usable.map((r) => r.shot_recipe?.rhythm?.median_shot_seconds ?? 0)),
    medianFirstCutSeconds: median(usable.map((r) => r.shot_recipe?.hook?.first_cut_at ?? 0)),
    medianShotCount: median(usable.map((r) => r.shot_recipe?.shot_count ?? 0)),
    medianDurationSeconds: median(usable.map((r) => r.shot_recipe?.duration_seconds ?? 0)),
    dominantHookType: hookTypeCounts[0]?.type ?? null,
    hookTypeCounts,
  }
}

// ── 取数 ────────────────────────────────────────────────────────────────────────

/**
 * 读该行业的爆款结构。样本不足或查询失败一律返回 null —— 调用方原样跑，
 * 绝不因为「学不到」而中断出片。
 */
export async function loadViralStructure(
  industry: string | null,
  supabase: SupabaseClient = supabaseAdmin,
): Promise<ViralStructure | null> {
  if (!industry || industry.trim().length === 0) return null

  // 只 select 结构字段：内容字段连查都不查，杜绝「顺手用了」。
  const { data, error } = await supabase
    .from('viral_reference_library')
    .select('shot_recipe, opening_hook, view_count')
    .eq('is_learnable', true)
    .or(`detected_industry.eq.${industry},industry.eq.${industry}`)
    .not('shot_recipe', 'is', null)
    .order('view_count', { ascending: false })
    .limit(200)

  if (error || !data) return null
  return summariseStructure(industry, data as unknown as ViralStructureRow[])
}

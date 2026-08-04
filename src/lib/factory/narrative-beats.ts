/**
 * 生成镜头的叙事位置（2026-08-03）。
 *
 * PM 看片反馈：「第 10 秒开始的铺好地板的房间，和 12 秒走后开始铺设地板的
 * 逻辑顺序不对。」
 *
 * 真因不是排序错了，是**每个生成镜头都是独立瞎编的**：
 * 提示词只有「角度 + 段落角色 + 爆款风格」，其中爆款风格带了「process-reveal
 * （过程揭示）」，于是 AI 在最后一镜画了施工过程 —— 而前一镜已经是装好的成品。
 * 系统从没告诉它「你是第几拍、前面演过什么、后面还有什么」。
 *
 * 这里给每个生成镜头一个明确的叙事位置，并写清楚**不许出现什么**。
 *
 * 🔴 诚实边界：这是**提示词层的约束，属于软约束**。跟「不许编价格」那类不同 ——
 *    价格能在代码里逐字比对，画面里有没有施工场景没法机器验。
 *    所以这一层只降低概率，最终保证仍然是发布前的人工审片。
 */

export type SegmentRole = 'hook' | 'middle' | 'cta'

export interface BeatContext {
  /** 这是第几个**生成**镜头（从 0 起），不是第几段。 */
  index: number
  /** 一共要生成几个。 */
  total: number
  role: SegmentRole | string
}

/**
 * 三拍叙事：先给结果，再讲怎么做到，最后回到结果并给行动。
 *
 * 为什么结果放最前：短视频前 3 秒决定留不留人，先看到好东西才有人继续看。
 * 施工过程放中间是「为什么值得信」，放最后会让人以为房子还没好。
 */
const BEATS: Record<string, { beat: string; avoid: string }> = {
  hook: {
    beat: 'the finished result — a completed, styled space that looks great',
    avoid: 'do NOT show installation, tools, bare subfloor, or work in progress',
  },
  middle: {
    beat: 'how it is done — close detail of the product itself, texture, quality',
    avoid: 'do NOT jump to a different room or restart the story',
  },
  cta: {
    beat: 'back to the finished space, calm and inviting, ready for the viewer to act',
    avoid: 'do NOT show installation or unfinished work at the end — it reads as "not ready"',
  },
}

/** 一条片子里各镜头的叙事位置说明，拼进 i2v 提示词。 */
export function beatFor(ctx: BeatContext): string {
  const b = BEATS[ctx.role] ?? BEATS.middle
  const position = `shot ${ctx.index + 1} of ${ctx.total}`
  return `${position}. This shot must show: ${b.beat}. ${b.avoid}. Keep continuity with the other shots — it is one continuous story, not separate clips.`
}

/**
 * 完整的 i2v 提示词。
 *
 * 顺序刻意：先角度（讲什么）→ 再叙事位置（这一拍演什么、不许演什么）→
 * 最后风格（怎么拍）。叙事位置放在风格前面，是因为风格里那句
 * 「process-reveal」正是把施工画面带进结尾的元凶 —— 让约束先说话。
 */
export function buildPromptHint(params: {
  /** 排产已经拼好的开头（含角度与段落角色），原样保留，不重拼。 */
  base: string
  role: SegmentRole | string
  index: number
  total: number
  styleDirective?: string | null
}): string {
  const { base, role, index, total, styleDirective } = params
  const parts = [
    base,
    beatFor({ index, total, role }),
  ]
  if (styleDirective) parts.push(`Style: ${styleDirective}`)
  return parts.join(' ')
}

/**
 * 分镜配方 — 治「每条片子千篇一律」。
 *
 * PM 2026-07-24 看片反馈:「所有作品都是千篇一律,几张图片混剪,一组 text over 在画面上,
 * 一组 bgm,没有转场,没有创新」。查下来根因是硬编码:
 *   ①`FACTORY_SHOT_PLAN` 写死 5 段、时长几乎等长 → 每条片子节奏完全一样
 *   ②建单时从不写 `segments[].transition` → 装配层永远走默认 `fade`
 *   ③运镜只有「推近/拉远」按奇偶交替
 * 装配引擎(make_promo.py)本来就支持每段指定转场,能力一直在,只是没人喂给它。
 *
 * 所以这里把「一个写死模板」换成「一组配方」:每种配方自带段数、时长曲线、转场序列、
 * 运镜序列。建单时按内容目标挑一种,同客户连续出片还会轮换,避免又变成新的千篇一律。
 *
 * 🔴 转场名必须来自 XFADE_TRANSITIONS 白名单:make_promo.py 是
 * `segs[i].get("transition","fade")` **零校验**直接拼进 ffmpeg filter 字符串,
 * 传一个 ffmpeg 不认识的名字 → 装配当场失败、整单报废。白名单取自本机
 * `ffmpeg -h filter=xfade` 实测输出(ffmpeg 8.1.2),不是凭记忆写的。
 */

/** ffmpeg xfade 实测支持的转场(仅收录本文件用到的,全部已验证存在) */
export const XFADE_TRANSITIONS = [
  'fade', 'fadeblack', 'dissolve', 'pixelize',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'circleopen', 'circleclose', 'smoothleft', 'smoothright',
  'zoomin', 'coverleft', 'coverup', 'revealright',
] as const
export type XfadeTransition = (typeof XFADE_TRANSITIONS)[number]

/** make_promo 的 _kenburns 只认奇偶推/拉;motion 目前用于生成式 clip 的提示词 */
export type MotionType = 'push_in' | 'pull_back' | 'lateral_truck' | 'static_hold'

export interface RecipeShot {
  role: 'hook' | 'middle' | 'cta'
  duration_hint_s: number
  /** 「转入本段」的转场。第 0 段无转入,装配层忽略,这里仍填以保持结构统一 */
  transition: XfadeTransition
  motion: MotionType
}

export interface ShotRecipe {
  key: string
  /** 给人看的说明,会进工单让 FDE 知道这条片子想走什么路子 */
  label: string
  /** 适合什么内容目标 */
  fits: string
  shots: RecipeShot[]
}

/**
 * 时长约束(别改小):
 * - 每段 ≥ 1.5s。worker 装配有 `Math.max(dur, 1.0)` 地板,而转场时长上限 0.9s;
 *   段长 ≤ 转场时长会让该段被过渡整段吞掉(这个 bug 修过一次)。留足余量。
 * - 总时长控制在 12–16s:竖屏信息流的完播甜区。
 */
export const SHOT_RECIPES: ShotRecipe[] = [
  {
    key: 'fast_cut',
    label: '快剪型 · 7 短镜',
    fits: '产品、促销、上新 —— 信息密度高,靠节奏留人',
    shots: [
      { role: 'hook',   duration_hint_s: 1.8, transition: 'fade',        motion: 'push_in' },
      { role: 'middle', duration_hint_s: 1.6, transition: 'slideleft',   motion: 'lateral_truck' },
      { role: 'middle', duration_hint_s: 1.6, transition: 'wipeleft',    motion: 'push_in' },
      { role: 'middle', duration_hint_s: 1.6, transition: 'slideup',     motion: 'pull_back' },
      { role: 'middle', duration_hint_s: 1.6, transition: 'wipeup',      motion: 'lateral_truck' },
      { role: 'middle', duration_hint_s: 1.8, transition: 'pixelize',    motion: 'push_in' },
      { role: 'cta',    duration_hint_s: 2.4, transition: 'circleopen',  motion: 'pull_back' },
    ],
  },
  {
    key: 'narrative',
    label: '叙事型 · 4 长镜',
    fits: '品牌、目的地、故事 —— 靠画面呼吸感和情绪',
    shots: [
      { role: 'hook',   duration_hint_s: 3.4, transition: 'fade',        motion: 'push_in' },
      { role: 'middle', duration_hint_s: 3.8, transition: 'dissolve',    motion: 'lateral_truck' },
      { role: 'middle', duration_hint_s: 3.8, transition: 'dissolve',    motion: 'pull_back' },
      { role: 'cta',    duration_hint_s: 3.0, transition: 'smoothright', motion: 'push_in' },
    ],
  },
  {
    key: 'problem_solution',
    label: '问题-方案型 · 先慢后快',
    fits: '服务、解决方案 —— 爆款库里高播放的经典结构:先立痛点再给答案',
    shots: [
      { role: 'hook',   duration_hint_s: 3.2, transition: 'fade',        motion: 'static_hold' },
      { role: 'middle', duration_hint_s: 2.8, transition: 'fadeblack',   motion: 'push_in' },
      { role: 'middle', duration_hint_s: 1.8, transition: 'wiperight',   motion: 'lateral_truck' },
      { role: 'middle', duration_hint_s: 1.8, transition: 'slideright',  motion: 'push_in' },
      { role: 'cta',    duration_hint_s: 2.6, transition: 'circleopen',  motion: 'pull_back' },
    ],
  },
  {
    key: 'personal_story',
    label: '故事型 · 8 镜 26 秒',
    fits: '真人第一人称叙事 —— 有叙事人格的客户优先用这个',
    // 对标真实爆款(FB「I Took My Parents to Zhangjiajie」28.2s,原声,第一人称)。
    // 关键是**够长**:12-15s 讲不完一个有情感的故事,只能堆卖点。
    // 节奏设计:开场稍长立人物 → 中段推进 → 情感回扣那镜留足 3.2s 给观众反应 → 收尾邀请。
    shots: [
      { role: 'hook',   duration_hint_s: 3.6, transition: 'fade',        motion: 'push_in' },
      { role: 'middle', duration_hint_s: 3.0, transition: 'dissolve',    motion: 'lateral_truck' },
      { role: 'middle', duration_hint_s: 2.8, transition: 'smoothleft',  motion: 'push_in' },
      { role: 'middle', duration_hint_s: 2.8, transition: 'wipeleft',    motion: 'pull_back' },
      { role: 'middle', duration_hint_s: 3.0, transition: 'dissolve',    motion: 'lateral_truck' },
      { role: 'middle', duration_hint_s: 3.2, transition: 'smoothright', motion: 'static_hold' },
      { role: 'middle', duration_hint_s: 3.4, transition: 'fade',        motion: 'push_in' },
      { role: 'cta',    duration_hint_s: 3.2, transition: 'circleopen',  motion: 'pull_back' },
    ],
  },
  {
    key: 'single_focus',
    label: '单点聚焦 · 3 镜讲透',
    fits: '单品、单卖点 —— 不贪多,一个点说清楚',
    shots: [
      { role: 'hook',   duration_hint_s: 4.0, transition: 'fade',        motion: 'push_in' },
      { role: 'middle', duration_hint_s: 4.5, transition: 'smoothleft',  motion: 'lateral_truck' },
      { role: 'cta',    duration_hint_s: 3.5, transition: 'circleclose', motion: 'pull_back' },
    ],
  },
]

/** 按内容目标圈定候选配方(爆款库的 content_goal 口径:brand/sales/ugc/education) */
const GOAL_PREFERENCE: Record<string, string[]> = {
  sales:     ['fast_cut', 'problem_solution', 'single_focus'],
  brand:     ['narrative', 'single_focus', 'fast_cut'],
  education: ['problem_solution', 'narrative', 'fast_cut'],
  ugc:       ['fast_cut', 'problem_solution', 'narrative'],
}

/**
 * 挑一个配方。
 *
 * `rotationSeed` 传该客户已有工单数 —— 同一客户连续出片时在候选里轮换,
 * 否则「按目标选」很快会退化成新的千篇一律(每条 sales 片都是快剪型)。
 * 纯函数、零随机:同样输入永远同样输出,可测、可复现(Date.now/Math.random 在本仓禁用)。
 */
export function pickShotRecipe(
  contentGoal: string | null,
  rotationSeed: number,
  /** 客户配了叙事人格(brand_voice.persona)→ 优先故事型:第一人称需要时间铺情感 */
  hasPersona = false,
): ShotRecipe {
  if (hasPersona) {
    const story = SHOT_RECIPES.find((r) => r.key === 'personal_story')
    if (story) return story
  }
  const keys = GOAL_PREFERENCE[contentGoal ?? ''] ?? ['narrative', 'fast_cut', 'problem_solution', 'single_focus']
  const seed = Number.isFinite(rotationSeed) && rotationSeed >= 0 ? Math.floor(rotationSeed) : 0
  const key = keys[seed % keys.length]
  return SHOT_RECIPES.find((r) => r.key === key) ?? SHOT_RECIPES[0]
}

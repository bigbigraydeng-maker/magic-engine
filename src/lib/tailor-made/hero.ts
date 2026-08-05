import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 封面图按目的地自动选。
 *
 * 甲方原话：「比如是重庆团，首页的大图从长城更换为重庆」。
 * 每份行程都顶着同一张长城图，客人一眼看出是套模板 —— 而定制行程卖的
 * 恰恰是「这是为你做的」。
 *
 * 图内置在 templates/tailor-made-itinerary/heroes/，不走外部图床：
 * chinatravel 的 Supabase 不在本项目的账号下，传不了图；而外链一旦挂掉，
 * 已经发出去的 PDF 也跟着空一块。
 *
 * 图的来源要小心：chinatravel 的 guides 图库里 21 张「城市图」有 18 张其实是
 * 同一张通用 Unsplash 兜底图（历史遗留），照搬会让「换封面」变成换了个寂寞。
 * 所以这 16 张全部来自 tours/ 与 blog/ 目录并逐张核对过内容，无重复。
 *
 * 加新城市：把图放进 heroes/<name>.jpg，在 RULES 里加一条即可，不用改别处。
 */

const HERO_DIR = path.join(process.cwd(), 'templates', 'tailor-made-itinerary', 'heroes')

/**
 * 关键词 → 图片名。顺序即优先级：先匹配到的赢。
 *
 * 把「更具体的」排在前面：一趟北京+西安的行程，用兵马俑还是长城？
 * 用行程标题和路线里**第一个**出现的地点 —— 那通常就是主打卖点。
 */
const RULES: Array<{ hero: string; patterns: RegExp }> = [
  { hero: 'zhangjiajie',    patterns: /zhangjiajie|tianmen|张家界|天门/i },
  { hero: 'guilin',         patterns: /guilin|桂林/i },
  { hero: 'yangshuo',       patterns: /yangshuo|阳朔/i },
  { hero: 'li-river',       patterns: /li river|漓江/i },
  { hero: 'lijiang',        patterns: /lijiang|丽江|shangri|香格里拉/i },
  { hero: 'yunnan',         patterns: /yunnan|云南|kunming|昆明|dali|大理/i },
  { hero: 'leshan',         patterns: /leshan|乐山|emei|峨眉/i },
  { hero: 'chongqing',      patterns: /chongqing|重庆|hongya|洪崖洞|liziba|李子坝|dazu|大足/i },
  { hero: 'chengdu',        patterns: /chengdu|成都|panda|熊猫/i },
  { hero: 'suzhou',         patterns: /suzhou|苏州/i },
  { hero: 'hangzhou',       patterns: /hangzhou|杭州|wuzhen|乌镇/i },
  { hero: 'shanghai',       patterns: /shanghai|上海/i },
  { hero: 'xian',           patterns: /xi'?an|西安|terracotta|兵马俑/i },
  { hero: 'forbidden-city', patterns: /forbidden city|故宫|紫禁城/i },
  { hero: 'great-wall',     patterns: /great wall|长城|mutianyu|慕田峪|badaling|八达岭/i },
  { hero: 'beijing',        patterns: /beijing|北京/i },
]

/** 全部都匹配不上时用它 —— 中国行程最不会出错的一张 */
const FALLBACK = 'beijing'

/**
 * 从行程标题 + 路线里挑一张封面。
 *
 * 只看**路线的第一站**和标题：一趟「重庆-张家界」的团，主打是重庆，
 * 不该因为张家界排在规则前面就选张家界。所以先按路线顺序逐站找，
 * 找到第一个有图的就用。
 */
export function pickHeroName(trip: { title?: string; route?: string[] }): string {
  const route = trip.route ?? []

  // 1) 按行程顺序逐站找 —— 第一站通常就是主打
  for (const stop of route) {
    const hit = RULES.find((r) => r.patterns.test(stop))
    if (hit) return hit.hero
  }

  // 2) 路线里找不到，再看标题
  const title = trip.title ?? ''
  const hit = RULES.find((r) => r.patterns.test(title))
  if (hit) return hit.hero

  return FALLBACK
}

/** 读成 data URI，供模板内联；读不到时返回 null（模板自带默认图兜底）。 */
export async function loadHeroDataUri(name: string): Promise<string | null> {
  const safe = /^[a-z0-9-]+$/.test(name) ? name : FALLBACK
  try {
    const buf = await readFile(path.join(HERO_DIR, `${safe}.jpg`))
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** 一步到位：按行程选图并读成 data URI */
export async function heroForTrip(trip: { title?: string; route?: string[] }): Promise<string | null> {
  return loadHeroDataUri(pickHeroName(trip))
}

/** 供界面展示的可选清单 —— 顾问想手动换图时用 */
export const HERO_CHOICES: Array<{ name: string; label: string }> = [
  { name: 'beijing',        label: '北京 · 长城晨雾' },
  { name: 'great-wall',     label: '长城 · 云海' },
  { name: 'forbidden-city', label: '北京 · 故宫航拍' },
  { name: 'xian',           label: '西安 · 兵马俑' },
  { name: 'shanghai',       label: '上海 · 天际线' },
  { name: 'chongqing',      label: '重庆 · 洪崖洞夜景' },
  { name: 'chengdu',        label: '成都 · 大熊猫' },
  { name: 'guilin',         label: '桂林 · 山水' },
  { name: 'li-river',       label: '漓江 · 竹筏' },
  { name: 'yangshuo',       label: '阳朔 · 喀斯特航拍' },
  { name: 'zhangjiajie',    label: '张家界 · 天门山玻璃栈道' },
  { name: 'suzhou',         label: '苏州 · 运河' },
  { name: 'hangzhou',       label: '杭州 · 乌镇水乡' },
  { name: 'yunnan',         label: '云南 · 梯田' },
  { name: 'lijiang',        label: '丽江 · 古村' },
  { name: 'leshan',         label: '乐山 · 大佛' },
]

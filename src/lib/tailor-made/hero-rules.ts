/**
 * 封面/大图的选图规则。**纯逻辑，不碰文件系统** —— 画册编辑器是客户端组件，
 * 它要按城市名算出用哪张图；一旦这里 import 了 node:fs，整个 Next 构建会失败
 * （UnhandledSchemeError: Reading from "node:fs/promises"）。
 *
 * 读图的部分在 ./hero.ts，只在服务端用。
 *
 * 加新城市：在 RULES 里加一条，再把图放进 templates/tailor-made-itinerary/heroes/。
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
export const FALLBACK = 'beijing'

/**
 * 从行程标题 + 路线里挑一张封面。
 *
 * 只看**路线的第一站**和标题：一趟「重庆-张家界」的团，主打是重庆，
 * 不该因为张家界排在规则前面就选张家界。所以先按路线顺序逐站找，
 * 找到第一个有图的就用。
 */
/**
 * 匹配不到就返回 null，不兜底。
 *
 * 与 pickHeroName 的区别在用途：整份行程的封面宁可用一张长城也不能空着；
 * 但**单个城市**的大图配错比空着更糟 —— 宜昌那页顶着一张长城，
 * 客人一眼就知道这是套模板凑的。
 */
export function matchHeroName(text: string): string | null {
  return RULES.find((r) => r.patterns.test(text))?.hero ?? null;
}

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

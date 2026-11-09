/**
 * 封面/大图的选图规则。**纯逻辑，不碰文件系统** —— 画册编辑器是客户端组件，
 * 它要按城市名算出用哪张图；一旦这里 import 了 node:fs，整个 Next 构建会失败
 * （UnhandledSchemeError: Reading from "node:fs/promises"）。
 *
 * 读图的部分在 ./hero.ts，只在服务端用。
 *
 * 加新城市：在 RULES 里加一条，再把图放进 templates/tailor-made-itinerary/heroes/。
 */

/**
 * 顺序即优先级，**景点排在城市前面**。
 *
 * 一度图库里只有城市级的 16 张，结果北京那几页全是同一张长城/城景 ——
 * PM 2026-08-30 反馈「图片不能有重叠的」。加了 16 张景点图之后，
 * 「天坛」那天配天坛、「胡同」那天配胡同，同一座城里不再重复。
 *
 * 城市名的规则必须留在最后：一天写「Visit the Temple of Heaven in Beijing」
 * 同时命中天坛和北京，先匹配到的赢，所以景点要排在前面才拿得到。
 */
const RULES: Array<{ hero: string; patterns: RegExp }> = [
  // —— 景点级（排在城市前面）——
  { hero: 'temple-of-heaven',   patterns: /temple of heaven|天坛/i },
  { hero: 'tiananmen-square',   patterns: /tian'?anmen|天安门/i },
  { hero: 'olympic-green',      patterns: /water cube|bird'?s nest|olympic|aquatics cent|national stadium|水立方|鸟巢|奥林匹克/i },
  { hero: 'beijing-hutong',     patterns: /hutong|胡同/i },
  { hero: 'summer-palace',      patterns: /summer palace|颐和园/i },
  { hero: 'beihai-park',        patterns: /beihai|北海公园/i },
  { hero: 'xian-city-wall',     patterns: /city wall|城墙/i },
  { hero: 'wild-goose-pagoda',  patterns: /wild goose pagoda|大雁塔/i },
  { hero: 'tang-everbright-city', patterns: /ever ?bright city|tang paradise|大唐不夜城/i },
  { hero: 'muslim-quarter',     patterns: /muslim quarter|回民街/i },
  { hero: 'ciqikou',            patterns: /ciqikou|磁器口/i },
  { hero: 'liziba',             patterns: /liziba|李子坝/i },
  { hero: 'jiefangbei',         patterns: /jiefangbei|liberation monument|解放碑/i },
  { hero: 'dazu-rock-carvings', patterns: /dazu|大足/i },
  { hero: 'yu-garden',          patterns: /yu ?garden|yuyuan|豫园/i },
  { hero: 'oriental-pearl-tower', patterns: /oriental pearl|东方明珠/i },
  { hero: 'the-bund',           patterns: /the bund|外滩/i },
  { hero: 'nanjing-road',       patterns: /nanjing road|南京路/i },
  { hero: 'zhujiajiao',         patterns: /zhujiajiao|朱家角/i },
  { hero: 'xian-bell-tower',    patterns: /bell tower|drum tower|钟楼|鼓楼/i },
  // 三峡里叫得出名字的那几段，比泛泛的「三峡/长江」更具体，排在它前面才拿得到
  { hero: 'yangtze-gorges-detail', patterns: /qutang gorge|wu gorge|xiling gorge|瞿塘峡|巫峡|西陵峡/i },
  { hero: 'yangtze-gorges',     patterns: /three gorges|yangtze|yichang|长江|三峡|宜昌/i },
  // —— 城市级（兜底）——
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
  { hero: 'pingyao',        patterns: /pingyao|平遥/i },
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

/**
 * 这段文字命中的**全部**图，按规则顺序。
 *
 * 一天常常写到好几个地方（「先豫园，再登东方明珠」），只取第一个会浪费掉
 * 另一张本可以用的图 —— 而同一座城里的中转日、自由活动日正缺图可用，
 * 结果只能重复城景。见 brochure-seed.ts 的兜底池。
 */
export function matchAllHeroNames(text: string): string[] {
  return RULES.filter((r) => r.patterns.test(text)).map((r) => r.hero);
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
  { name: 'the-bund',       label: '上海 · 外滩夜景' },
  { name: 'nanjing-road',   label: '上海 · 南京路步行街' },
  { name: 'zhujiajiao',     label: '上海 · 朱家角水乡' },
  { name: 'xian-bell-tower', label: '西安 · 钟楼' },
  { name: 'yangtze-gorges', label: '长江 · 三峡' },
  { name: 'temple-of-heaven', label: '北京 · 天坛' },
  { name: 'tiananmen-square', label: '北京 · 天安门' },
  { name: 'beijing-hutong', label: '北京 · 胡同' },
  { name: 'summer-palace',  label: '北京 · 颐和园' },
  { name: 'olympic-green',  label: '北京 · 鸟巢水立方' },
  { name: 'beihai-park',    label: '北京 · 北海公园' },
  { name: 'xian-city-wall', label: '西安 · 城墙' },
  { name: 'wild-goose-pagoda', label: '西安 · 大雁塔' },
  { name: 'tang-everbright-city', label: '西安 · 大唐不夜城' },
  { name: 'muslim-quarter', label: '西安 · 回民街' },
  { name: 'ciqikou',        label: '重庆 · 磁器口' },
  { name: 'liziba',         label: '重庆 · 李子坝穿楼' },
  { name: 'jiefangbei',     label: '重庆 · 解放碑' },
  { name: 'dazu-rock-carvings', label: '重庆 · 大足石刻' },
  { name: 'yu-garden',      label: '上海 · 豫园' },
  { name: 'oriental-pearl-tower', label: '上海 · 东方明珠' },
  { name: 'pingyao',        label: '平遥 · 古城楼' },
  { name: 'yangtze-gorges-detail', label: '长江 · 三峡峡口' },
]
